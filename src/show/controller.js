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

  /** 激しさ（設定 intensity）ごとの演出の強さ
   *  react：動きの大きさに掛ける / punch：キックで画面ごと寄る・スネアで揺れる・色ずれ（明るさは変えない）
   *  beat：拍ごとの軽いフラッシュ（0 なし / 1 強いキック・スネア / 2 中くらいから）/ accent：キメのフラッシュの強さ
   *  switchK：オートの切替間隔に掛ける */
  const INTENSITY = [
    { react: 0.8, punch: 0, beat: 0, accent: [0.35, 0.6], switchK: 1.3 }, // 控えめ
    { react: 1.0, punch: 0, beat: 0, accent: [0.45, 0.7], switchK: 1.0 }, // ふつう（以前と同じ）
    { react: 1.25, punch: 1.0, beat: 1, accent: [0.6, 0.85], switchK: 0.7 }, // 激しい（既定）
    { react: 1.5, punch: 1.6, beat: 2, accent: [0.75, 0.95], switchK: 0.5 }, // 最大
  ];

  /** パレットの自動で使う色（盛り上がりごと）。モノクロとカスタムは使わない */
  const PAL_TIERS = { low: ['ocean', 'sakura', 'sunset'], mid: ['neon', 'sunset', 'ocean', 'sakura', 'acid'], high: ['neon', 'fire', 'acid', 'sunset'] };
  const PAL_SEC = 26; // パレットの自動：この秒数たってから、次の曲の区切りで変える（激しさで伸び縮み）
  const PAL_FADE = 1.5; // 自動で変えるときは、この秒数かけて色を移す
  const OV_MAX = 0.6; // オーバーレイで重ねるシーンの強さの上限（「シーンの濃さ」100% のとき）
  const OV_FADE = 0.35; // オーバーレイを出す・消すのにかける時間（秒）

  // シーン切替の種類（仕上げのシェーダの u_trans の番号と同じ順）
  const TRANSITIONS = ['fade', 'wipe', 'iris', 'blinds', 'zoom', 'slide', 'glitch', 'mosaic'];

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
      this._palFrom = new Float32Array(12);
      this._palTo = new Float32Array(12);
      this._palMix = 1; // 色を移している途中（0 → 1）
      this._palAt = 0; // 最後にパレットが変わった時刻
      // オーバーレイの見え方（出す・消すをなめらかに）。起動したときは設定どおりの状態から
      this._ovA = { scene: 0, media: settings.overlayOn ? 1 : 0, text: settings.overlay && settings.overlay.textOn ? 1 : 0 };
      this._palRng = VJ.util.rng(4321);
      // 激しさの自動：いまの段階（0 控えめ〜3 最大。小数あり）と、そこから作った 1 行
      this.autoLv = 2;
      this._intLv = 2;
      this._autoI = { react: 1.25, punch: 1, beat: 1, accent: [0.6, 0.85], switchK: 0.7 };
      this.state = {
        sceneId: 'title', pending: null, sceneStart: 0,
        paletteIdx: settings.paletteIdx | 0,
        blackout: false, black: 0,
        master: settings.master, sens: settings.sensitivity | 0,
        auto: !!settings.auto, locked: false,
        songIdx: -1, endState: false,
        flash: 0, flashColor: [1, 1, 1], impact: 0, strobe: false,
        punch: 0, shake: 0, shakeX: 0, shakeY: 0, rgb: 0, // 激しさ：キックで寄る・スネアで揺れる・色ずれ
        intLv: 2, // いまの激しさの段階（0〜3。自動のときは曲に合わせて動く）
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
      // settings.paletteIdx は常に「いま使っているパレット」（曲ごとのパレットも反映される）。
      // 変わったとき（バンドの色など）は自動の色替えの時計も戻す（すぐに上書きしないように）。
      // 同じ色のまま（ほかの設定の変更）なら、色を移している途中を止めない
      const pi = s.paletteIdx | 0;
      this.profile = VJ.profileById(s.profile);
      this.limiter.setLimit(s.flashLimit === undefined ? VJ.flashConfig.maxPerSec : s.flashLimit);
      if (pi !== this.state.paletteIdx || this._palMix >= 1) {
        if (pi !== this.state.paletteIdx) this._palAt = this.now;
        this.state.paletteIdx = pi;
        this._palette();
      } else {
        this._palette(false, true);
      }
      if (this.onSensitivity) this.onSensitivity(this.state.sens);
    }
    /** 自動のフラッシュ（キメ・ブレイク明け・シーンの反転など）を使うか */
    autoFlashOn() { return !!this.settings.autoFlash && this.profile.show.autoFlash !== false && !this.settings.noFlash; }
    /** オートで使ってよいシーンか */
    autoAllowed(id) {
      const def = VJ.scenes.byId[id];
      return !!def && !def.hidden && id !== 'title' && this.sceneAvailable(id) && !(this.settings.autoScenes && this.settings.autoScenes[id] === false);
    }
    /** 激しさが自動か（設定 intensity が -1） */
    intensityAuto() { return +this.settings.intensity < 0; }
    /** 激しさ（INTENSITY の 1 行。自動のときは曲の盛り上がりに合わせて段階の間をなめらかに動いた値） */
    intensity() {
      if (this.intensityAuto()) return this._autoI;
      return INTENSITY[clamp(Math.round(this.settings.intensity === undefined ? 2 : +this.settings.intensity), 0, 3)];
    }
    /** 激しさの自動：盛り上がり（f.intensity）を追って 0（控えめ）〜3（最大）へ。無音・話し声では控えめへ */
    _autoIntensity(f, dt) {
      const target = !f.active || f.speech ? 0 : 3 * clamp(((f.intensity || 0) - 0.18) / 0.6, 0, 1);
      // 上がるのは速く（サビに入ったらすぐ）、下がるのはゆっくり
      this.autoLv += (target - this.autoLv) * Math.min(1, dt / (target > this.autoLv ? 1.2 : 4));
      const lv = this.autoLv, i = Math.min(2, Math.floor(lv)), u = lv - i, a = INTENSITY[i], b = INTENSITY[i + 1], o = this._autoI;
      const mix = (x, y) => x + (y - x) * u;
      o.react = mix(a.react, b.react);
      o.punch = mix(a.punch, b.punch);
      o.switchK = mix(a.switchK, b.switchK);
      o.accent[0] = mix(a.accent[0], b.accent[0]);
      o.accent[1] = mix(a.accent[1], b.accent[1]);
      // 拍ごとの軽いフラッシュは段階で決まるので、境目で行き来しないよう 0.7 段ぶん動いてから切り替える
      if (Math.abs(lv - this._intLv) > 0.7) this._intLv = Math.round(lv);
      o.beat = INTENSITY[this._intLv].beat;
    }
    /** 動きの大きさ（設定 × 音楽タイプの基準 × 激しさ） */
    react() { return VJ.util.clamp((+this.settings.react || 1) * (this.profile.show.react || 1) * this.intensity().react, 0.2, 2); }
    /** キックで寄る・揺れるの強さ（激しさ × 音楽タイプ。しっとり系・司会では弱く／なし。フラッシュを一切使わない会場ではしない） */
    punchAmount() {
      if (this.settings.noFlash) return 0;
      const p = this.profile.show.punch;
      return this.intensity().punch * (p === undefined ? 1 : p);
    }
    /** オートの切替間隔に掛ける数（激しいほど短く） */
    switchK() { return this.intensity().switchK; }
    get auto() { return this.state.auto; }
    bandName() { return (this.setlist && this.setlist.band) || this.settings.bandName || ''; }
    endText() { return (this.setlist && this.setlist.end) || this.settings.endText || 'Thank you!'; }
    currentSong() {
      const i = this.state.songIdx;
      return !this.state.endState && i >= 0 && this.setlist && this.setlist.songs[i] ? this.setlist.songs[i] : null;
    }
    /** パレットの色を反映。smooth = true なら PAL_FADE 秒かけて移す（自動で変わるとき）。keep = true は移している途中のまま、行き先だけ直す */
    _palette(smooth, keep) {
      VJ.paletteFloat(VJ.paletteColors(this.state.paletteIdx, this.settings.customPalette), this._palTo);
      if (keep) { /* 行き先だけ */ } else if (smooth) { this._palFrom.set(this.palFloat); this._palMix = 0; } else { this.palFloat.set(this._palTo); this._palMix = 1; }
      const c = [this._palTo[9], this._palTo[10], this._palTo[11]];
      // フラッシュ色はパレットの 4 色目を白寄りに（赤系は白へ）
      this.state.flashColor = VJ.safety.safeFlashColor(c.map((v) => 0.55 + 0.45 * v));
    }

    // ---- シーン ----------------------------------------------------------
    /** シーンの調整値（設定パネルのスライダー）。out は使い回す Float32Array(4) */
    sceneParams(def, out) { return VJ.scenes.paramValues(def, this.settings.sceneParams && this.settings.sceneParams[def.id], out); }

    /** 切替の種類（crossfade が 0 より大きいとき）。「おまかせ」は毎回変える（同じものが続かないように） */
    transitionType() {
      if (+this.settings.crossfade < 0) return 'fade'; // 音楽のタイプに合わせる：フェード
      const t = this.settings.transition || 'fade';
      if (t !== 'random') return TRANSITIONS.includes(t) ? t : 'fade';
      this._tk = (this._tk || 0) + 1;
      const i = Math.floor(VJ.util.hash(this._tk * 7 + 3) * (TRANSITIONS.length - 1));
      const pick = TRANSITIONS[i >= TRANSITIONS.indexOf(this._tLast) ? i + 1 : i];
      this._tLast = pick;
      return pick;
    }

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
        // 種類（ワイプなど）。途中で切り替えたときは、続きをフェードにする（絵の一部だけが急に変わらないように）
        const type = px && px.id !== prev ? 'fade' : this.transitionType();
        this._seedN = (this._seedN || 0) + 1;
        this.xfade = Object.assign(out, { t0: this.now, dur, type, seed: VJ.util.hash(this._seedN * 31 + 17) });
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
      // 曲のメディア（m:…）は、ここからの設定の変更で「操作者が選んだ」と見る
      this._mediaManual = false;
      this._mediaSigAt = this._mediaSig();
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
        if (!opts.quiet) this._toast(t('シーン: {0}', name)); // quiet：キューから（キューの名前を出す）
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
      // 曲にメディアの指定（m:…）があれば出す。曲の途中で操作者がメディアを選んだら、次の曲まではそちらを出す
      this._mediaManual = false;
      this._mediaSigAt = this._mediaSig();
      const sm = song.media ? VJ.mediaLib.find(this.settings, song.media) : null;
      if (sm && !sm.off) this.settings.overlayOn = true;
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
      if ((src === 'auto' || src === 'beat' || src === 'kaleido-reset' || src === 'glitch-invert') && !this.autoFlashOn()) return false;
      // 拍ごとの軽いフラッシュは、上限のうち 1 回分をキメ・手動のために残す
      if (!this.limiter.allow(this.now, src === 'beat' ? 1 : 0)) return false;
      if (strength > 0) this.state.flash = Math.max(this.state.flash, strength);
      return true;
    }
    setStrobe(on) { this.state.strobe = !!on; }
    toggleBlackout() { this.setBlackout(!this.state.blackout); }
    setBlackout(on) {
      this.state.blackout = !!on;
      this._toast(on ? t('暗転') : t('暗転解除'));
    }
    /** パレットを指定（設定にも反映）。smooth = true は自動の切替（ゆっくり色を移す） */
    setPalette(i, smooth) {
      const n = VJ.palettes.length;
      this.state.paletteIdx = ((Math.round(+i || 0) % n) + n) % n;
      this.settings.paletteIdx = this.state.paletteIdx;
      this._palAt = this.now;
      this._palette(!!smooth);
    }
    /** パレットの自動：前に変わってから PAL_SEC 秒たち、曲の区切り（キメ・ブレイク明け → 小節の頭 → キック）が
     *  来たら、盛り上がりに合った色へ。曲に色の指定があるとき・無音・話し声の間は変えない */
    _autoPalette(f, now) {
      const song = this.currentSong();
      if (!f.active || f.speech || (song && song.palette !== null)) return;
      const since = now - this._palAt, P = PAL_SEC * this.switchK(), fl = f.onsetFlags;
      const trigger = (since >= P && (fl & (8 | 16))) || (since >= P + 5 && (fl & 64) && f.beatConf >= 0.35) || (since >= P + 12 && (fl & 1));
      if (!trigger) return;
      const tier = f.intensity > 0.66 ? PAL_TIERS.high : f.intensity > 0.33 ? PAL_TIERS.mid : PAL_TIERS.low;
      const cur = VJ.palettes[this.state.paletteIdx].id;
      const cands = tier.filter((id) => id !== cur);
      const id = cands[Math.floor(this._palRng() * cands.length)];
      this.setPalette(VJ.palettes.findIndex((p) => p.id === id), true);
    }
    cyclePalette(d, silent) {
      const n = VJ.palettes.length;
      this.state.paletteIdx = (((this.state.paletteIdx + d) % n) + n) % n;
      this.settings.paletteIdx = this.state.paletteIdx;
      this._palAt = this.now;
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
    /** いま出すメディア：曲の指定（セットリストの m:…）→ メディアの一覧から選んだもの → 設定のメディア。
     *  { kind: image / video / capture / web / camera / '', image（data URL）, key（保存場所の鍵）, url, cameraId, mirror, name, song } */
    effectiveMedia() {
      const s = this.settings, o = s.overlay || {};
      const song = this.currentSong();
      // 曲が始まってから設定のメディアが変わった（パネルで選んだ・キュー）→ 次の曲までは曲の指定より優先
      if (!this._mediaManual && this._mediaSigAt !== undefined && this._mediaSig() !== this._mediaSigAt) this._mediaManual = true;
      let it = song && song.media && !this._mediaManual ? VJ.mediaLib.find(s, song.media) : null;
      if (it && it.off) return { kind: '', song: true };
      const fromSong = !!it;
      if (!it && o.mediaKind === 'lib') it = VJ.mediaLib.byId(s, o.libId);
      if (it) return { kind: it.kind, image: '', key: it.key || '', url: it.url || '', cameraId: it.cameraId || '', mirror: !!it.mirror, name: it.name, song: fromSong };
      if (o.mediaKind === 'lib') return { kind: '' }; // 一覧から消えた
      const kind = o.mediaKind || 'image';
      return { kind, image: o.image || '', key: kind === 'video' ? o.videoKey || '' : '', url: o.webUrl || '', cameraId: o.cameraId || '', mirror: !!o.cameraMirror, name: '', song: false };
    }
    /** 設定のメディア（どれを出すか）の目印。出す・消す（overlayOn）は含めない */
    _mediaSig() {
      const o = this.settings.overlay || {};
      return [o.mediaKind, o.libId, (o.image || '').length, (o.image || '').slice(-16), o.videoKey, o.webUrl, o.cameraId, !!o.cameraMirror].join('|');
    }
    /** 操作者がメディアを選んだ（一覧の ▶・キュー）：この曲の m:… より優先する（次の曲で戻る） */
    overrideSongMedia() { this._mediaManual = true; }
    /** メディアのオーバーレイ（画像・動画・画面の取り込み・YouTube / ニコニコ）を出す・消す（O） */
    toggleOverlay() { this.setOverlay(!this.settings.overlayOn); }
    /** メディアを出す / 消す（スマホ・OSC・キューの「出す」から）。曲の指定が「出さない」（m:off）でも、出すときは設定のメディアを出す */
    setOverlay(on) {
      on = !!on;
      if (on) {
        const e = this.effectiveMedia();
        if (e.song && !e.kind) this._mediaManual = true;
      }
      if (on === !!this.settings.overlayOn) return;
      this.settings.overlayOn = on;
      this._toast(on ? t('メディア: ON') : t('メディア: OFF'));
    }
    /** シーンのオーバーレイ（別のシーンを重ねる）を出す・消す（Shift+O） */
    toggleSceneOverlay() {
      this.settings.ovSceneOn = !this.settings.ovSceneOn;
      const o = this.settings.overlay;
      if (this.settings.ovSceneOn && !(o && o.scene)) this._toast(t('重ねるシーンが選ばれていません（⑤ のシーンのオーバーレイ）'), 'warn');
      else this._toast(this.settings.ovSceneOn ? t('シーンの重ね: ON') : t('シーンの重ね: OFF'));
    }
    /** オーバーレイで重ねるシーン（無い・使えない・いまのシーンと同じ・テストパターン中は null） */
    overlayScene() {
      const o = this.settings.overlay, id = o && o.scene, s = this.state;
      if (!this.settings.ovSceneOn || !id || id === s.sceneId || s.sceneId === 'test' || !(o.sceneOpacity > 0)) return null;
      const def = VJ.scenes.byId[id];
      return def && !def.hidden && this.sceneAvailable(id) ? def : null;
    }
    /** オーバーレイの文字：[下の大きい行, 上の小さい行]。時計・バンド名は上、曲名・自由な文字は下（下が無ければ上を大きく） */
    overlayText(nowDate, fading) {
      const o = this.settings.overlay;
      if (!o || (!o.textOn && !fading)) return ['', ''];
      const top = [], main = [], pad = (x) => String(x).padStart(2, '0');
      if (o.clock) { const d = nowDate || new Date(); top.push(`${pad(d.getHours())}:${pad(d.getMinutes())}`); }
      if (o.band && this.bandName()) top.push(this.bandName());
      const song = this.currentSong();
      if (o.song && song) main.push(`M${this.state.songIdx + 1} ${song.title}`);
      if (o.text) main.push(String(o.text).slice(0, 60));
      const a = top.join('　'), b = main.join('　');
      return b ? [b, a] : [a, ''];
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
      s.punch *= Math.exp(-dt / 0.11);
      s.shake *= Math.exp(-dt / 0.09);
      s.rgb *= Math.exp(-dt / 0.12);
      s.travel += (0.15 + 0.85 * f.level) * dt;
      const idleT = !f.active || f.silenceSec > 2.5 ? 1 : 0;
      s.idle += (idleT - s.idle) * Math.min(1, dt / 1.0);

      // 予約された切替：次のビート（キック/スネア/アクセント）で
      if (s.pending) {
        const hit = ((fl & 1) && f.kick >= 0.5) || ((fl & 2) && f.snare >= 0.5) || (fl & 8) || ((fl & 32) && f.beatConf >= 0.4);
        if (hit || now >= s.pending.deadline || !f.active) this._applyScene(s.pending.id);
      }

      // 激しさ・パレットの自動
      if (this.intensityAuto()) { this._autoIntensity(f, dt); s.intLv = this._intLv; } else s.intLv = clamp(Math.round(this.settings.intensity === undefined ? 2 : +this.settings.intensity), 0, 3);
      if (this._palMix < 1) {
        this._palMix = Math.min(1, this._palMix + dt / PAL_FADE);
        const u = this._palMix * this._palMix * (3 - 2 * this._palMix);
        for (let i = 0; i < 12; i++) this.palFloat[i] = this._palFrom[i] + (this._palTo[i] - this._palFrom[i]) * u;
      }
      if (this.settings.paletteAuto && s.sceneId !== 'test') this._autoPalette(f, now);

      // オート
      const a = s.sceneId === 'test' ? null : this.director.update(this, f, now);
      if (a) {
        if (a.scene && a.scene !== s.sceneId && this.sceneAvailable(a.scene)) this._applyScene(a.scene);
        if (a.palette) this.cyclePalette(1, true);
      }

      // 自動フラッシュ・ストロボ・インパクト
      const I = this.intensity();
      if (fl & (8 | 16)) this.flash(fl & 16 ? I.accent[1] : I.accent[0], 'auto');
      else if (I.beat && !f.speech) {
        // 拍ごとの軽いフラッシュ（激しい・最大）：強いキック・スネアで
        const lo = I.beat >= 2 ? 0.55 : 0.75;
        if ((fl & 2) && f.snare >= lo + 0.05) this.flash(I.beat >= 2 ? 0.35 : 0.26, 'beat');
        else if ((fl & 1) && f.kick >= lo) this.flash(I.beat >= 2 ? 0.3 : 0.2, 'beat');
      }
      if (s.strobe && (fl & 3)) this.flash(0.65, 'strobe');
      if (fl & 16) s.impact = 1;
      else if (fl & 8) s.impact = Math.max(s.impact, 0.6);
      // キックで画面ごと寄る・スネアで揺れる・色ずれ（明るさは変えないのでフラッシュの制限の対象外）
      const P = this.punchAmount();
      if (P > 0 && !f.speech) {
        if ((fl & 1) && f.kick >= 0.35) s.punch = Math.max(s.punch, Math.min(1, f.kick));
        const hit = fl & (8 | 16) ? 1 : (fl & 2) && f.snare >= 0.35 ? Math.min(1, f.snare) : 0;
        if (hit) {
          s.shake = Math.max(s.shake, hit);
          this._shakeA = ((this._shakeA || 0) + 2.39996) % (Math.PI * 2); // 毎回ちがう向き（黄金角ずつ回す。テストで再現できるように乱数は使わない）
          s.shakeX = Math.cos(this._shakeA);
          s.shakeY = Math.sin(this._shakeA);
          s.rgb = Math.max(s.rgb, hit);
        }
        if (fl & (8 | 16)) s.punch = 1;
      }

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

      // オーバーレイで重ねるシーン（フラッシュは出させない）。選び直したら状態を作り直す
      // 出す・消すは 0.35 秒でなめらかに（O の連打でも、全画面の明るさが急に変わらないように）。消える間も動かし続ける
      const A = this._ovA, k = dt / OV_FADE, testing = s.sceneId === 'test';
      const od0 = this.overlayScene();
      A.scene = testing ? 0 : clamp(A.scene + (od0 ? k : -k), 0, 1);
      A.media = testing ? 0 : clamp(A.media + (this.settings.overlayOn ? k : -k), 0, 1);
      A.text = testing ? 0 : clamp(A.text + (this.settings.overlay && this.settings.overlay.textOn ? k : -k), 0, 1);
      const od = od0 || (A.scene > 0 && this._ov ? VJ.scenes.byId[this._ov.id] : null);
      if (!od) this._ov = null;
      else {
        if (!this._ov || this._ov.id !== od.id) { const st0 = {}; od.init(st0); this._ov = { id: od.id, st: st0, start: now, uniforms: null, param: null }; }
        this._ovFx = this._ovFx || { requestFlash: () => false, param: null };
        this._ovFx.param = this.sceneParams(od, this._ovFx.param);
        try { this._ov.uniforms = od.update(this._ov.st, f, dt, this._ovFx) || null; } catch (e) { this._ov = null; }
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

    /** タイトルの下の小さな文字：開演までのカウントダウン。出演バンドが複数あるときは「次の出演」、
     *  終演のあとは「次は ○○」 */
    titleSub(nowDate) {
      const cd = this.countdownText(nowDate);
      if (cd) return cd;
      const s = this.settings, n = Array.isArray(s.bands) ? s.bands.length : 0;
      if (n < 2 || !VJ.bands) return '';
      if (this.state.endState) {
        const next = (s.bandIdx | 0) + 1 < n ? VJ.bands.nameOf(s, (s.bandIdx | 0) + 1) : '';
        return next ? t('次は {0}', next) : '';
      }
      // 「次の出演」は 1 曲目の前だけ（セットリストの無いバンドは演奏中も曲が始まらないので出さない）
      return this.state.songIdx < 0 && this.setlist.songs.length ? t('次の出演') : '';
    }

    /** 出演バンドを切り替えたとき：開演前（タイトル）に戻す */
    resetShow() {
      const s = this.state;
      s.songIdx = -1;
      s.endState = false;
      s.text = null;
      s.msg = null;
      s.pending = null;
      s.beforeTest = null;
      this.director.silentFrom = null;
      this._applyScene('title');
      this._toast(t('出演：{0}', this.bandName() || '—'));
      return true;
    }

    /** 動きの大きさを掛けた特徴量（オブジェクトは使い回す） */
    _scaled(f) {
      const k = this.react();
      if (Math.abs(k - 1) < 1e-3) return f;
      const g = this._sf || (this._sf = {});
      for (const key in f) {
        const v = f[key];
        if (typeof v !== 'object') g[key] = v;
        else if (key !== 'kickEv' && key !== 'snareEv' && key !== 'accentEv') g[key] = v;
      }
      for (const t of ['kick', 'snare', 'hat', 'accent']) g[t] = Math.min(1, (f[t] || 0) * k);
      for (const t of ['kickEv', 'snareEv', 'accentEv']) {
        const a = f[t];
        if (!a) continue;
        const b = g[t] && g[t].length === a.length ? g[t] : (g[t] = new Float32Array(a.length));
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
      // 激しさ：寄り（拡大率）・揺れ（画面の高さに対する割合）・色ずれ。テストパターン（位置合わせ）では動かさない
      const P = s.sceneId === 'test' ? 0 : this.punchAmount();
      fr.punch = 0.06 * P * s.punch;
      fr.shakeX = 0.012 * P * s.shake * s.shakeX;
      fr.shakeY = 0.012 * P * s.shake * s.shakeY;
      fr.rgb = 0.018 * P * Math.max(s.rgb, s.punch * 0.4);
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
      const ovd = this._ov && VJ.scenes.byId[this._ov.id];
      const usesTitle = isTitle || fr.scene.title || (this.xfade && VJ.scenes.byId[this.xfade.id] && (this.xfade.id === 'title' || VJ.scenes.byId[this.xfade.id].title))
        || (ovd && (ovd.id === 'title' || ovd.title)); // 重ねるシーンがバンド名を使うときも
      fr.titleTex = usesTitle && getText ? getText(this.titleText(), this.titleSub()).tex : null;
      fr.logoCorner = (logo === 'corner' || (logo === 'both' && !isTitle)) && s.sceneId !== 'test' ? this.settings.logoCorner || 'br' : '';
      fr.latSq = this.settings.latencySquare ? s.latSq : -1;
      fr.vignette = s.sceneId === 'test' ? 0 : 0.6;
      fr.param = this.sceneParams(fr.scene, fr.param);
      // オーバーレイ（テストパターン中は出さない）。シーン・メディア・文字は別々に ON/OFF
      const o = this.settings.overlay, ovOn = !!o && s.sceneId !== 'test';
      const ovs = this._ov;
      if (ovOn && ovs && VJ.scenes.byId[ovs.id]) {
        const ov = fr._ov || (fr._ov = { scene: null, uniforms: null, param: null, sceneTime: 0, mix: 0, mode: 'screen' });
        ov.scene = VJ.scenes.byId[ovs.id];
        ov.uniforms = ovs.uniforms;
        ov.param = this.sceneParams(ov.scene, ov.param);
        ov.sceneTime = this.now - ovs.start;
        // 光過敏対策：動きの激しいシーンどうしをそのまま足すと、領域の明るさの変化が 1 秒 3 回を超えることがある
        // （実測）ので、重ねる強さは OV_MAX まで。フラッシュの上限を自分で上げているときは、そのまま足す
        // 「フラッシュを一切使わない」ときは、上限を上げていても OV_MAX まで
        ov.mix = clamp(+o.sceneOpacity || 0, 0, 1) * (!this.settings.noFlash && VJ.safety.overSafe(this.settings.flashLimit) ? 1 : OV_MAX) * this._ovA.scene;
        ov.mode = o.sceneBlend;
        fr.overlay = ov;
      } else {
        fr.overlay = null;
      }
      // メディア：画像・動画・画面の取り込み・カメラは仕上げで重ねる。YouTube / ニコニコは media.js がキャンバスの上に重ねる
      const eff = ovOn ? this.effectiveMedia() : null;
      const kind = eff ? eff.kind : '';
      const mA = this._ovA.media;
      const mediaOn = ovOn && mA > 0.001 && o.imageOpacity > 0;
      if (mediaOn && (kind === 'image' ? !!(eff.image || eff.key) : kind === 'video' || kind === 'capture' || kind === 'camera')) {
        const oi = fr._oi || (fr._oi = { alpha: 0, fit: 'contain', mode: 'normal', mirror: false });
        oi.alpha = clamp(+o.imageOpacity || 0, 0, 1) * mA;
        oi.fit = o.imageFit;
        oi.mode = o.imageBlend;
        oi.mirror = kind === 'camera' && !!eff.mirror;
        fr.ovImage = oi;
      } else {
        fr.ovImage = null;
      }
      if (mediaOn && kind === 'web' && eff.url) {
        const ow = fr._ow || (fr._ow = { alpha: 0 });
        ow.alpha = clamp(+o.imageOpacity || 0, 0, 1) * mA;
        fr.ovWeb = ow;
      } else {
        fr.ovWeb = null;
      }
      const ot = ovOn && getText && this._ovA.text > 0.001 ? this.overlayText(undefined, true) : null;
      if (ot && ot[0] && o.textOpacity > 0) {
        const t3 = fr._text3 || (fr._text3 = { tex: null, alpha: 0, corner: 'tr', size: 1 });
        t3.corner = o.corner;
        t3.tex = getText(ot[0], ot[1], t3.corner[1] === 'l' ? 'left' : 'right').tex;
        t3.alpha = clamp(+o.textOpacity || 0, 0, 1) * this._ovA.text;
        t3.size = o.textSize || 1;
        fr.text3 = t3;
      } else {
        fr.text3 = null;
      }
      const x = this.xfade;
      if (x) {
        const xf = fr._xf || (fr._xf = { scene: null, uniforms: null, param: null, sceneTime: 0, mix: 0, titleLogo: false });
        xf.scene = VJ.scenes.byId[x.id];
        xf.uniforms = x.uniforms;
        xf.param = this.sceneParams(xf.scene, xf.param);
        xf.sceneTime = this.now - x.start;
        xf.mix = this._xmix(x);
        xf.type = x.type || 'fade';
        xf.seed = x.seed || 0;
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
  VJ.ShowController.TRANSITIONS = TRANSITIONS;
})(globalThis.VJ = globalThis.VJ || {});
