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
      this.opts = Object.assign({ desynchronized: true, fixedScale: 0, maxScale: 1, minScale: 0.35, pixelRatio: 0 }, opts || {});
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
      this.feedbackScene = null;
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.lostCount = (this.lostCount || 0) + 1; }, false);
      canvas.addEventListener('webglcontextrestored', () => {
        try { this._initGL(); this.lost = false; } catch (e) { this.initError = e.message; }
      }, false);
      this._initGL();
    }

    _initGL() {
      const attrs = {
        alpha: false, antialias: false, depth: false, stencil: false,
        preserveDrawingBuffer: false, premultipliedAlpha: false,
        powerPreference: 'high-performance', desynchronized: !!this.opts.desynchronized,
      };
      const gl = this.canvas.getContext('webgl2', attrs);
      if (!gl) throw new Error('WebGL2 が使えません。Chrome の設定で「ハードウェア アクセラレーション」を有効にしてください。');
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
      this.texBlank = G.texture(gl, 1, 1, { data: new Uint8Array(4) });
      if (this.text) this.text.reset(gl); else this.text = new G.TextLayer(gl);
      this.targets = null;
      this.tw = 0; this.th = 0;
      this.feedbackScene = null;
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
      if (!this.post) throw new Error('仕上げシェーダのコンパイルに失敗しました: ' + this.failed.__post);
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

    /** キャンバスと描画先のサイズを合わせる */
    _resize() {
      const c = this.canvas;
      const pr = this.opts.pixelRatio || Math.min(globalThis.devicePixelRatio || 1, 1);
      const w = Math.max(16, Math.round((c.clientWidth || c.width) * pr));
      const h = Math.max(16, Math.round((c.clientHeight || c.height) * pr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const s = this.scale;
      const tw = Math.max(16, Math.round(w * s)), th = Math.max(16, Math.round(h * s));
      if (!this.targets || tw !== this.tw || th !== this.th) {
        const gl = this.gl;
        if (this.targets) for (const t of this.targets) G.disposeTarget(gl, t);
        this.targets = [G.target(gl, tw, th, this.hdr), G.target(gl, tw, th, this.hdr)];
        this.tw = tw; this.th = th;
        this.ping = 0;
      }
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
      // 想定間隔 = 直近の 10 パーセンタイル（60/120/144Hz どれでも）
      const arr = Array.from(this.intervals).filter((x) => x > 0).sort((a, b) => a - b);
      if (arr.length < 30) return;
      const vsync = Math.max(6.5, Math.min(34, arr[Math.floor(arr.length * 0.1)]));
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
    }

    /** テキスト枠（uv 0..1）：テクスチャの縦横比 4:1 を保って中央に */
    textRect(widthFrac, cy) {
      const A = this.canvas.width / this.canvas.height;
      let w = widthFrac, h = (w * A) / G.TextLayer.ASPECT;
      if (h > 0.45) { h = 0.45; w = (h * G.TextLayer.ASPECT) / A; }
      return [0.5 - w / 2, cy - h / 2, w, h];
    }

    /**
     * 1 フレーム描画。
     * fr: { scene, uniforms, f, time, dt, sceneTime, pal(Float32Array 12), travel, idle, quality,
     *       flash, flashColor[3], black, master, impact, text:{tex,alpha}|null, titleTex, latSq, vignette }
     */
    render(fr, now) {
      if (this.lost) return false;
      const gl = this.gl;
      this.frame++;
      this._adapt(now === undefined ? performance.now() : now);
      this._resize();
      const f = fr.f;
      this._upload(f);

      let def = fr.scene;
      let p = this.programs[def.id];
      if (!p) { def = VJ.scenes.byId.title; p = this.programs.title; }
      if (!p) return false;

      // 前フレーム再利用のシーンに切り替わったら残像を消す
      if (def.feedback && this.feedbackScene !== def.id) {
        for (const t of this.targets) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      }
      this.feedbackScene = def.feedback ? def.id : null;

      const src = this.targets[this.ping], dst = this.targets[1 - this.ping];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, dst.w, dst.h);
      p.use();
      p.set('u_res', [dst.w, dst.h]);
      p.set('u_time', fr.time);
      p.set('u_dt', fr.dt);
      p.set('u_sceneTime', fr.sceneTime);
      p.set('u_quality', fr.quality === undefined ? 1 : fr.quality);
      p.set('u_idle', fr.idle || 0);
      p.set('u_level', f.level); p.set('u_low', f.low); p.set('u_mid', f.mid); p.set('u_high', f.high);
      p.set('u_intensity', f.intensity); p.set('u_centroid', f.centroid);
      p.set('u_kick', f.kick); p.set('u_snare', f.snare); p.set('u_hat', f.hat); p.set('u_accent', f.accent);
      p.set('u_kickN', f.kickN % 4096); p.set('u_snareN', f.snareN % 4096); p.set('u_hatN', f.hatN % 4096); p.set('u_accentN', f.accentN % 4096);
      p.set('u_kickEv', f.kickEv); p.set('u_snareEv', f.snareEv); p.set('u_accentEv', f.accentEv);
      p.set('u_travel', fr.travel % 1000);
      p.set('u_pal', fr.pal);
      p.tex('u_spec', this.texSpec);
      p.tex('u_specSlow', this.texSpecSlow);
      p.tex('u_wave', this.texWave);
      p.tex('u_prev', src.tex);
      p.tex('u_title', fr.titleTex || this.texBlank);
      if (p.has('u_titleRect')) p.set('u_titleRect', this.textRect(0.78, 0.52));
      if (fr.uniforms) for (const k in fr.uniforms) p.set(k, fr.uniforms[k]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.ping = 1 - this.ping;

      // 仕上げ
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const q = this.post.use();
      q.set('u_res', [this.canvas.width, this.canvas.height]);
      q.set('u_time', fr.time);
      q.tex('u_scene', dst.tex);
      const text = fr.text;
      q.tex('u_text', text && text.tex ? text.tex : this.texBlank);
      q.set('u_textAlpha', text ? text.alpha : 0);
      q.set('u_textRect', this.textRect(0.62, 0.5));
      q.set('u_flash', fr.flash || 0);
      q.set('u_flashColor', fr.flashColor || [1, 1, 1]);
      q.set('u_black', fr.black || 0);
      q.set('u_master', fr.master === undefined ? 1 : fr.master);
      q.set('u_impact', fr.impact || 0);
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
        size: [this.canvas.width, this.canvas.height], sceneSize: [this.tw, this.th],
        failed: Object.keys(this.failed), lost: this.lost, lostCount: this.lostCount || 0,
      };
    }
  }

  VJ.Renderer = Renderer;
})(globalThis.VJ = globalThis.VJ || {});
