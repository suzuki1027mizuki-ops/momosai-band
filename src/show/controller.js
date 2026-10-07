/* ShowController：演出の状態機械。キー・MIDI・テストはすべてここのメソッドを呼ぶ。
 *  - シーン切替は「次のビート」で実行（最大 1 秒待ち）。同じキーをもう一度で即時
 *  - 切替はカットかクロスフェード（設定・音楽のタイプ）。フェード中は前のシーンも動かし続ける
 *  - フラッシュ類はすべて FlashLimiter を通す
 *  - セットリスト（曲ごとのシーン・パレット・曲名表示）とオートモード */
(function (VJ) {
  'use strict';
  const { clamp } = VJ.util;
  const t = (...a) => VJ.t(...a);

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
        msg: null, // テロップ { text, t0, off }
        beforeTest: null, // テストパターンの前のシーン
        uniforms: null,
      };
      this.onTap = null; // () => BPM（タップテンポ。FeatureExtractor へつなぐ）
      this.onSession = null; // 状態が変わったら呼ばれる（前回の続きから再開するため）
      this.fx = { requestFlash: (s, src) => this.flash(s, src) };
      this.fxQuiet = { requestFlash: () => false }; // フェードアウト中のシーンはフラッシュを出さない
      this.xfade = null; // { id, t0, dur, start, uniforms }
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
      // settings.paletteIdx は常に「いま使っているパレット」（曲ごとのパレットも反映される）
      this.state.paletteIdx = s.paletteIdx | 0;
      this.profile = VJ.profileById(s.profile);
      this._palette();
      if (this.onSensitivity) this.onSensitivity(this.state.sens);
    }
    /** 自動のフラッシュ（キメ・ブレイク明け・シーンの反転など）を使うか */
    autoFlashOn() { return !!this.settings.autoFlash && this.profile.show.autoFlash !== false && !this.settings.noFlash; }
    /** オートで使ってよいシーンか */
    autoAllowed(id) {
      const def = VJ.scenes.byId[id];
      return !!def && !def.hidden && id !== 'title' && this.sceneAvailable(id) && !(this.settings.autoScenes && this.settings.autoScenes[id] === false);
    }
    /** 動きの大きさ（設定 × 音楽タイプの基準） */
    react() { return VJ.util.clamp((+this.settings.react || 1) * (this.profile.show.react || 1), 0.2, 1.6); }
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
    /** シーンの調整値（設定パネルのスライダー）。out は使い回す Float32Array(4) */
    sceneParams(def, out) { return VJ.scenes.paramValues(def, this.settings.sceneParams && this.settings.sceneParams[def.id], out); }

    /** シーン切替のクロスフェード秒数（0 = カット）。設定が -1 なら音楽のタイプの既定 */
    crossfadeSec() {
      const v = +this.settings.crossfade;
      if (v >= 0) return Math.min(4, v);
      return (this.profile && this.profile.show.crossfade) || 0;
    }

    /** フェードアウト中のシーンの重み（1 → 0） */
    _xmix(x) {
      const t = Math.min(1, Math.max(0, (this.now - x.t0) / x.dur));
      return (x.w0 === undefined ? 1 : x.w0) * (1 - t * t * (3 - 2 * t));
    }

    _applyScene(id) {
      const def = VJ.scenes.byId[id] || VJ.scenes.byId.title;
      const prev = this.state.sceneId, dur = this.crossfadeSec();
      if (dur > 0 && this._started && prev !== def.id && prev !== 'test' && def.id !== 'test' && this.sceneAvailable(prev)) {
        // フェードの途中でまた切り替えたら、いま多く見えている方を消えていく側にして、その重みから続ける
        // （描画先は 2 組なので 3 つは混ぜられない。少ない方だけが急に消える＝変化を半分以下に抑える）
        let out = { id: prev, start: this.state.sceneStart, uniforms: this.state.uniforms, w0: 1 };
        const px = this.xfade;
        if (px && px.id !== prev) {
          const m = this._xmix(px);
          if (m > 0.5 && px.id !== def.id && this.sceneAvailable(px.id)) out = { id: px.id, start: px.start, uniforms: px.uniforms, w0: m };
          else out.w0 = 1 - m;
        }
        this.xfade = Object.assign(out, { t0: this.now, dur });
      } else {
        this.xfade = null;
      }
      this._started = true;
      const st = {};
      def.init(st);
      this.sceneStates[def.id] = st;
      this.state.sceneId = def.id;
      this.state.sceneStart = this.now;
      this.state.pending = null;
      this.director.noteSwitch(this.now);
      this._session();
    }

    _session() { if (this.onSession) this.onSession(this.session()); }
    /** 再開用の状態 */
    session() {
      const s = this.state;
      return { songIdx: s.songIdx, endState: s.endState, sceneId: s.sceneId === 'test' ? (s.beforeTest || 'title') : s.sceneId, paletteIdx: s.paletteIdx, t: Date.now() };
    }
    /** 前回の続きから再開 */
    restoreSession(x) {
      if (!x) return false;
      const songs = this.setlist.songs;
      this.state.songIdx = Math.max(-1, Math.min(songs.length, x.songIdx | 0));
      this.state.endState = !!x.endState || this.state.songIdx >= songs.length;
      if (typeof x.paletteIdx === 'number') this.setPalette(x.paletteIdx);
      this._applyScene(VJ.scenes.byId[x.sceneId] && this.sceneAvailable(x.sceneId) ? x.sceneId : 'title');
      const song = this.currentSong();
      this._toast(song ? t('M{0} {1} から再開', this.state.songIdx + 1, song.title) : t('再開しました'));
      return true;
    }

    selectScene(id, opts) {
      opts = opts || {};
      if (!VJ.scenes.byId[id]) return false;
      if (!this.sceneAvailable(id)) { this._toast(t('「{0}」は使えません（シェーダエラー）', VJ.sceneName(VJ.scenes.byId[id])), 'warn'); return false; }
      this.director.noteSwitch(this.now);
      this.director.silentFrom = null;
      this.director.mcOverride = true; // 操作者が選んだ：この MC の間はタイトルに戻さない
      this.state.beforeTest = null;
      const name = VJ.sceneName(VJ.scenes.byId[id]);
      // 予約中の同じシーンをもう一度選んだら、拍を待たずに切り替える
      const again = this.state.pending && this.state.pending.id === id;
      if (opts.immediate || again || !this.lastActive) {
        this._applyScene(id);
        this._toast(t('シーン: {0}', name));
      } else {
        this.state.pending = { id, deadline: this.now + PENDING_MAX };
        this._toast(t('シーン: {0}（次のビートで）', name));
      }
      return true;
    }

    // ---- セットリスト ----------------------------------------------------
    nextSong() {
      const songs = this.setlist.songs;
      if (!songs.length) { this._toast(t('セットリストが空です（設定 M から入力）'), 'warn'); return; }
      if (this.state.endState) { this._toast(t('最後の曲のあとです（← で戻る）')); return; }
      const i = this.state.songIdx + 1;
      if (i >= songs.length) {
        this.state.endState = true;
        this.state.songIdx = songs.length;
        this._applyScene('title');
        this.state.text = null;
        this._toast(t('終演: {0}', this.endText()));
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
        this._toast(t('開演前（バンド名）'));
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
      if (song.palette !== null) this.setPalette(song.palette);
      this.director.noteSwitch(this.now);
      this.director.silentFrom = null;
      this.director.mcOverride = true; // 操作者が選んだ：この MC の間はタイトルに戻さない
      if (this.onSongStart) this.onSongStart(i);
      if (!song.notitle) this.showSongTitle();
      this._toast(`M${i + 1} ${song.title}`);
      this._session();
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
      if (this.settings.noFlash) return false;
      if ((src === 'auto' || src === 'kaleido-reset' || src === 'glitch-invert') && !this.autoFlashOn()) return false;
      if (!this.limiter.allow(this.now)) return false;
      if (strength > 0) this.state.flash = Math.max(this.state.flash, strength);
      return true;
    }
    setStrobe(on) { this.state.strobe = !!on; }
    toggleBlackout() { this.setBlackout(!this.state.blackout); }
    setBlackout(on) {
      this.state.blackout = !!on;
      this._toast(on ? t('暗転') : t('暗転解除'));
    }
    /** パレットを指定（設定にも反映） */
    setPalette(i) {
      const n = VJ.palettes.length;
      this.state.paletteIdx = ((Math.round(+i || 0) % n) + n) % n;
      this.settings.paletteIdx = this.state.paletteIdx;
      this._palette();
    }
    cyclePalette(d, silent) {
      const n = VJ.palettes.length;
      this.state.paletteIdx = (((this.state.paletteIdx + d) % n) + n) % n;
      this.settings.paletteIdx = this.state.paletteIdx;
      this._palette();
      if (!silent) this._toast(t('パレット: {0}', t(VJ.palettes[this.state.paletteIdx].name)));
    }
    nudgeSensitivity(d) {
      this.state.sens = clamp(this.state.sens + d, -5, 5);
      this.settings.sensitivity = this.state.sens;
      if (this.onSensitivity) this.onSensitivity(this.state.sens);
      this._toast(t('感度: {0}', (this.state.sens > 0 ? '+' : '') + this.state.sens));
    }
    nudgeMaster(d) {
      this.state.master = clamp(Math.round((this.state.master + d * 0.1) * 10) / 10, 0.2, 1);
      this.settings.master = this.state.master;
      this._toast(t('明るさ: {0}%', Math.round(this.state.master * 100)));
    }
    /** 明るさを直接（MIDI のつまみなど）。0.2〜1 */
    setMaster(v) {
      this.state.master = clamp(+v || 0.2, 0.2, 1);
      this.settings.master = Math.round(this.state.master * 100) / 100;
    }
    /** 感度を直接（-5〜+5） */
    setSensitivity(step) {
      const v = clamp(Math.round(step), -5, 5);
      if (v !== this.state.sens) this.nudgeSensitivity(v - this.state.sens);
    }
    toggleAuto() {
      this.state.auto = !this.state.auto;
      this.settings.auto = this.state.auto;
      if (this.state.auto) this.director.noteSwitch(this.now);
      this._toast(this.state.auto ? t('オート: ON') : t('オート: OFF'));
    }
    lock() { this.state.locked = true; this._toast(t('ロック（L 長押しで解除）')); }
    unlock() { this.state.locked = false; this._toast(t('ロック解除')); }

    /** タップテンポ */
    tap() {
      const bpm = this.onTap ? this.onTap() : 0;
      this._toast(bpm ? t('テンポ: {0} BPM（タップ）', Math.round(bpm)) : t('タップ（3 回以上たたくとテンポが決まります）'));
      return bpm;
    }

    /** テロップ：i 番目のメッセージを表示・もう一度で消す */
    toggleMessage(i) {
      const text = (this.settings.messages && this.settings.messages[i]) || '';
      if (!text) { this._toast(t('テロップ {0} が空です（設定 M で入力）', i + 1), 'warn'); return; }
      this.showMessage(text);
    }
    /** テロップを表示（同じ文字なら消す）。空文字で消す */
    showMessage(text) {
      const m = this.state.msg;
      if (!text || (m && !m.off && m.text === text)) {
        if (m && !m.off) m.off = this.now;
        return;
      }
      this.state.msg = { text, t0: this.now, off: 0 };
    }
    msgAlpha() {
      const m = this.state.msg;
      if (!m) return 0;
      const a = Math.min(1, (this.now - m.t0) / 0.3);
      if (!m.off) return a;
      const b = 1 - (this.now - m.off) / 0.5;
      if (b <= 0) { this.state.msg = null; return 0; }
      return Math.min(a, b);
    }

    /** テストパターンの表示・解除 */
    toggleTestPattern() {
      const s = this.state;
      if (s.sceneId === 'test') { const back = s.beforeTest || 'title'; s.beforeTest = null; this._applyScene(back); this._toast(t('テストパターン解除')); return; }
      s.beforeTest = s.sceneId;
      this._applyScene('test');
      this._toast(t('テストパターン（G で戻る）'));
    }

    /** 開演までのカウントダウン文字（無ければ ''） */
    countdownText(nowDate) {
      const str = String(this.settings.countdownTo || '').trim();
      const m = /^(\d{1,2})[:：](\d{2})$/.exec(str);
      if (!m || this.state.songIdx >= 0 || this.state.endState) return '';
      const d = nowDate || new Date();
      const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2], 0);
      // 日付をまたぐ（23:50 に「00:10 開演」など）。夏時間の日でもずれないよう日付で進める
      if (target - d < -12 * 3600 * 1000) target.setDate(target.getDate() + 1);
      let sec = Math.ceil((target - d) / 1000);
      if (sec <= 0 || sec > 6 * 3600) return '';
      const h = Math.floor(sec / 3600); sec -= h * 3600;
      const mm = Math.floor(sec / 60), ss = sec % 60;
      const pad = (x) => String(x).padStart(2, '0');
      return t('開演まで {0}', h ? `${h}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`);
    }

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
        const hit = ((fl & 1) && f.kick >= 0.5) || ((fl & 2) && f.snare >= 0.5) || (fl & 8) || ((fl & 32) && f.beatConf >= 0.4);
        if (hit || now >= s.pending.deadline || !f.active) this._applyScene(s.pending.id);
      }

      // オート
      const a = s.sceneId === 'test' ? null : this.director.update(this, f, now);
      if (a) {
        if (a.scene && a.scene !== s.sceneId && this.sceneAvailable(a.scene)) this._applyScene(a.scene);
        if (a.palette) this.cyclePalette(1, true);
      }

      // 自動フラッシュ・ストロボ・インパクト
      if (fl & (8 | 16)) this.flash(fl & 16 ? 0.7 : 0.45, 'auto');
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

      // フェードアウト中の前のシーン（同じシーンに戻ったときは前の状態を作り直しているので止める）
      const x = this.xfade;
      if (x && (now - x.t0 >= x.dur || x.id === s.sceneId)) this.xfade = null;
      else if (x) {
        const xd = VJ.scenes.byId[x.id], xs = this.sceneStates[x.id] || (this.sceneStates[x.id] = {});
        this.fxQuiet.param = this.sceneParams(xd, this.fxQuiet.param);
        try { x.uniforms = xd.update(xs, f, dt, this.fxQuiet) || null; } catch (e) { this.xfade = null; }
      }

      // シーンの JS 側
      const def = VJ.scenes.byId[s.sceneId];
      const st = this.sceneStates[s.sceneId] || (this.sceneStates[s.sceneId] = {});
      this.fx.param = this.sceneParams(def, this.fx.param);
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

    /** 動きの大きさを掛けた特徴量（オブジェクトは使い回す） */
    _scaled(f) {
      const k = this.react();
      if (Math.abs(k - 1) < 1e-3) return f;
      const g = this._sf || (this._sf = { kickEv: new Float32Array(f.kickEv.length), snareEv: new Float32Array(f.snareEv.length), accentEv: new Float32Array(f.accentEv.length) });
      for (const key in f) {
        const v = f[key];
        if (typeof v !== 'object') g[key] = v;
        else if (key !== 'kickEv' && key !== 'snareEv' && key !== 'accentEv') g[key] = v;
      }
      for (const t of ['kick', 'snare', 'hat', 'accent']) g[t] = Math.min(1, f[t] * k);
      for (const t of ['kickEv', 'snareEv', 'accentEv']) {
        const a = f[t], b = g[t];
        for (let i = 0; i < a.length; i += 2) { b[i] = a[i]; b[i + 1] = Math.min(1, a[i + 1] * k); }
      }
      g.level = Math.min(1, f.level * (0.6 + 0.4 * k));
      return g;
    }

    /** レンダラーに渡すフレーム情報（オブジェクトは使い回す） */
    frame(f, dt, getText) {
      const s = this.state, fr = this._fr || (this._fr = {});
      fr.scene = VJ.scenes.byId[s.sceneId];
      fr.uniforms = s.uniforms;
      fr.f = this._scaled(f);
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
      fr.impact = s.impact * Math.min(1, this.react());
      const ta = this.textAlpha();
      if (ta > 0 && getText) {
        const t = fr._text || (fr._text = { tex: null, alpha: 0 });
        t.tex = getText(s.text.main, s.text.sub).tex;
        t.alpha = ta;
        fr.text = t;
      } else {
        fr.text = null;
      }
      const ma = this.msgAlpha();
      if (ma > 0 && getText) {
        const t = fr._text2 || (fr._text2 = { tex: null, alpha: 0 });
        t.tex = getText(s.msg.text, '').tex;
        t.alpha = ma;
        fr.text2 = t;
      } else {
        fr.text2 = null;
      }
      const logo = this.settings.logo ? this.settings.logoMode : 'off';
      const isTitle = s.sceneId === 'title';
      fr.titleLogo = isTitle && !s.endState && (logo === 'title' || logo === 'both');
      // バンド名の文字：タイトルと、文字を使うシーン（声の輪など。def.title）で
      const usesTitle = isTitle || fr.scene.title || (this.xfade && VJ.scenes.byId[this.xfade.id] && (this.xfade.id === 'title' || VJ.scenes.byId[this.xfade.id].title));
      fr.titleTex = usesTitle && getText ? getText(this.titleText(), this.countdownText()).tex : null;
      fr.logoCorner = (logo === 'corner' || (logo === 'both' && !isTitle)) && s.sceneId !== 'test' ? this.settings.logoCorner || 'br' : '';
      fr.latSq = this.settings.latencySquare ? s.latSq : -1;
      fr.vignette = s.sceneId === 'test' ? 0 : 0.6;
      fr.param = this.sceneParams(fr.scene, fr.param);
      const x = this.xfade;
      if (x) {
        const xf = fr._xf || (fr._xf = { scene: null, uniforms: null, param: null, sceneTime: 0, mix: 0, titleLogo: false });
        xf.scene = VJ.scenes.byId[x.id];
        xf.uniforms = x.uniforms;
        xf.param = this.sceneParams(xf.scene, xf.param);
        xf.sceneTime = this.now - x.start;
        xf.mix = this._xmix(x);
        // タイトルからのフェードアウト中もロゴのまま（文字に変わらない）
        xf.titleLogo = x.id === 'title' && !s.endState && (logo === 'title' || logo === 'both');
        fr.xfade = xf;
      } else {
        fr.xfade = null;
      }
      return fr;
    }
  }

  VJ.ShowController = ShowController;
})(globalThis.VJ = globalThis.VJ || {});
