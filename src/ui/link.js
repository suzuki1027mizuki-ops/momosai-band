/* 出力ウィンドウ（2 画面運用）。
 *   操作ウィンドウ（この画面）… パネル・キー・MIDI・メーター表示。描画と音声解析は止める
 *   出力ウィンドウ（?role=output）… 音声入力・解析・描画を担当（遅延は 1 画面のときと同じ）
 * 操作ウィンドウでは app.show / app.engine を「リモコン」に差し替え、操作は postMessage で出力側へ送る。
 * 出力側は 1 秒に 10 回、状態（シーン・曲・メーター・ヒット・テンポ・HUD）を送り返す。
 * 出力ウィンドウを閉じると、操作ウィンドウは元の 1 画面の動作に戻る。 */
(function (VJ) {
  'use strict';

  const SHOW_METHODS = ['selectScene', 'nextSong', 'prevSong', 'flash', 'setStrobe', 'toggleBlackout', 'setBlackout', 'cyclePalette',
    'nudgeSensitivity', 'nudgeMaster', 'toggleAuto', 'lock', 'unlock', 'showSongTitle', 'tap', 'toggleMessage', 'showMessage',
    'toggleTestPattern', 'restoreSession', 'setMaster', 'setSensitivity', 'setPalette', 'resetShow', 'toggleOverlay', 'setOverlay', 'toggleSceneOverlay', 'overrideSongMedia'];
  // 出力側から操作側へ反映してよい設定（型も確認する）
  const PATCH_KEYS = { paletteIdx: 'number', sensitivity: 'number', master: 'number', auto: 'boolean', overlayOn: 'boolean', ovSceneOn: 'boolean' };

  // ---------------------------------------------------------------- 操作側のリモコン
  class RemoteShow {
    constructor(link, settings) {
      this.link = link;
      this.settings = settings;
      this.state = { sceneId: 'title', locked: false, songIdx: -1, endState: false, auto: !!settings.auto, sens: 0, master: 1, paletteIdx: 0, blackout: false, pending: null, intLv: 2 };
      this.limiter = { denied: 0 };
      this.listeners = [];
      this.applySettings(settings);
      for (const m of SHOW_METHODS) {
        this[m] = (...args) => { this.link.send({ t: 'cmd', target: 'show', name: m, args }); return true; };
      }
    }
    on(fn) { this.listeners.push(fn); }
    applySettings(s) {
      this.settings = s;
      this.setlist = VJ.setlist.parse(s.setlistText);
      this.profile = VJ.profileById(s.profile);
    }
    currentSong() {
      const i = this.state.songIdx;
      return !this.state.endState && i >= 0 && this.setlist.songs[i] ? this.setlist.songs[i] : null;
    }
    react() { return VJ.util.clamp((+this.settings.react || 1) * (this.profile.show.react || 1), 0.2, 1.6); }
    bandName() { return (this.setlist && this.setlist.band) || this.settings.bandName || ''; }
    endText() { return (this.setlist && this.setlist.end) || this.settings.endText || 'Thank you!'; }
    session() { return { songIdx: this.state.songIdx, endState: this.state.endState, sceneId: this.state.sceneId, paletteIdx: this.state.paletteIdx, t: Date.now() }; }
  }

  class RemoteEngine {
    constructor(link) {
      this.link = link;
      this.status = 'idle';
      this.message = '';
      this.opts = { source: 'mic', deviceId: '', deviceLabel: '', channel: 'mix', monitor: true };
      this.meter = { l: -120, r: -120, lPeak: -120, rPeak: -120, clip: 0, mono: false };
      this.diag = { status: 'idle', sampleRate: 0, channels: 0, device: '', chunk: 0, chunkMax: 0, align: 0, alignMiss: 0, gaps: 0, restarts: 0, reconnects: 0 };
      this.listeners = [];
      this.ctx = null;
    }
    get running() { return this.status === 'running'; }
    get sampleRate() { return this.diag.sampleRate || 48000; }
    on(fn) { this.listeners.push(fn); }
    _set(st, msg) { this.status = st; this.message = msg || ''; for (const fn of this.listeners) { try { fn(st, this.message); } catch (e) { /* noop */ } } }
    diagnostics() { return this.diag; }
    updateMeters() { return this.meter; }
    listDevices() { return this.link.request({ t: 'cmd', target: 'engine', name: 'listDevices', args: [] }).catch(() => []); }
    setChannel(ch) { this.opts.channel = ch; this.link.send({ t: 'cmd', target: 'engine', name: 'setChannel', args: [ch] }); }
    setMonitor(on) { this.opts.monitor = on; this.link.send({ t: 'cmd', target: 'engine', name: 'setMonitor', args: [on] }); }
    skipFile(d) { this.link.send({ t: 'cmd', target: 'engine', name: 'skipFile', args: [d] }); return true; }
    stop() { this.link.send({ t: 'cmd', target: 'engine', name: 'stop', args: [] }); }
    pull() { return { samples: new Float32Array(0), gapped: false }; }
    watchdog() {}
    latest() { return new Float32Array(8192); }
  }

  // ---------------------------------------------------------------- 本体
  const link = {
    role: VJ.params && VJ.params.role === 'output' ? 'output' : 'solo',
    peer: null,
    app: null,
    pending: new Map(),
    seq: 0,
    lastStatus: null,
    _poll: null,
    wantPreview: false, // 出力側：操作側がプレビューを見ているか
    PREVIEW_MS: 333, // プレビューの間隔（1 秒に 3 回。描画の読み出しは GPU の負担になるので控えめに）

    send(msg) {
      if (!link.peer || link.peer.closed) return false;
      try { link.peer.postMessage(msg, '*'); return true; } catch (e) { return false; }
    },
    request(msg) {
      const id = ++link.seq;
      msg.id = id;
      return new Promise((resolve, reject) => {
        link.pending.set(id, { resolve, reject });
        if (!link.send(msg)) { link.pending.delete(id); reject(new Error(VJ.t('出力ウィンドウがありません'))); }
        setTimeout(() => { if (link.pending.has(id)) { link.pending.delete(id); reject(new Error(VJ.t('出力ウィンドウから応答がありません'))); } }, 60000);
      });
    },

    /** 操作側：出力ウィンドウを開く（ポップアップがブロックされないよう、クリック直後にまず開く）。
     *  opts.glass：透過ウィンドウで（単体アプリ。ほかの画面の上に重ねて表示する） */
    openOutput(app, opts) {
      const glass = !!(opts && opts.glass);
      // 閉じている途中の出力ウィンドウ（「閉じる」の直後）は、前面に出さずに新しく開く
      const closing = link._closing && !link._closing.closed && link._closing === link.peer ? link._closing : null;
      if (link.role === 'control' && link.peer && !link.peer.closed && !closing) { link.peer.focus(); return; }
      if (link.role === 'control') link.closeOutput(true); // 閉じた直後（見張りが気づく前）でも元に戻してから開く
      const base = location.href.replace(/[?#].*$/, '');
      const keep = ['test', 'scale', 'pr', 'desync'].filter((k) => VJ.params[k] !== undefined).map((k) => `&${k}=${encodeURIComponent(VJ.params[k])}`).join('');
      // 同じ名前だと閉じている途中のウィンドウが使い回されるので、そのときは別の名前で
      const w = window.open(base + '?role=output' + (glass ? '&overlay=1' : '') + keep, closing || glass ? 'momosai-vj-output-' + Date.now() : 'momosai-vj-output', 'popup,width=960,height=540');
      if (!w) { app.ui.toast(VJ.t('出力ウィンドウを開けませんでした（ポップアップのブロックを解除してください）'), 'warn'); return; }
      link.adopt(app, w, true);
      // 画面が 2 つあれば、もう一方（プロジェクター）へ移す（「ウィンドウの管理」の許可が必要）。
      // 透過ウィンドウの場所はアプリ側で決める
      if (window.getScreenDetails && !glass) {
        window.getScreenDetails().then((sd) => {
          const other = sd.screens.find((x) => x !== sd.currentScreen);
          if (other && !w.closed) { w.moveTo(other.availLeft, other.availTop); w.resizeTo(other.availWidth, other.availHeight); }
        }).catch(() => {});
      }
    },

    /** 出力ウィンドウ w を操作対象にする（開いたとき・操作側を再読み込みしたときの再接続） */
    adopt(app, w, fresh) {
      link.app = app;
      link.peer = w;
      link.role = 'control';
      // 1 画面の状態を退避し、リモコンに差し替える
      const local = { show: app.show, engine: app.engine, wasRunning: fresh && app.engine.running, opts: Object.assign({}, app.engine.opts), session: app.show.session(), fresh };
      link.local = local;
      if (local.engine.status !== 'idle') local.engine.stop(); // 開始途中（自動開始など）も止める
      // ブリッジ・USB-DMX は出力ウィンドウが受け持つ（両方からつなぐと操作が 2 回になる）
      VJ.net._close();
      VJ.net.url = '';
      // 開いていた USB-DMX は、閉じてから出力ウィンドウで開き直す（同じポートは 2 か所で開けない）
      const dmxInfo = VJ.dmx.port ? VJ.dmx.info || {} : null;
      VJ.dmx.closeSerial().then(() => {
        if (dmxInfo) link.request({ t: 'cmd', target: 'dmx', name: 'openGranted', args: [dmxInfo] }).catch(() => {});
      });
      const resume = document.getElementById('resume-box');
      if (resume) resume.hidden = true; // 出力側が本番の状態を持っているので、古い「前回の続き」は出さない
      app.paused = true;
      VJ.media.release(); // 動画・埋め込み・画面の取り込みは出力ウィンドウが受け持つ
      app.show = new RemoteShow(link, app.settings);
      app.show.state = Object.assign({}, local.show.state);
      app.engine = new RemoteEngine(link);
      VJ.panel.bindEngine();
      document.getElementById('remote').hidden = false;
      document.body.classList.add('remote-mode');
      document.getElementById('btn-output').textContent = VJ.t('出力ウィンドウを前面に');
      document.getElementById('btn-output-stop').hidden = false;
      link._previewOn();
      clearInterval(link._poll);
      link._poll = setInterval(() => { if (link.peer && link.peer.closed) link.closeOutput(true); }, 500);
      if (!fresh) {
        // 再接続：本番中の設定は出力側が正しい（こちらの保存は古いかもしれない）ので、出力側から取り込む
        link.request({ t: 'cmd', target: 'app', name: 'getSettings', args: [] })
          .then((ns) => { if (ns && typeof ns === 'object') VJ.panel.replaceSettings(ns); })
          .catch(() => {});
        app.ui.toast(VJ.t('出力ウィンドウに再接続しました'));
      }
    },

    /** 操作側：出力ウィンドウを閉じて 1 画面に戻る */
    closeOutput(alreadyClosed) {
      if (link.role !== 'control') return;
      if (!alreadyClosed && link.peer && !link.peer.closed) {
        // 出力側の「本番中の離脱確認」を外してから閉じる（確認が残っていると閉じるのが取り消される。
        // Electron では何も表示されずに取り消される）。1 画面に戻すのは、実際に閉じたのを _poll が見てから
        const peer = (link._closing = link.peer);
        const wait = new Promise((res) => setTimeout(res, 1500));
        Promise.race([link.request({ t: 'cmd', target: 'app', name: 'releaseGuard', args: [] }).catch(() => {}), wait])
          .then(() => {
            try { peer.close(); } catch (e) { /* noop */ }
            setTimeout(() => { if (link.peer === peer && !peer.closed) link.app.ui.toast(VJ.t('出力ウィンドウを閉じられませんでした。出力ウィンドウを直接閉じてください'), 'warn'); }, 3000);
          });
        return;
      }
      clearInterval(link._poll);
      link._closedPeer = link.peer;
      const app = link.app, local = link.local;
      const last = app.show.session();
      app.show = local.show;
      app.engine = local.engine;
      app.show.applySettings(app.settings);
      app.show.restoreSession(last);
      link.peer = null;
      link.role = 'solo';
      app.paused = false;
      VJ.net.apply(app);
      VJ.dmx.apply(app);
      VJ.media.sync(app);
      document.getElementById('remote').hidden = true;
      document.body.classList.remove('remote-mode');
      document.getElementById('btn-output').textContent = VJ.t('出力ウィンドウを開く（2 画面）');
      document.getElementById('btn-output-stop').hidden = true;
      VJ.panel.renderStatus(app.engine.status, '');
      app.ui.toast(VJ.t('出力ウィンドウを閉じました（この画面に戻しました。音声は ▶ 開始 で再開）'));
      for (const p of link.pending.values()) p.reject(new Error(VJ.t('出力ウィンドウが閉じられました')));
      link.pending.clear();
    },

    /** 操作側：出力ウィンドウからのメッセージ */
    _onControlMessage(d) {
      const app = link.app;
      if (d.t === 'hello') {
        // 出力ウィンドウが開いた／再読み込みされた：設定（出演バンドの一覧も）・曲の位置・音声入力を渡す
        link.send({ t: 'settings', settings: app.settings });
        link._bandsSent = { ref: app.settings.bands, ver: VJ.bands.version };
        link._logoSent = app.settings.logo;
        link._ovImgSent = app.settings.overlay && app.settings.overlay.image;
        // メディアの動画ファイル・一覧の画像と動画（保存場所を共有できない環境でも出せるように、中身も渡す）
        const vk = app.settings.overlay && app.settings.overlay.videoKey;
        for (const k of new Set([vk, ...VJ.mediaLib.keys(app.settings)].filter(Boolean))) {
          VJ.mediaStore.get(k).then((b) => { if (b) link.send({ t: 'media', key: k, blob: b }); });
        }
        link._previewOn();
        const first = link.local.fresh;
        link.local.fresh = false;
        const sess = first ? link.local.session : app.show.session();
        link.send({ t: 'cmd', target: 'show', name: 'restoreSession', args: [sess] });
        // 動いていた入力を出力側で再開（ファイルは出力側に渡していないので除く）。
        // 「PC で再生中の音」の共有はウィンドウをまたいで引き継げないので、出力ウィンドウで選び直してもらう
        const st = link.lastStatus;
        const o = first ? (link.local.wasRunning ? link.local.opts : null) : (st && st.engineStatus === 'running' ? st.engineOpts : null);
        if (o && (o.source === 'mic' || o.source === 'demo' || o.source === 'display')) {
          app.startAudio({ source: o.source, deviceId: o.deviceId, deviceLabel: o.deviceLabel, channel: o.channel || app.settings.channel, monitor: app.settings.monitor }).catch(() => {});
        }
      } else if (d.t === 'status') {
        link.lastStatus = d;
        const show = app.show, eng = app.engine;
        Object.assign(show.state, d.state);
        show.limiter.denied = d.denied;
        eng.meter = d.meter;
        const dev = eng.diag.device;
        eng.diag = d.diag;
        Object.assign(eng.opts, d.engineOpts);
        if (eng.status !== d.engineStatus) eng._set(d.engineStatus, d.engineMessage);
        // 入力の名前・チャンネル数は状態の通知より遅れて届くので、届いたら表示し直す
        else if (eng.status === 'running' && d.diag.device !== dev) VJ.panel.renderStatus(eng.status, eng.message);
        const now = performance.now(), L = VJ.hud.lamps;
        if (d.hits & 1) L.k = now;
        if (d.hits & 2) L.s = now;
        if (d.hits & 4) L.h = now;
        if (d.hits & 8) L.a = now;
        if (d.hits & 32) L.b = now;
        // キー操作で変わった設定（パレット・感度・明るさ・オート）をこちらにも反映
        let changed = false;
        for (const k of Object.keys(PATCH_KEYS)) {
          const v = d.patch && d.patch[k];
          if (typeof v === PATCH_KEYS[k] && app.settings[k] !== v) { app.settings[k] = v; changed = true; }
        }
        if (changed) { VJ.panel.syncFromSettings(); VJ.panel.save(); }
        link._features = d.f;
      } else if (d.t === 'preview') {
        // 出力ウィンドウの縮小映像（JPEG の data URL）
        const img = document.getElementById('remote-preview'), cb = document.getElementById('remote-preview-on');
        // 切ったあとに届いた分は出さない
        if (img && (!cb || cb.checked) && typeof d.url === 'string' && d.url.startsWith('data:image/jpeg;base64,')) { img.src = d.url; img.hidden = false; }
      } else if (d.t === 'engine') {
        app.engine._set(d.status, d.message);
      } else if (d.t === 'toast') {
        app.ui.toast(d.msg, d.kind);
      } else if (d.t === 'band' && VJ.bandsUI) {
        // 出力ウィンドウで受けたバンドの切替（スマホ・OSC・キー）。設定はこちらが持っているのでこちらで
        if (typeof d.i === 'number') VJ.bandsUI.switchTo(d.i);
        else if (d.d === 1 || d.d === -1) VJ.bandsUI.step(d.d, { force: !!d.force });
      } else if (d.t === 'cue' && VJ.cuesUI) {
        // 出力ウィンドウで受けたキュー（キー・MIDI・スマホ・OSC）。設定はこちらが持っているのでこちらで
        if (Number.isInteger(d.i)) VJ.cuesUI.recall(d.i);
      } else if (d.t === 'res') {
        const p = link.pending.get(d.id);
        if (p) { link.pending.delete(d.id); if (d.error) p.reject(Object.assign(new Error(d.error), { name: d.errorName })); else p.resolve(d.value); }
      } else if (d.t === 'bye') {
        setTimeout(() => { if (link.peer && link.peer.closed) link.closeOutput(true); }, 300);
      }
    },

    /** 操作側：描画を止めている間の画面更新（メーター・状態表示） */
    remoteTick(ts) {
      const d = link.lastStatus;
      VJ.panel.tick(link._features || null, ts);
      if (!d || ts - (link._statusT || 0) < 250) return;
      link._statusT = ts;
      const s = d.state, f = d.f || {};
      const songs = link.app.show.setlist.songs;
      const song = s.songIdx >= 0 && !s.endState ? songs[s.songIdx] : null;
      const sc = VJ.scenes.byId[s.sceneId];
      const t = VJ.t;
      const lines = [
        t('シーン  {0}{1}', sc ? sc.key + ' ' + VJ.sceneName(sc) : s.sceneId, s.pending ? t('（次のビートで切替待ち）') : ''),
        t('曲     {0}', song ? 'M' + (s.songIdx + 1) + ' ' + song.title : s.endState ? t('（終演）') : t('（開演前）')),
        t('テンポ  {0}   {1}', f.bpm && f.beatConf > 0.2 ? Math.round(f.bpm) + ' BPM' : '—', f.melodic ? t('ドラムの無い曲として反応中') : ''),
        t('状態   オート {0}  暗転 {1}  ロック {2}  パレット {3}', s.auto ? 'ON' : 'OFF', s.blackout ? 'ON' : 'OFF', s.locked ? 'ON' : 'OFF', VJ.palettes[s.paletteIdx] ? t(VJ.palettes[s.paletteIdx].name) : ''),
        t('出力   {0}  {1}  {2}', d.fps ? d.fps.toFixed(0) + 'fps' : '', d.size ? d.size.join('x') : '', d.fullscreen ? t('全画面') : t('全画面ではありません（出力ウィンドウをダブルクリック）')),
      ];
      document.getElementById('remote-status').textContent = lines.join('\n');
      if (VJ.hud.visible && d.hud) VJ.hud.el.textContent = d.hud;
    },

    // ---------------------------------------------------------------- 出力側
    initOutput(app) {
      link.app = app;
      link.peer = window.opener || null;
      document.body.classList.add('output');
      VJ.panel.toggle(false);
      const hint = document.getElementById('out-hint');
      // 透過ウィンドウは操作を受け取らない（クリックは下の画面に届く）ので、全画面の案内は出さない
      if (VJ.params.overlay !== '1') {
        hint.hidden = false;
        setTimeout(() => { hint.hidden = true; }, 8000);
        document.addEventListener('dblclick', () => { VJ.guard.enterFullscreen(); hint.hidden = true; });
      }
      app.show.on((msg, kind) => link.send({ t: 'toast', msg, kind }));
      app.engine.on((status, message) => {
        link.send({ t: 'engine', status, message });
        // 共有する画面を選ぶ画面はこのウィンドウに出て、操作ウィンドウからは見えない。待ちが続いたら操作側に案内を出す
        clearTimeout(link._pickT);
        if (status === 'starting' && app.engine.opts.source === 'display') {
          link._pickT = setTimeout(() => {
            if (app.engine.status === 'starting') link.send({ t: 'engine', status: 'starting', message: VJ.t('出力ウィンドウに、共有する画面を選ぶ画面が出ています。出力ウィンドウで、共有する画面（またはタブ）と音声を選んでください。') });
          }, 700);
        }
      });
      let hits = 0;
      app.onFeatures = (f) => { hits |= f.onsetFlags; };
      setInterval(() => {
        if (!link.peer || link.peer.closed) return;
        const s = app.show.state, f = app.lastFeatures || {};
        const r = app.renderer.info();
        link.send({
          t: 'status',
          role: 'output',
          state: { sceneId: s.sceneId, pending: s.pending ? { id: s.pending.id } : null, songIdx: s.songIdx, endState: s.endState, auto: s.auto, locked: s.locked, blackout: s.blackout, sens: s.sens, master: s.master, paletteIdx: s.paletteIdx, intLv: s.intLv },
          denied: app.show.limiter.denied,
          meter: app.engine.updateMeters(),
          diag: app.engine.diagnostics(),
          engineStatus: app.engine.status,
          engineMessage: app.engine.message,
          engineOpts: { source: app.engine.opts.source, deviceId: app.engine.opts.deviceId, deviceLabel: app.engine.opts.deviceLabel, channel: app.engine.opts.channel },
          hits,
          f: { bpm: f.bpm, beatConf: f.beatConf, melodic: f.melodic, tempoManual: f.tempoManual, active: f.active },
          patch: { paletteIdx: app.settings.paletteIdx, sensitivity: app.settings.sensitivity, master: app.settings.master, auto: app.settings.auto, overlayOn: !!app.settings.overlayOn, ovSceneOn: !!app.settings.ovSceneOn },
          media: VJ.media.state(),
          fps: r.fps, size: r.size, fullscreen: !!VJ.compat.fullscreenElement(),
          io: { net: VJ.net.state(), dmx: VJ.dmx.state() },
          hud: VJ.hud.text ? VJ.hud.text(app, f, performance.now()) : '',
        });
        hits = 0;
      }, 100);
      window.addEventListener('beforeunload', () => link.send({ t: 'bye' }));
      link.send({ t: 'hello' });
    },

    /** 操作側：プレビューの ON/OFF を出力側へ */
    _previewOn() {
      const cb = document.getElementById('remote-preview-on');
      const on = !cb || cb.checked;
      link.send({ t: 'preview', on });
      const img = document.getElementById('remote-preview');
      if (img && !on) img.hidden = true;
    },

    /** 出力側：描画した直後に呼ぶ（WebGL の画面は描いた直後でないと読めない）。縮小して操作側へ送る */
    previewFrame(canvas, ts) {
      if (!link.wantPreview || !link.peer || link.peer.closed || ts - (link._pvT || 0) < link.PREVIEW_MS) return;
      link._pvT = ts;
      const w = 240, h = Math.max(1, Math.round((w * canvas.height) / Math.max(1, canvas.width)));
      let c = link._pv;
      if (!c) c = link._pv = document.createElement('canvas');
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = c.getContext('2d');
      g.drawImage(canvas, 0, 0, w, h);
      link.send({ t: 'preview', url: c.toDataURL('image/jpeg', 0.6) });
    },

    async _onOutputMessage(d) {
      const app = link.app;
      if (d.t === 'preview') { link.wantPreview = !!d.on; return; }
      if (d.t === 'settings') {
        const keep = d.keep || {};
        const logo = app.settings.logo, img = app.settings.overlay && app.settings.overlay.image;
        for (const k of Object.keys(d.settings)) app.settings[k] = d.settings[k];
        // 変わっていないので送られてこなかった大きい画像は、いま持っているものを使う
        if (keep.logo) app.settings.logo = logo;
        if (keep.ovImage && app.settings.overlay) app.settings.overlay.image = img || '';
        app.applySettings();
        return;
      }
      if (d.t === 'media') {
        // 操作ウィンドウで選んだ動画ファイル・一覧の画像。保存場所から読めなかった（見つからない）ときは読み直す
        if (typeof d.key === 'string' && d.blob instanceof Blob) {
          VJ.mediaStore.hold(d.key, d.blob);
          if (VJ.media.status === 'missing' && VJ.media._sig(VJ.media._eff(app)).split('|')[1] === d.key) { VJ.media.videoKey = ''; VJ.media.sync(app); }
        }
        return;
      }
      if (d.t !== 'cmd') return;
      let value, error = null, errorName = '';
      try {
        if (d.target === 'show') value = app.show[d.name](...(d.args || []));
        else if (d.target === 'engine') value = await app.engine[d.name](...(d.args || []));
        else if (d.target === 'app') value = await app[d.name](...(d.args || []));
        else if (d.target === 'ui') value = await app.ui[d.name](...(d.args || []));
        else if (d.target === 'dmx' && (d.name === 'openGranted' || d.name === 'closeSerial')) value = await VJ.dmx[d.name](...(d.args || []).slice(0, 1));
        if (value && typeof value === 'object' && !Array.isArray(value)) value = JSON.parse(JSON.stringify(value));
        if (Array.isArray(value)) value = value.map((x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x));
      } catch (e) {
        error = (e && e.message) || String(e);
        errorName = (e && e.name) || '';
      }
      if (d.id) link.send({ t: 'res', id: d.id, value: error ? undefined : value, error, errorName });
    },
  };

  /** このウィンドウが開いた出力ウィンドウか（ほかのページからの偽の通知でつなぎ替えない） */
  function isOurWindow(w) {
    try { return w.opener === window; } catch (e) { return false; }
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || !d.t) return;
    if (link.role === 'control' && e.source === link.peer) link._onControlMessage(d);
    else if (link.role === 'output' && e.source === window.opener) link._onOutputMessage(d);
    else if (link.role === 'solo' && d.t === 'status' && d.role === 'output' && e.source && VJ.app && VJ.app.show
      && e.source !== window && !e.source.closed && e.source !== link._closedPeer && isOurWindow(e.source)) {
      // 操作ウィンドウを再読み込みした：開いたままの出力ウィンドウにつなぎ直す
      link.adopt(VJ.app, e.source, false);
      link._onControlMessage(d);
    }
  });

  link.RemoteShow = RemoteShow;
  link.RemoteEngine = RemoteEngine;
  VJ.link = link;
})(globalThis.VJ = globalThis.VJ || {});
