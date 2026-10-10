/* Renderer：シーンを低解像度のオフスクリーン（倍率は自動調整）に描き、仕上げパスでキャンバスへ。
 *  - 起動時に全シーンをコンパイルし、16x16 に 1 回描いて準備（本番中の引っかかり防止）
 *  - 失敗したシーンは無効化して飛ばす
 *  - WebGL コンテキストが失われたら復旧時にすべて作り直す
 *  - 低遅延のため alpha:false / antialias:false / preserveDrawingBuffer:false / desynchronized */
(function (VJ) {
  'use strict';
  const G = VJ.gfx;

  class Renderer {
    constructor(canvas, opts) {
      this.canvas = canvas;
      // transparent：透過ウィンドウ用（単体アプリ）。キャンバスに透明度を持たせ、暗いところを透明にして出す
      this.opts = Object.assign({ desynchronized: true, fixedScale: 0, maxScale: 1, minScale: 0.35, pixelRatio: 0, transparent: false }, opts || {});
      this.scale = this.opts.fixedScale || Math.min(0.75, this.opts.maxScale);
      this.failed = {};
      this.lost = false;
      this.frame = 0;
      this.intervals = new Float32Array(120);
      this.intIdx = 0;
      this.lastFrameT = 0;
      this.slowTimes = [];
      this.lastScaleChange = 0;
      this.lastSlow = 0;
      this.fps = 0;
      this._fpsAcc = 0; this._fpsN = 0; this._fpsT = 0;
      this.specBytes = new Uint8Array(64);
      this.specSlowBytes = new Uint8Array(64);
      this.waveBytes = new Uint8Array(512);
      this.pitchBytes = new Uint8Array(128);
      this.noParam = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      this.output = { rotate: 0, flipH: false, flipV: false, size: 1, x: 0, y: 0 };
      this.logo = null; // { tex, aspect }
      this.logoUrl = '';
      this.ovImg = null; // オーバーレイの画像 { tex, aspect }
      this.ovImgUrl = '';
      this.ovVideo = null; // オーバーレイの動画（<video>。動画ファイル・画面の取り込み）
      this.ovVid = null; // その絵のテクスチャ { tex, aspect }
      this.ovSlot = null; // 重ねるシーンの描画先（使うときに作る）
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.lostCount = (this.lostCount || 0) + 1; }, false);
      canvas.addEventListener('webglcontextrestored', () => {
        try { this._initGL(); this.lost = false; } catch (e) { this.initError = e.message; }
      }, false);
      this._initGL();
    }

    _initGL() {
      const tr = !!this.opts.transparent;
      const attrs = {
        alpha: tr, antialias: false, depth: false, stencil: false,
        preserveDrawingBuffer: false, premultipliedAlpha: tr,
        powerPreference: 'high-performance', desynchronized: !!this.opts.desynchronized,
      };
      const gl = this.canvas.getContext('webgl2', attrs);
      if (!gl) throw new Error(VJ.t('WebGL2 が使えません。Chrome の設定で「ハードウェア アクセラレーション」を有効にしてください。'));
      this.gl = gl;
      this.hdr = !!gl.getExtension('EXT_color_buffer_float');
      this.parallel = gl.getExtension('KHR_parallel_shader_compile');
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      this.software = /swiftshader|llvmpipe|software|basic render/i.test(this.gpu || '');
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const r8 = (w) => G.texture(gl, w, 1, { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE });
      this.texSpec = r8(64);
      this.texSpecSlow = r8(64);
      this.texWave = r8(512);
      this.texPitch = G.texture(gl, 128, 1, { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST });
      this.texBlank = G.texture(gl, 1, 1, { data: new Uint8Array(4) });
      if (this.text) this.text.reset(gl); else this.text = new G.TextLayer(gl);
      this.logo = null;
      if (this.logoUrl) { const u = this.logoUrl; this.logoUrl = ''; this.setLogo(u); }
      this.ovImg = null;
      if (this.ovImgUrl) { const u = this.ovImgUrl; this.ovImgUrl = ''; this.setOverlayImage(u); }
      this.ovVid = null;
      if (this.ovVideo) { const v = this.ovVideo; this.ovVideo = null; this.setOverlayVideo(v); }
      this.slots = null;
      this.ovSlot = null;
      this.tw = 0; this.th = 0;
      this._compileAll();
    }

    _compileAll() {
      const gl = this.gl;
      this.programs = {};
      this.failed = {};
      const pending = [];
      const forceFail = (VJ.params && VJ.params.forceShaderFail) || '';
      for (const def of VJ.scenes.list) {
        let src = VJ.scenes.source(def);
        if (forceFail === def.id) src = src.replace('void main()', 'void main() { syntax error here; }\nvoid main2()');
        pending.push([def.id, new G.Program(gl, src, def.id)]);
      }
      pending.push(['__post', new G.Program(gl, VJ.scenes.POST, 'post')]);
      for (const [id, p] of pending) {
        try {
          p.finish();
          this.programs[id] = p;
        } catch (e) {
          this.failed[id] = e.message;
          p.dispose();
          if (globalThis.console) console.error(e.message);
        }
      }
      this.post = this.programs.__post;
      if (!this.post) throw new Error(VJ.t('仕上げシェーダのコンパイルに失敗しました: ') + this.failed.__post);
      // 準備描画（初回描画時のドライバ側コンパイルを先に済ませる）
      const warm = G.target(gl, 16, 16, this.hdr);
      for (const def of VJ.scenes.list) {
        const p = this.programs[def.id];
        if (!p) continue;
        gl.bindFramebuffer(gl.FRAMEBUFFER, warm.fb);
        gl.viewport(0, 0, 16, 16);
        p.use();
        p.set('u_res', [16, 16]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.finish();
      G.disposeTarget(gl, warm);
    }

    available(id) { return !!this.programs[id]; }

    /** 表示の調整（位置・サイズ・回転・反転） */
    setOutput(o) {
      const d = { rotate: 0, flipH: false, flipV: false, size: 1, x: 0, y: 0 };
      const v = Object.assign({}, d, o || {});
      v.rotate = [0, 90, 180, 270].includes(+v.rotate) ? +v.rotate : 0;
      v.size = Math.max(0.3, Math.min(1, +v.size || 1));
      v.x = Math.max(-0.5, Math.min(0.5, +v.x || 0));
      v.y = Math.max(-0.5, Math.min(0.5, +v.y || 0));
      this.output = v;
    }

    /** キャンバスと描画先のサイズを合わせる。論理サイズ = 表示エリア（回転後） */
    _resize() {
      const c = this.canvas;
      const pr = this.opts.pixelRatio || Math.min(globalThis.devicePixelRatio || 1, 1);
      const w = Math.max(16, Math.round((c.clientWidth || c.width) * pr));
      const h = Math.max(16, Math.round((c.clientHeight || c.height) * pr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const o = this.output;
      const aw = w * o.size, ah = h * o.size;
      this.area = [w / 2 + o.x * w, h / 2 + o.y * h, aw, ah];
      const rot90 = o.rotate === 90 || o.rotate === 270;
      this.lw = rot90 ? ah : aw;
      this.lh = rot90 ? aw : ah;
      const s = this.scale;
      const tw = Math.max(16, Math.round(this.lw * s)), th = Math.max(16, Math.round(this.lh * s));
      if (!this.slots || tw !== this.tw || th !== this.th) {
        const gl = this.gl;
        if (this.slots) for (const sl of this.slots) for (const t of sl.targets) G.disposeTarget(gl, t);
        if (this.ovSlot) { for (const t of this.ovSlot.targets) G.disposeTarget(gl, t); this.ovSlot = null; }
        // 描画先 2 組（それぞれ前フレーム用と 2 枚）。切替のクロスフェード中は、今のシーンと前のシーンが別の組を使う
        this.slots = [0, 1].map(() => ({ targets: [G.target(gl, tw, th, this.hdr), G.target(gl, tw, th, this.hdr)], ping: 0, id: null, last: -9 }));
        this.tw = tw; this.th = th;
      }
    }

    /** ロゴ画像（data URL）。空なら消す */
    setLogo(url) { this._setImage('logo', 'logoUrl', url); }
    /** オーバーレイの画像（data URL）。空なら消す */
    setOverlayImage(url) { this._setImage('ovImg', 'ovImgUrl', url); }

    /** オーバーレイの動画（<video>。null で消す）。絵は描くたびに新しいフレームだけテクスチャへ送る */
    setOverlayVideo(video) {
      video = video || null;
      if (video === this.ovVideo && (!video || this.ovVid)) return;
      const gl = this.gl;
      if (this.ovVid) { gl.deleteTexture(this.ovVid.tex); this.ovVid = null; }
      this.ovVideo = video;
      this._vidNew = true;
      this._vidUp = 0;
      if (!video || this.lost) return;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.ovVid = { tex, aspect: 16 / 9, ready: false };
      // 新しいフレームが来たときだけ送る（描画 60fps・動画 30fps で 2 回送らないように）
      if (video.requestVideoFrameCallback) {
        const cb = () => { if (this.ovVideo !== video) return; this._vidNew = true; video.requestVideoFrameCallback(cb); };
        video.requestVideoFrameCallback(cb);
      }
    }

    /** 動画の新しいフレームをテクスチャへ（フレームの通知が来ない環境でも 1 秒に 4 回は送る） */
    _uploadVideo() {
      const v = this.ovVideo, t = this.ovVid;
      if (!v || !t || v.readyState < 2 || !v.videoWidth) return;
      const now = performance.now();
      if (!this._vidNew && t.ready && now - this._vidUp < 250) return;
      this._vidNew = false;
      this._vidUp = now;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, v);
        t.aspect = v.videoWidth / Math.max(1, v.videoHeight);
        t.ready = true;
      } catch (e) {
        // 別のサイトの動画など、読めない絵（ここには来ない想定）
        t.ready = false;
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }

    /** 画像（data URL）をテクスチャにして this[slot] = { tex, aspect } に入れる。空なら消す */
    _setImage(slot, urlKey, url) {
      if (url === this[urlKey]) return;
      this[urlKey] = url || '';
      const gl = this.gl;
      if (this[slot]) { gl.deleteTexture(this[slot].tex); this[slot] = null; }
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        if (this[urlKey] !== url || this.lost) return;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this[slot] = { tex, aspect: img.naturalWidth / Math.max(1, img.naturalHeight) };
      };
      img.src = url;
    }

    /** フレーム間隔から描画解像度を自動調整 */
    _adapt(now) {
      if (this.lastFrameT) {
        const dt = now - this.lastFrameT;
        if (dt > 0 && dt < 250) {
          this.intervals[this.intIdx] = dt;
          this.intIdx = (this.intIdx + 1) % this.intervals.length;
          this._fpsAcc += dt; this._fpsN++;
          if (this._fpsAcc > 500) { this.fps = (1000 * this._fpsN) / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
        }
      }
      this.lastFrameT = now;
      if (this.opts.fixedScale || this.frame < 60) return;
      // 想定間隔 = 直近の 10 パーセンタイル（60/120/144Hz どれでも）。計算は 60 フレームに 1 回
      if (!this.vsync || this.frame % 60 === 0) {
        const arr = (this._sorted || (this._sorted = new Float32Array(this.intervals.length)));
        arr.set(this.intervals);
        arr.sort();
        const n0 = arr.findIndex((x) => x > 0);
        if (n0 < 0 || arr.length - n0 < 30) return;
        this.vsync = Math.max(6.5, Math.min(34, arr[n0 + Math.floor((arr.length - n0) * 0.1)]));
      }
      const vsync = this.vsync;
      const last = this.intervals[(this.intIdx + this.intervals.length - 1) % this.intervals.length];
      if (last > vsync * 1.5) { this.slowTimes.push(now); this.lastSlow = now; }
      while (this.slowTimes.length && now - this.slowTimes[0] > 500) this.slowTimes.shift();
      const maxS = this.opts.maxScale;
      if (this.slowTimes.length >= 6 && now - this.lastScaleChange > 2000 && this.scale > this.opts.minScale) {
        this.scale = Math.max(this.opts.minScale, +(this.scale - 0.1).toFixed(2));
        this.lastScaleChange = now;
        this.slowTimes.length = 0;
      } else if (now - this.lastSlow > 5000 && now - this.lastScaleChange > 5000 && this.scale < maxS) {
        this.scale = Math.min(maxS, +(this.scale + 0.05).toFixed(2));
        this.lastScaleChange = now;
      }
    }

    setMaxScale(s) {
      this.opts.maxScale = Math.max(this.opts.minScale, Math.min(1, s));
      if (this.scale > this.opts.maxScale) this.scale = this.opts.maxScale;
    }

    _upload(f) {
      const gl = this.gl;
      const toBytes = (src, dst, signed) => {
        for (let i = 0; i < dst.length; i++) {
          const v = signed ? src[i] * 0.5 + 0.5 : src[i];
          dst[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
        }
      };
      toBytes(f.spectrum, this.specBytes);
      toBytes(f.spectrumSlow, this.specSlowBytes);
      toBytes(f.waveform, this.waveBytes, true);
      gl.bindTexture(gl.TEXTURE_2D, this.texSpec);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 1, gl.RED, gl.UNSIGNED_BYTE, this.specBytes);
      gl.bindTexture(gl.TEXTURE_2D, this.texSpecSlow);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 1, gl.RED, gl.UNSIGNED_BYTE, this.specSlowBytes);
      gl.bindTexture(gl.TEXTURE_2D, this.texWave);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 1, gl.RED, gl.UNSIGNED_BYTE, this.waveBytes);
      // 音程の履歴：0 = 無声、1..255 = 0..1
      const ph = f.pitchHist, pb = this.pitchBytes;
      if (ph) {
        const n = Math.min(ph.length, 128), off = 128 - n;
        for (let i = 0; i < off; i++) pb[i] = 0;
        for (let i = 0; i < n; i++) { const v = ph[i]; pb[off + i] = v < 0 ? 0 : 1 + Math.round(Math.min(1, v) * 254); }
        gl.bindTexture(gl.TEXTURE_2D, this.texPitch);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 1, gl.RED, gl.UNSIGNED_BYTE, pb);
      }
    }

    /** テクスチャ（縦横比 texAspect）を論理画面の中央付近に置く枠（uv 0..1）。maxW・maxH は画面に対する割合 */
    fitRect(texAspect, maxW, maxH, cx, cy) {
      const A = this.lw / this.lh;
      let w = maxW, h = (w * A) / texAspect;
      if (h > maxH) { h = maxH; w = (h * texAspect) / A; }
      return [cx - w / 2, cy - h / 2, w, h];
    }
    textRect(widthFrac, cy) { return this.fitRect(G.TextLayer.ASPECT, widthFrac, 0.45, 0.5, cy); }

    /**
     * 1 フレーム描画。
     * fr: { scene, uniforms, f, time, dt, sceneTime, pal(Float32Array 12), travel, idle, quality,
     *       flash, flashColor[3], black, master, impact, text:{tex,alpha}|null, titleTex, latSq, vignette,
     *       param(Float32Array 4), xfade: { scene, uniforms, param, sceneTime, mix } | null（切替のクロスフェード中） }
     */
    render(fr, now) {
      if (this.lost) return false;
      const gl = this.gl;
      this.frame++;
      this._adapt(now === undefined ? performance.now() : now);
      this._resize();
      const f = fr.f;
      this._upload(f);
      // オーバーレイの動画の新しいフレーム（テクスチャの割り当てを変えるので、シーン・仕上げの前に）
      if (fr.ovImage && this.ovVid) this._uploadVideo();

      let def = fr.scene;
      if (!this.programs[def.id]) def = VJ.scenes.byId.title;
      if (!this.programs[def.id]) return false;
      const x = fr.xfade && fr.xfade.mix > 0.001 && this.programs[fr.xfade.scene.id] && fr.xfade.scene.id !== def.id ? fr.xfade : null;
      const main = this._slot(def, x ? x.scene.id : null);
      const dst = this._drawScene(main, def, fr, fr.uniforms, fr.param, fr.sceneTime, fr.titleLogo);
      let dst2 = null;
      if (x) {
        const other = this._slot(x.scene, def.id);
        dst2 = this._drawScene(other, x.scene, fr, x.uniforms, x.param, x.sceneTime, x.titleLogo);
      }
      // オーバーレイ：いまのシーンの上に重ねるシーン（専用の描画先に描く）
      const ov = fr.overlay && fr.overlay.mix > 0.001 && this.programs[fr.overlay.scene.id] ? fr.overlay : null;
      let dst3 = null;
      if (ov) {
        const sl = this._ovSlot(ov.scene);
        dst3 = this._drawScene(sl, ov.scene, fr, ov.uniforms, ov.param, ov.sceneTime, false);
      }

      // 仕上げ
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const q = this.post.use();
      q.tex('u_scene2', dst2 ? dst2.tex : this.texBlank);
      q.set('u_mix', dst2 ? x.mix : 0);
      q.set('u_trans', dst2 ? Math.max(0, VJ.ShowController.TRANSITIONS.indexOf(x.type || 'fade')) : 0);
      q.set('u_tseed', dst2 ? x.seed || 0 : 0);
      q.tex('u_scene3', dst3 ? dst3.tex : this.texBlank);
      q.set('u_ovMix', dst3 ? ov.mix : 0);
      q.set('u_ovMode', ov && ov.mode === 'add' ? 1 : 0);
      return this._post(q, dst, fr);
    }

    /** 重ねるシーンの描画先（使うときに作る）。前フレーム再利用のシーンは、シーンが変わったとき・続けて描いて
     *  いなかったときに残像を消す */
    _ovSlot(def) {
      const gl = this.gl;
      let sl = this.ovSlot;
      if (!sl) sl = this.ovSlot = { targets: [G.target(gl, this.tw, this.th, this.hdr), G.target(gl, this.tw, this.th, this.hdr)], ping: 0, id: null, last: -9 };
      if (def.feedback && (sl.id !== def.id || sl.last !== this.frame - 1)) {
        for (const t of sl.targets) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      }
      sl.id = def.id;
      sl.last = this.frame;
      return sl;
    }

    /** シーンの描画先の組（同じシーンが使っていた組か、avoid でない方）。前フレーム再利用のシーンは、
     *  続けて描いていなかった組なら残像を消す */
    _slot(def, avoid) {
      let sl = this.slots.find((s) => s.id === def.id);
      if (!sl) {
        const free = (s) => avoid === null || s.id !== avoid;
        sl = this.slots.find((s) => free(s) && s.last < this.frame - 1) || this.slots.find(free);
        sl.id = def.id;
        sl.last = -9;
      }
      if (def.feedback && sl.last !== this.frame - 1) {
        const gl = this.gl;
        for (const t of sl.targets) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      }
      sl.last = this.frame;
      return sl;
    }

    /** 1 シーンを描画先の組に描く。描いたターゲットを返す */
    _drawScene(sl, def, fr, uniforms, param, sceneTime, logo) {
      const gl = this.gl, f = fr.f, p = this.programs[def.id];
      const src = sl.targets[sl.ping], dst = sl.targets[1 - sl.ping];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, dst.w, dst.h);
      p.use();
      p.set('u_res', [dst.w, dst.h]);
      p.set('u_time', fr.time);
      p.set('u_dt', fr.dt);
      p.set('u_sceneTime', sceneTime);
      // 描画倍率が下がっている（GPU が苦しい）ときは重いシーンの細部も減らす
      const quality = Math.max(0, Math.min(1, (this.scale - 0.4) / 0.35));
      p.set('u_quality', fr.quality === undefined ? quality : Math.min(quality, fr.quality));
      p.set('u_idle', fr.idle || 0);
      p.set('u_level', f.level); p.set('u_low', f.low); p.set('u_mid', f.mid); p.set('u_high', f.high);
      p.set('u_intensity', f.intensity); p.set('u_centroid', f.centroid);
      p.set('u_kick', f.kick); p.set('u_snare', f.snare); p.set('u_hat', f.hat); p.set('u_accent', f.accent);
      p.set('u_kickN', f.kickN % 4096); p.set('u_snareN', f.snareN % 4096); p.set('u_hatN', f.hatN % 4096); p.set('u_accentN', f.accentN % 4096);
      p.set('u_kickEv', f.kickEv); p.set('u_snareEv', f.snareEv); p.set('u_accentEv', f.accentEv);
      p.set('u_travel', fr.travel % 1000);
      p.set('u_beat', f.bpm ? Math.exp(-f.beatPhase * 6) * Math.min(1, f.beatConf * 1.5) : 0);
      p.set('u_beatPhase', f.beatPhase || 0);
      p.set('u_bar', f.barPhase || 0);
      p.set('u_bpm', f.bpm || 0);
      p.set('u_pitch', f.pitch === undefined ? 0.5 : f.pitch);
      p.set('u_voiced', f.voiced || 0);
      p.set('u_pitchClass', f.pitchClass || 0);
      p.set('u_speech', f.speech ? 1 : 0);
      p.set('u_noteN', (f.noteN || 0) % 4096);
      p.set('u_param', param || this.noParam);
      p.tex('u_pitchHist', this.texPitch);
      p.set('u_pal', fr.pal);
      p.tex('u_spec', this.texSpec);
      p.tex('u_specSlow', this.texSpecSlow);
      p.tex('u_wave', this.texWave);
      p.tex('u_prev', src.tex);
      if (logo && this.logo) {
        p.tex('u_title', this.logo.tex);
        if (p.has('u_titleRect')) p.set('u_titleRect', this.fitRect(this.logo.aspect, 0.7, 0.6, 0.5, 0.5));
      } else {
        p.tex('u_title', fr.titleTex || this.texBlank);
        if (p.has('u_titleRect')) p.set('u_titleRect', this.textRect(0.78, 0.52));
      }
      if (uniforms) for (const k in uniforms) p.set(k, uniforms[k]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      sl.ping = 1 - sl.ping;
      return dst;
    }

    _post(q, dst, fr) {
      const gl = this.gl, o = this.output;
      q.set('u_res', [this.canvas.width, this.canvas.height]);
      q.set('u_area', this.area);
      q.set('u_rot', o.rotate / 90);
      q.set('u_flip', [o.flipH ? 1 : 0, o.flipV ? 1 : 0]);
      q.set('u_lres', [this.lw, this.lh]);
      q.set('u_time', fr.time);
      q.tex('u_scene', dst.tex);
      const text = fr.text, text2 = fr.text2;
      q.tex('u_text', text && text.tex ? text.tex : this.texBlank);
      q.set('u_textAlpha', text ? text.alpha : 0);
      q.set('u_textRect', this.textRect(0.62, 0.5));
      q.tex('u_text2', text2 && text2.tex ? text2.tex : this.texBlank);
      q.set('u_text2Alpha', text2 ? text2.alpha : 0);
      q.set('u_text2Rect', this.textRect(0.7, 0.2));
      const corner = fr.logoCorner && this.logo ? fr.logoCorner : '';
      q.tex('u_logo', corner ? this.logo.tex : this.texBlank);
      q.set('u_logoAlpha', corner ? 0.85 : 0);
      if (corner) {
        const r = this.fitRect(this.logo.aspect, 0.22, 0.16, 0.5, 0.5);
        const m = 0.03;
        r[0] = corner[1] === 'l' ? m * (this.lh / this.lw) : 1 - r[2] - m * (this.lh / this.lw);
        r[1] = corner[0] === 'b' ? m : 1 - r[3] - m;
        q.set('u_logoRect', r);
      }
      // オーバーレイ：画像・動画（合わせ方 contain 全体が入る / cover 画面を埋める / stretch 引き伸ばす）
      const src = this.ovVid && this.ovVid.ready ? this.ovVid : this.ovVideo ? null : this.ovImg;
      const oi = fr.ovImage && src ? fr.ovImage : null;
      q.tex('u_ovImg', oi ? src.tex : this.texBlank);
      q.set('u_ovImgAlpha', oi ? oi.alpha : 0);
      if (oi) {
        q.set('u_ovImgMode', oi.mode === 'add' ? 1 : oi.mode === 'screen' ? 2 : 0);
        const A = this.lw / this.lh, a = src.aspect;
        // 画面の幅・高さに対する割合。cover は、はみ出す側が 1 を超える
        let w = 1, h = 1;
        if (oi.fit !== 'stretch') {
          const wide = a > A;
          if ((oi.fit === 'cover') === wide) w = a / A; else h = A / a;
        }
        q.set('u_ovImgRect', [0.5 - w / 2, 0.5 - h / 2, w, h]);
      }
      // オーバーレイ：隅の文字（時計・曲名など）。左右は文字の端をそろえ、画面の端から少し離す
      const t3 = fr.text3 && fr.text3.tex ? fr.text3 : null;
      q.tex('u_text3', t3 ? t3.tex : this.texBlank);
      q.set('u_text3Alpha', t3 ? t3.alpha : 0);
      if (t3) {
        const r = this.fitRect(G.TextLayer.ASPECT, Math.min(0.9, 0.36 * t3.size), 0.4, 0.5, 0.5);
        const m = 0.025, c = t3.corner || 'tr';
        r[0] = c[1] === 'l' ? m * (this.lh / this.lw) : 1 - r[2] - m * (this.lh / this.lw);
        r[1] = c[0] === 'b' ? m : 1 - r[3] - m;
        q.set('u_text3Rect', r);
      }
      q.set('u_alphaOut', this.opts.transparent ? 1 : 0);
      q.set('u_flash', fr.flash || 0);
      q.set('u_flashColor', fr.flashColor || [1, 1, 1]);
      q.set('u_black', fr.black || 0);
      q.set('u_master', fr.master === undefined ? 1 : fr.master);
      q.set('u_impact', fr.impact || 0);
      q.set('u_punch', fr.punch || 0);
      q.set('u_rgb', fr.rgb || 0);
      const sh = this._shake || (this._shake = new Float32Array(2));
      sh[0] = fr.shakeX || 0;
      sh[1] = fr.shakeY || 0;
      q.set('u_shake', sh);
      q.set('u_latSq', fr.latSq === undefined ? -1 : fr.latSq);
      q.set('u_vignette', fr.vignette === undefined ? 0.6 : fr.vignette);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    }

    /** テスト用：キャンバスを gw x gh の格子に分けて領域ごとの平均（sRGB 0..1）を返す */
    readGrid(gw, gh) {
      const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
      const px = this._px && this._px.length === w * h * 4 ? this._px : (this._px = new Uint8Array(w * h * 4));
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const out = new Float32Array(gw * gh * 3), cnt = new Float32Array(gw * gh);
      for (let y = 0; y < h; y++) {
        const gy = Math.min(gh - 1, Math.floor((y * gh) / h));
        for (let x = 0; x < w; x++) {
          const gx = Math.min(gw - 1, Math.floor((x * gw) / w));
          const i = (y * w + x) * 4, g = gy * gw + gx;
          out[g * 3] += px[i]; out[g * 3 + 1] += px[i + 1]; out[g * 3 + 2] += px[i + 2];
          cnt[g]++;
        }
      }
      for (let g = 0; g < gw * gh; g++) for (let k = 0; k < 3; k++) out[g * 3 + k] /= cnt[g] * 255;
      return out;
    }

    /** テスト用：領域ごとの平均「相対輝度」（画素ごとに sRGB→線形化して Rec.709 で合成） */
    readLumaGrid(gw, gh) {
      const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
      if (!this._lut) {
        this._lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) { const c = i / 255; this._lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
      }
      const lut = this._lut;
      const px = this._px && this._px.length === w * h * 4 ? this._px : (this._px = new Uint8Array(w * h * 4));
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const out = new Float32Array(gw * gh), cnt = new Float32Array(gw * gh);
      for (let y = 0; y < h; y++) {
        const gy = Math.min(gh - 1, Math.floor((y * gh) / h));
        for (let x = 0; x < w; x++) {
          const g = gy * gw + Math.min(gw - 1, Math.floor((x * gw) / w));
          const i = (y * w + x) * 4;
          out[g] += 0.2126 * lut[px[i]] + 0.7152 * lut[px[i + 1]] + 0.0722 * lut[px[i + 2]];
          cnt[g]++;
        }
      }
      for (let g = 0; g < out.length; g++) out[g] /= cnt[g];
      return out;
    }

    info() {
      return {
        gpu: this.gpu, software: this.software, hdr: this.hdr, scale: this.scale, fps: this.fps,
        size: [this.canvas.width, this.canvas.height], sceneSize: [this.tw, this.th], logical: [Math.round(this.lw), Math.round(this.lh)],
        failed: Object.keys(this.failed), lost: this.lost, lostCount: this.lostCount || 0,
      };
    }
  }

  VJ.Renderer = Renderer;
})(globalThis.VJ = globalThis.VJ || {});
