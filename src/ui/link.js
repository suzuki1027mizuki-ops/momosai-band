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
    'toggleTestPattern', 'restoreSession', 'setMaster', 'setSensitivity'];

  // ---------------------------------------------------------------- 操作側のリモコン
  class RemoteShow {
    constructor(link, settings) {
      this.link = link;
      this.settings = settings;
      this.state = { sceneId: 'title', locked: false, songIdx: -1, endState: false, auto: !!settings.auto, sens: 0, master: 1, paletteIdx: 0, blackout: false, pending: null };
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

    send(msg) {
      if (!link.peer || link.peer.closed) return false;
      try { link.peer.postMessage(msg, '*'); return true; } catch (e) { return false; }
    },
    request(msg) {
      const id = ++link.seq;
      msg.id = id;
      return new Promise((resolve, reject) => {
        link.pending.set(id, { resolve, reject });
        if (!link.send(msg)) { link.pending.delete(id); reject(new Error('出力ウィンドウがありません')); }
        setTimeout(() => { if (link.pending.has(id)) { link.pending.delete(id); reject(new Error('出力ウィンドウから応答がありません')); } }, 60000);
      });
    },

    /** 操作側：出力ウィンドウを開く */
    async openOutput(app) {
      if (link.role === 'control' && link.peer && !link.peer.closed) { link.peer.focus(); return; }
      link.app = app;
      const base = location.href.replace(/[?#].*$/, '');
      const keep = ['test', 'scale', 'pr', 'desync'].filter((k) => VJ.params[k] !== undefined).map((k) => `&${k}=${encodeURIComponent(VJ.params[k])}`).join('');
      let features = 'popup,width=960,height=540';
      // 複数の画面があれば、もう一方の画面（プロジェクター）に開く（ウィンドウの管理の許可が必要）
      try {
        if (window.getScreenDetails) {
          const sd = await window.getScreenDetails();
          const other = sd.screens.find((x) => x !== sd.currentScreen);
          if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
        }
      } catch (e) { /* 許可されなければ普通に開く */ }
      const w = window.open(base + '?role=output' + keep, 'momosai-vj-output', features);
      if (!w) { app.ui.toast('出力ウィンドウを開けませんでした（ポップアップのブロックを解除してください）', 'warn'); return; }
      link.peer = w;
      link.role = 'control';
      // 1 画面の状態を退避し、リモコンに差し替える
      const local = { show: app.show, engine: app.engine, wasRunning: app.engine.running, opts: Object.assign({}, app.engine.opts), session: app.show.session() };
      link.local = local;
      if (local.engine.running) local.engine.stop();
      app.paused = true;
      app.show = new RemoteShow(link, app.settings);
      app.show.state = Object.assign({}, local.show.state);
      app.engine = new RemoteEngine(link);
      VJ.panel.bindEngine();
      document.getElementById('remote').hidden = false;
      document.getElementById('btn-output').textContent = '出力ウィンドウを前面に';
      clearInterval(link._poll);
      link._poll = setInterval(() => { if (link.peer && link.peer.closed) link.closeOutput(true); }, 500);
    },

    /** 操作側：出力ウィンドウを閉じて 1 画面に戻る */
    closeOutput(alreadyClosed) {
      if (link.role !== 'control') return;
      clearInterval(link._poll);
      if (!alreadyClosed && link.peer && !link.peer.closed) link.peer.close();
      const app = link.app, local = link.local;
      const last = app.show.session();
      app.show = local.show;
      app.engine = local.engine;
      app.show.applySettings(app.settings);
      app.show.restoreSession(last);
      link.peer = null;
      link.role = 'solo';
      app.paused = false;
      document.getElementById('remote').hidden = true;
      document.getElementById('btn-output').textContent = '出力ウィンドウを開く（2 画面）';
      VJ.panel.renderStatus(app.engine.status, '');
      app.ui.toast('出力ウィンドウを閉じました（この画面に戻しました。音声は ▶ 開始 で再開）');
      for (const p of link.pending.values()) p.reject(new Error('出力ウィンドウが閉じられました'));
      link.pending.clear();
    },

    /** 操作側：出力ウィンドウからのメッセージ */
    _onControlMessage(d) {
      const app = link.app;
      if (d.t === 'hello') {
        link.send({ t: 'settings', settings: app.settings });
        link.send({ t: 'cmd', target: 'show', name: 'restoreSession', args: [link.local.session] });
        // 1 画面のとき動いていた入力を出力側で再開（画面共有は出力側での操作が必要なので除く）
        const o = link.local.opts;
        if (link.local.wasRunning && o && (o.source === 'mic' || o.source === 'demo')) {
          app.startAudio({ source: o.source, deviceId: o.deviceId, deviceLabel: o.deviceLabel, channel: o.channel, monitor: o.monitor }).catch(() => {});
        }
      } else if (d.t === 'status') {
        link.lastStatus = d;
        const show = app.show, eng = app.engine;
        Object.assign(show.state, d.state);
        show.limiter.denied = d.denied;
        eng.meter = d.meter;
        eng.diag = d.diag;
        Object.assign(eng.opts, d.engineOpts);
        if (eng.status !== d.engineStatus) eng._set(d.engineStatus, d.engineMessage);
        const now = performance.now(), L = VJ.hud.lamps;
        if (d.hits & 1) L.k = now;
        if (d.hits & 2) L.s = now;
        if (d.hits & 4) L.h = now;
        if (d.hits & 8) L.a = now;
        if (d.hits & 32) L.b = now;
        // キー操作で変わった設定（パレット・感度・明るさ・オート）をこちらにも反映
        let changed = false;
        for (const k of Object.keys(d.patch || {})) if (app.settings[k] !== d.patch[k]) { app.settings[k] = d.patch[k]; changed = true; }
        if (changed) { VJ.panel.syncFromSettings(); VJ.panel.save(); }
        link._features = d.f;
      } else if (d.t === 'engine') {
        app.engine._set(d.status, d.message);
      } else if (d.t === 'toast') {
        app.ui.toast(d.msg, d.kind);
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
      const lines = [
        `シーン  ${sc ? sc.key + ' ' + sc.nameJa : s.sceneId}${s.pending ? '（次のビートで切替待ち）' : ''}`,
        `曲     ${song ? 'M' + (s.songIdx + 1) + ' ' + song.title : s.endState ? '（終演）' : '（開演前）'}`,
        `テンポ  ${f.bpm && f.beatConf > 0.2 ? Math.round(f.bpm) + ' BPM' : '—'}   ${f.melodic ? 'ドラムの無い曲として反応中' : ''}`,
        `状態   オート ${s.auto ? 'ON' : 'OFF'}  暗転 ${s.blackout ? 'ON' : 'OFF'}  ロック ${s.locked ? 'ON' : 'OFF'}  パレット ${VJ.palettes[s.paletteIdx] ? VJ.palettes[s.paletteIdx].name : ''}`,
        `出力   ${d.fps ? d.fps.toFixed(0) + 'fps' : ''}  ${d.size ? d.size.join('x') : ''}  ${d.fullscreen ? '全画面' : '全画面ではありません（出力ウィンドウをダブルクリック）'}`,
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
      hint.hidden = false;
      setTimeout(() => { hint.hidden = true; }, 8000);
      document.addEventListener('dblclick', () => { VJ.guard.enterFullscreen(); hint.hidden = true; });
      app.show.on((msg, kind) => link.send({ t: 'toast', msg, kind }));
      app.engine.on((status, message) => link.send({ t: 'engine', status, message }));
      let hits = 0;
      app.onFeatures = (f) => { hits |= f.onsetFlags; };
      setInterval(() => {
        if (!link.peer || link.peer.closed) return;
        const s = app.show.state, f = app.lastFeatures || {};
        const r = app.renderer.info();
        link.send({
          t: 'status',
          state: { sceneId: s.sceneId, pending: s.pending ? { id: s.pending.id } : null, songIdx: s.songIdx, endState: s.endState, auto: s.auto, locked: s.locked, blackout: s.blackout, sens: s.sens, master: s.master, paletteIdx: s.paletteIdx },
          denied: app.show.limiter.denied,
          meter: app.engine.updateMeters(),
          diag: app.engine.diagnostics(),
          engineStatus: app.engine.status,
          engineMessage: app.engine.message,
          engineOpts: { source: app.engine.opts.source, deviceId: app.engine.opts.deviceId, deviceLabel: app.engine.opts.deviceLabel, channel: app.engine.opts.channel },
          hits,
          f: { bpm: f.bpm, beatConf: f.beatConf, melodic: f.melodic, tempoManual: f.tempoManual, active: f.active },
          patch: { paletteIdx: app.settings.paletteIdx, sensitivity: app.settings.sensitivity, master: app.settings.master, auto: app.settings.auto },
          fps: r.fps, size: r.size, fullscreen: !!document.fullscreenElement,
          hud: VJ.hud.text ? VJ.hud.text(app, f, performance.now()) : '',
        });
        hits = 0;
      }, 100);
      window.addEventListener('beforeunload', () => link.send({ t: 'bye' }));
      link.send({ t: 'hello' });
    },

    async _onOutputMessage(d) {
      const app = link.app;
      if (d.t === 'settings') {
        for (const k of Object.keys(d.settings)) app.settings[k] = d.settings[k];
        app.applySettings();
        return;
      }
      if (d.t !== 'cmd') return;
      let value, error = null, errorName = '';
      try {
        if (d.target === 'show') value = app.show[d.name](...(d.args || []));
        else if (d.target === 'engine') value = await app.engine[d.name](...(d.args || []));
        else if (d.target === 'app') value = await app[d.name](...(d.args || []));
        else if (d.target === 'ui') value = await app.ui[d.name](...(d.args || []));
        if (value && typeof value === 'object' && !Array.isArray(value)) value = JSON.parse(JSON.stringify(value));
        if (Array.isArray(value)) value = value.map((x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x));
      } catch (e) {
        error = (e && e.message) || String(e);
        errorName = (e && e.name) || '';
      }
      if (d.id) link.send({ t: 'res', id: d.id, value: error ? undefined : value, error, errorName });
    },
  };

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || !d.t) return;
    if (link.role === 'control' && e.source === link.peer) link._onControlMessage(d);
    else if (link.role === 'output' && e.source === window.opener) link._onOutputMessage(d);
  });

  link.RemoteShow = RemoteShow;
  link.RemoteEngine = RemoteEngine;
  VJ.link = link;
})(globalThis.VJ = globalThis.VJ || {});
