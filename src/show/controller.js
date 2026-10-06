/* ShowController：演出の状態機械。キー・MIDI・テストはすべてここのメソッドを呼ぶ。
 *  - シーン切替は「次のビート」で実行（最大 1 秒待ち）。Shift で即時
 *  - フラッシュ類はすべて FlashLimiter を通す
 *  - セットリスト（曲ごとのシーン・パレット・曲名表示）とオートモード */
(function (VJ) {
  'use strict';
  const { clamp } = VJ.util;

  const PENDING_MAX = 1.0;
  const TEXT_IN = 0.3, TEXT_HOLD = 4.0, TEXT_OUT = 1.0;

  class ShowController {
    constructor(settings) {
      this.settings = settings;
      this.limiter = new VJ.safety.FlashLimiter();
      this.director = new VJ.AutoDirector();
      this.sceneAvailable = (id) => !!VJ.scenes.byId[id];
      this.listeners = [];
      this.onSensitivity = null;
      this.now = 0;
      this.sceneStates = {};
      this.palFloat = new Float32Array(12);
      this.state = {
        sceneId: 'title', pending: null, sceneStart: 0,
        paletteIdx: settings.paletteIdx | 0,
        blackout: false, black: 0,
        master: settings.master, sens: settings.sensitivity | 0,
        auto: !!settings.auto, locked: false,
        songIdx: -1, endState: false,
        flash: 0, flashColor: [1, 1, 1], impact: 0, strobe: false,
        text: null, travel: 0, idle: 1, latSq: 0,
        uniforms: null,
      };
      this.fx = { requestFlash: (s, src) => this.flash(s, src) };
      this.applySettings(settings);
      this._applyScene('title');
    }

    on(fn) { this.listeners.push(fn); }
    _toast(msg, kind) { for (const fn of this.listeners) { try { fn(msg, kind || 'info'); } catch (e) { /* noop */ } } }

    // ---- 設定 ------------------------------------------------------------
    applySettings(s) {
      this.settings = s;
      this.setlist = VJ.setlist.parse(s.setlistText);
      this.state.auto = !!s.auto;
      this.state.master = clamp(+s.master || 1, 0.2, 1);
      this.state.sens = clamp(s.sensitivity | 0, -5, 5);
      this.state.paletteIdx = s.paletteIdx | 0;
      this._palette();
      if (this.onSensitivity) this.onSensitivity(this.state.sens);
    }
    get auto() { return this.state.auto; }
    bandName() { return (this.setlist && this.setlist.band) || this.settings.bandName || ''; }
    endText() { return (this.setlist && this.setlist.end) || this.settings.endText || 'Thank you!'; }
    currentSong() {
      const i = this.state.songIdx;
      return !this.state.endState && i >= 0 && this.setlist && this.setlist.songs[i] ? this.setlist.songs[i] : null;
    }
    _palette() {
      VJ.paletteFloat(VJ.paletteColors(this.state.paletteIdx, this.settings.customPalette), this.palFloat);
      const c = [this.palFloat[9], this.palFloat[10], this.palFloat[11]];
      // フラッシュ色はパレットの 4 色目を白寄りに（赤系は白へ）
      this.state.flashColor = VJ.safety.safeFlashColor(c.map((v) => 0.55 + 0.45 * v));
    }

    // ---- シーン ----------------------------------------------------------
    _applyScene(id) {
      const def = VJ.scenes.byId[id] || VJ.scenes.byId.title;
      const st = {};
      def.init(st);
      this.sceneStates[def.id] = st;
      this.state.sceneId = def.id;
      this.state.sceneStart = this.now;
      this.state.pending = null;
      this.director.noteSwitch(this.now);
    }

    selectScene(id, opts) {
      opts = opts || {};
      if (!VJ.scenes.byId[id]) return false;
      if (!this.sceneAvailable(id)) { this._toast(`「${VJ.scenes.byId[id].nameJa}」は使えません（シェーダエラー）`, 'warn'); return false; }
      this.director.noteSwitch(this.now);
      this.director.silentFrom = null;
      const name = VJ.scenes.byId[id].nameJa;
      if (opts.immediate || !this.lastActive) {
        this._applyScene(id);
        this._toast(`シーン: ${name}`);
      } else {
        this.state.pending = { id, deadline: this.now + PENDING_MAX };
        this._toast(`シーン: ${name}（次のビートで）`);
      }
      return true;
    }

    // ---- セットリスト ----------------------------------------------------
    nextSong() {
      const songs = this.setlist.songs;
      if (!songs.length) { this._toast('セットリストが空です（設定 M から入力）', 'warn'); return; }
      if (this.state.endState) { this._toast('最後の曲のあとです（← で戻る）'); return; }
      const i = this.state.songIdx + 1;
      if (i >= songs.length) {
        this.state.endState = true;
        this.state.songIdx = songs.length;
        this._applyScene('title');
        this.state.text = null;
        this._toast(`終演: ${this.endText()}`);
        return;
      }
      this._startSong(i);
    }

    prevSong() {
      const songs = this.setlist.songs;
      if (!songs.length) return;
      if (this.state.endState) { this.state.endState = false; this._startSong(songs.length - 1); return; }
      const i = this.state.songIdx - 1;
      if (i < 0) {
        this.state.songIdx = -1;
        this.state.text = null;
        this._applyScene('title');
        this._toast('開演前（バンド名）');
        return;
      }
      this._startSong(i);
    }

    _startSong(i) {
      const song = this.setlist.songs[i];
      this.state.songIdx = i;
      this.state.endState = false;
      const first = song.scenes.find((id) => this.sceneAvailable(id));
      if (first) this._applyScene(first);
      else if (this.state.sceneId === 'title') this._applyScene('ripple');
      if (song.palette !== null) { this.state.paletteIdx = song.palette; this._palette(); }
      this.director.noteSwitch(this.now);
      this.director.silentFrom = null;
      if (!song.notitle) this.showSongTitle();
      this._toast(`M${i + 1} ${song.title}`);
    }

    showSongTitle() {
      const song = this.currentSong();
      if (song) this.state.text = { main: song.title, sub: `M${this.state.songIdx + 1}`, t0: this.now };
      else this.state.text = { main: this.state.endState ? this.endText() : this.bandName(), sub: '', t0: this.now };
    }

    /** 次の曲名（事前にテクスチャを作るため） */
    upcomingTexts() {
      const out = [];
      const songs = this.setlist.songs, i = this.state.songIdx + 1;
      if (songs[i]) out.push([songs[i].title, `M${i + 1}`]);
      return out;
    }

    // ---- 光・色・明るさ --------------------------------------------------
    /** フラッシュ（制限器を通る）。strength 0 は「枠だけ消費」（反転・残像リセット用） */
    flash(strength, src) {
      if (!this.limiter.allow(this.now)) return false;
      if (strength > 0) this.state.flash = Math.max(this.state.flash, strength);
      return true;
    }
    setStrobe(on) { this.state.strobe = !!on; }
    toggleBlackout() { this.setBlackout(!this.state.blackout); }
    setBlackout(on) {
      this.state.blackout = !!on;
      this._toast(on ? '暗転' : '暗転解除');
    }
    cyclePalette(d, silent) {
      const n = VJ.palettes.length;
      this.state.paletteIdx = (((this.state.paletteIdx + d) % n) + n) % n;
      this.settings.paletteIdx = this.state.paletteIdx;
      this._palette();
      if (!silent) this._toast(`パレット: ${VJ.palettes[this.state.paletteIdx].name}`);
    }
    nudgeSensitivity(d) {
      this.state.sens = clamp(this.state.sens + d, -5, 5);
      this.settings.sensitivity = this.state.sens;
      if (this.onSensitivity) this.onSensitivity(this.state.sens);
      this._toast(`感度: ${this.state.sens > 0 ? '+' : ''}${this.state.sens}`);
    }
    nudgeMaster(d) {
      this.state.master = clamp(Math.round((this.state.master + d * 0.1) * 10) / 10, 0.2, 1);
      this.settings.master = this.state.master;
      this._toast(`明るさ: ${Math.round(this.state.master * 100)}%`);
    }
    toggleAuto() {
      this.state.auto = !this.state.auto;
      this.settings.auto = this.state.auto;
      if (this.state.auto) this.director.noteSwitch(this.now);
      this._toast(this.state.auto ? 'オート: ON' : 'オート: OFF');
    }
    lock() { this.state.locked = true; this._toast('ロック（L 長押しで解除）'); }
    unlock() { this.state.locked = false; this._toast('ロック解除'); }

    // ---- 毎フレーム ------------------------------------------------------
    update(f, dt, now) {
      const s = this.state;
      this.now = now;
      this.lastActive = f.active;
      const fl = f.onsetFlags;

      s.flash *= Math.exp(-dt / VJ.flashConfig.decay);
      if (s.flash < 0.002) s.flash = 0;
      s.impact *= Math.exp(-dt / 0.15);
      s.travel += (0.15 + 0.85 * f.level) * dt;
      const idleT = !f.active || f.silenceSec > 2.5 ? 1 : 0;
      s.idle += (idleT - s.idle) * Math.min(1, dt / 1.0);

      // 予約された切替：次のビート（キック/スネア/アクセント）で
      if (s.pending) {
        const hit = ((fl & 1) && f.kick >= 0.5) || ((fl & 2) && f.snare >= 0.5) || (fl & 8);
        if (hit || now >= s.pending.deadline || !f.active) this._applyScene(s.pending.id);
      }

      // オート
      const a = this.director.update(this, f, now);
      if (a) {
        if (a.scene && a.scene !== s.sceneId && this.sceneAvailable(a.scene)) this._applyScene(a.scene);
        if (a.palette) this.cyclePalette(1, true);
      }

      // 自動フラッシュ・ストロボ・インパクト
      if (this.settings.autoFlash && (fl & (8 | 16))) this.flash(fl & 16 ? 0.7 : 0.45, 'auto');
      if (s.strobe && (fl & 3)) this.flash(0.65, 'strobe');
      if (fl & 16) s.impact = 1;
      else if (fl & 8) s.impact = Math.max(s.impact, 0.6);

      // 暗転（0.5 秒でフェード）
      const bt = s.blackout ? 1 : 0;
      const step = dt / 0.5;
      s.black = s.black < bt ? Math.min(bt, s.black + step) : Math.max(bt, s.black - step);

      // 遅延計測用の四角：ヒットで点灯
      if (fl & (1 | 2 | 8)) s.latSq = 1;
      else s.latSq *= Math.exp(-dt / 0.06);

      // シーンの JS 側
      const def = VJ.scenes.byId[s.sceneId];
      const st = this.sceneStates[s.sceneId] || (this.sceneStates[s.sceneId] = {});
      try {
        s.uniforms = def.update(st, f, dt, this.fx) || null;
      } catch (e) {
        s.uniforms = null;
        this.sceneErrors = (this.sceneErrors || 0) + 1;
        throw e;
      }
    }

    /** 曲名テキストの透明度 */
    textAlpha() {
      const t = this.state.text;
      if (!t) return 0;
      const a = this.now - t.t0;
      if (a < 0) return 0;
      if (a < TEXT_IN) return a / TEXT_IN;
      if (a < TEXT_IN + TEXT_HOLD) return 1;
      if (a < TEXT_IN + TEXT_HOLD + TEXT_OUT) return 1 - (a - TEXT_IN - TEXT_HOLD) / TEXT_OUT;
      this.state.text = null;
      return 0;
    }

    titleText() { return this.state.endState ? this.endText() : this.bandName(); }

    /** レンダラーに渡すフレーム情報（オブジェクトは使い回す） */
    frame(f, dt, getText) {
      const s = this.state, fr = this._fr || (this._fr = {});
      fr.scene = VJ.scenes.byId[s.sceneId];
      fr.uniforms = s.uniforms;
      fr.f = f;
      fr.time = this.now;
      fr.dt = dt;
      fr.sceneTime = this.now - s.sceneStart;
      fr.pal = this.palFloat;
      fr.travel = s.travel;
      fr.idle = s.idle;
      fr.quality = 1;
      fr.flash = s.flash;
      fr.flashColor = s.flashColor;
      fr.black = s.black;
      fr.master = s.master;
      fr.impact = s.impact;
      const ta = this.textAlpha();
      fr.text = ta > 0 && getText ? { tex: getText(s.text.main, s.text.sub).tex, alpha: ta } : null;
      fr.titleTex = s.sceneId === 'title' && getText ? getText(this.titleText(), '').tex : null;
      fr.latSq = this.settings.latencySquare ? s.latSq : -1;
      fr.vignette = 0.6;
      return fr;
    }
  }

  VJ.ShowController = ShowController;
})(globalThis.VJ = globalThis.VJ || {});
