/* 起動と毎フレームのループ。
 * rAF の先頭で：音声の新規サンプルを取り出す → DSP → 演出 → 描画。
 * 例外はフレーム単位で隔離し、rAF は絶対に止めない。 */
(function (VJ) {
  'use strict';

  function fatal(msg) {
    const el = document.getElementById('fatal');
    el.hidden = false;
    el.textContent = msg;
  }

  function boot() {
    const settings = VJ.storage.load();
    const app = (VJ.app = { settings, errors: 0, errorsInRow: 0, paused: false, frameNo: 0, onFrame: null });
    const canvas = document.getElementById('stage');
    try {
      app.renderer = new VJ.Renderer(canvas, {
        desynchronized: settings.desynchronized && VJ.params.desync !== '0',
        maxScale: settings.maxScale,
        fixedScale: +VJ.params.scale || 0,
        pixelRatio: +VJ.params.pr || 0,
      });
    } catch (e) {
      fatal('映像を初期化できませんでした：' + e.message);
      return;
    }
    app.engine = new VJ.AudioEngine();
    app.show = new VJ.ShowController(settings);
    app.show.sceneAvailable = (id) => app.renderer.available(id);
    app.show.onSensitivity = (s) => { if (app.extractor) app.extractor.setSensitivity(s); };
    app.ensureExtractor = () => {
      const sr = app.engine.sampleRate;
      const key = VJ.dspKey(app.settings);
      if (!app.extractor || app.extractor.sr !== sr || app.dspKey !== key) {
        app.extractor = new VJ.dsp.FeatureExtractor({ sampleRate: sr, config: VJ.makeDspConfig(app.settings) });
        app.extractor.setSensitivity(app.show.state.sens);
        app.dspKey = key;
      }
      return app.extractor;
    };
    app.getText = (main, sub) => app.renderer.text.get(main, sub);
    const link = VJ.link;
    const remote = () => link.role === 'control';

    /** 設定を反映（2 画面のときは出力ウィンドウへ送る） */
    app.applySettings = () => {
      const s = app.settings;
      app.show.applySettings(s);
      if (remote()) { link.send({ t: 'settings', settings: s }); return; }
      app.renderer.setOutput(s.output);
      app.renderer.setLogo(s.logo);
      app.renderer.setMaxScale(s.maxScale);
    };
    app.startAudio = async (opts) => {
      if (remote()) return link.request({ t: 'cmd', target: 'app', name: 'startAudio', args: [opts] });
      await app.engine.start(opts);
      app.ensureExtractor().resync();
      return true;
    };
    app.show.onTap = () => (app.extractor ? app.extractor.tap() : 0);
    app.show.onSongStart = () => { if (app.extractor) app.extractor.tempo.clearManual(); };
    // 前回の続きから再開できるように、曲・シーンの位置を保存（操作ウィンドウ以外）
    const SESSION_KEY = VJ.storage.KEY + '/session';
    let sessT = null;
    app.show.onSession = (sess) => {
      if (remote() || app.paused) return;
      clearTimeout(sessT);
      sessT = setTimeout(() => { try { localStorage.setItem(SESSION_KEY, JSON.stringify(sess)); } catch (e) { /* noop */ } }, 500);
    };

    // トースト
    const toastEl = document.getElementById('toast');
    let toastT = null;
    const toast = (msg, kind) => {
      if (!settings.toast && kind !== 'warn' && VJ.guard.showing) return;
      toastEl.textContent = msg;
      toastEl.className = 'show ' + (kind || '');
      clearTimeout(toastT);
      toastT = setTimeout(() => { toastEl.className = kind || ''; }, 1200);
    };
    app.show.on(toast);

    const help = document.getElementById('help');
    app.ui = {
      toast,
      toggleHud: () => VJ.hud.toggle(),
      toggleHelp: () => { help.hidden = !help.hidden; },
      togglePanel: () => {
        if (link.role === 'output') { toast('設定は元の（操作）ウィンドウで行ってください'); return; }
        VJ.panel.toggle();
      },
      closeOverlays: () => { help.hidden = true; VJ.hud.toggle(false); if (link.role !== 'output') VJ.panel.toggle(false); },
      enterFullscreen: () => VJ.guard.enterFullscreen(),
      startShow: async () => {
        if (remote()) return link.request({ t: 'cmd', target: 'ui', name: 'startShow', args: [] });
        await VJ.guard.startShow();
        if (link.role === 'output' && !document.fullscreenElement) document.getElementById('out-hint').hidden = false;
        return true;
      },
      softReset: async () => {
        if (remote()) return link.request({ t: 'cmd', target: 'ui', name: 'softReset', args: [] });
        toast('ソフトリセット中…');
        try {
          if (app.engine.status !== 'idle') await app.engine.restart();
          app.renderer._initGL();
          app.extractor = null;
          app.ensureExtractor();
          toast('ソフトリセット完了');
        } catch (e) {
          toast('リセット失敗：' + e.message, 'warn');
        }
        return true;
      },
    };
    help.addEventListener('click', () => { help.hidden = true; });

    app.onAction = () => VJ.panel.save();
    VJ.hud.init(document.getElementById('hud'));
    VJ.guard.install();
    VJ.keys.install(app);
    VJ.panel.init(app);
    app.applySettings();
    if (VJ.params.test) VJ.testing = makeTesting(app);

    if (link.role === 'output') {
      link.initOutput(app);
    } else {
      // 前回の続き（6 時間以内・曲が進んでいたとき）
      try {
        const sess = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        if (sess && Date.now() - sess.t < 6 * 3600 * 1000 && (sess.songIdx >= 0 || sess.endState)) VJ.panel.offerResume(sess);
      } catch (e) { /* noop */ }
      // 起動したら自動で開始（展示・BGM 用）
      if (settings.autoStart && (settings.lastSource === 'mic' || settings.lastSource === 'demo')) {
        setTimeout(async () => {
          await VJ.panel.startAudio({ source: settings.lastSource });
          const ctx = app.engine.ctx;
          if (ctx && ctx.state !== 'running') {
            toast('画面をクリックすると音声入力が始まります', 'warn');
            const go = () => { ctx.resume(); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
            window.addEventListener('pointerdown', go);
            window.addEventListener('keydown', go);
          }
        }, 300);
      }
    }

    let last = 0, lastRender = 0;
    const silent = new Float32Array(8192);
    let prefetchAt = 0;
    function frame(ts) {
      requestAnimationFrame(frame);
      if (link.role === 'control') { link.remoteTick(ts); return; }
      if (app.paused) return;
      const now = ts / 1000;
      const dt = last ? Math.min(0.1, Math.max(0.001, now - last)) : 1 / 60;
      last = now;
      app.frameNo++;
      let f = null;
      try {
        const engine = app.engine;
        engine.watchdog(ts);
        const fx = app.ensureExtractor();
        const pulled = engine.pull();
        if (pulled.gapped) fx.resync();
        if (pulled.samples.length) fx.process(pulled.samples);
        f = fx.computeFrame(engine.running ? engine.latest() : silent, now, dt);
        app.show.update(f, dt, now);
        // フレームレート上限（非力な PC 向け）：解析と演出は毎フレーム、描画だけ間引く
        const cap = settings.fpsCap;
        if (!cap || ts - lastRender >= 1000 / cap - 4) {
          lastRender = ts;
          app.renderer.render(app.show.frame(f, dt, app.getText), ts);
        }
        app.lastFeatures = f;
        if (app.onFeatures) app.onFeatures(f);
        if (app.onFrame) app.onFrame(ts, engine.ctx ? engine.ctx.currentTime : 0, f);
        app.errorsInRow = 0;
        // 次の曲名のテクスチャを先に作っておく（曲頭での引っかかり防止）
        if (ts > prefetchAt) {
          prefetchAt = ts + 1000;
          for (const [m, s] of app.show.upcomingTexts()) app.getText(m, s);
        }
      } catch (e) {
        app.errors++;
        app.errorsInRow++;
        app.lastError = e;
        if (globalThis.console) console.error(e);
        if (app.errorsInRow >= 3 && app.show.state.sceneId !== 'title') {
          app.show._applyScene('title');
          toast('エラーのためタイトルに切り替えました', 'warn');
          app.errorsInRow = 0;
        }
      }
      if (f) {
        try {
          VJ.hud.update(app, f, ts);
          VJ.panel.tick(f, ts);
        } catch (e) { /* noop */ }
      }
    }
    requestAnimationFrame(frame);
  }

  /** テスト用 API（?test=1 のときだけ）。rAF を止めて決まった刻みで「DSP→演出→描画」を回す */
  function makeTesting(app) {
    const testing = {
      async runOffline(o) {
        app.paused = true;
        try {
          const sr = o.sampleRate || 48000;
          let samples = o.samples;
          if (samples === 'demo') samples = VJ.synth.demoSong(sr).samples;
          else if (o.song) samples = VJ.synth.song(Object.assign({ sampleRate: sr }, o.song)).samples;
          else if (Array.isArray(samples)) samples = Float32Array.from(samples);
          if (o.offset) samples = samples.subarray(Math.round(o.offset * sr));
          if (o.seconds) samples = samples.subarray(0, Math.round(o.seconds * sr));
          const settings = Object.assign({}, app.settings, o.settings || {});
          app.renderer.setOutput(settings.output);
          if (settings.logo !== undefined) app.renderer.setLogo(settings.logo);
          const show = new VJ.ShowController(settings);
          show.sceneAvailable = (id) => app.renderer.available(id);
          const fx = new VJ.dsp.FeatureExtractor({ sampleRate: sr, config: VJ.makeDspConfig(settings) });
          show.onTap = () => fx.tap();
          if (o.sceneId) show._applyScene(o.sceneId);
          if (o.logoWait) await new Promise((r) => setTimeout(r, o.logoWait));
          const fps = o.fps || 60, dt = 1 / fps, spf = sr / fps;
          const latest = new Float32Array(8192);
          const frames = o.frames || Math.floor(samples.length / spf);
          const res = { luma: [], pngs: {}, scenes: [], flashes: 0, onsets: 0, denied: 0, black: [] };
          let pos = 0;
          for (let k = 0; k < frames; k++) {
            const end = Math.min(samples.length, Math.round((k + 1) * spf));
            const chunk = samples.subarray(pos, end);
            pos = end;
            fx.process(chunk);
            if (chunk.length >= 8192) latest.set(chunk.subarray(chunk.length - 8192));
            else { latest.copyWithin(0, chunk.length); latest.set(chunk, 8192 - chunk.length); }
            const t = (k + 1) * dt;
            const f = fx.computeFrame(latest, t, dt);
            if (o.actions && o.actions[k]) for (const [name, ...args] of o.actions[k]) show[name](...args);
            show.update(f, dt, t);
            if (f.onsetFlags) res.onsets++;
            app.renderer.render(show.frame(f, dt, app.getText), t * 1000);
            if (o.grid) res.luma.push(Array.from(app.renderer.readLumaGrid(o.grid[0], o.grid[1])));
            if (o.pngAt && o.pngAt.includes(k)) res.pngs[k] = app.renderer.canvas.toDataURL('image/png');
            res.scenes.push(show.state.sceneId);
          }
          res.denied = show.limiter.denied;
          res.kickN = fx.features.kickN;
          res.bpm = fx.features.bpm;
          res.melodic = fx.features.melodic;
          return res;
        } finally {
          app.renderer.setOutput(app.settings.output);
          app.renderer.setLogo(app.settings.logo);
          app.paused = false;
        }
      },

      /** ブラウザ内のソフト経路の遅延：クリック列を決まった時刻に鳴らし、
       *  「currentTime がその時刻を超えた瞬間」→「キックが反映されたフレーム」を測る */
      async measureLatency(o) {
        o = o || {};
        const count = o.count || 16;
        const engine = app.engine;
        engine._ensureContext();
        const ctx = engine.ctx;
        await ctx.resume();
        const s = VJ.synth.song({ sampleRate: ctx.sampleRate, bpm: 120, seed: 1, humanize: 0, lead: 0.3, tail: 0.5, sections: [{ bars: Math.ceil(count / 4), drums: 'click' }] });
        const ab = ctx.createBuffer(1, s.samples.length, ctx.sampleRate);
        ab.copyToChannel(s.samples, 0);
        const recs = [];
        app.onFrame = (ts, ct, f) => recs.push([ts, ct, f.onsetFlags & 1]);
        const when = await engine.start({ source: 'buffer', audioBuffer: ab, loop: false, when: ctx.currentTime + 0.3, monitor: false });
        app.ensureExtractor().resync();
        await new Promise((r) => setTimeout(r, (s.duration + 0.6) * 1000));
        app.onFrame = null;
        const lat = [];
        for (const on of s.onsets.kick) {
          const tc = when + on;
          let i = recs.findIndex((r) => r[1] >= tc);
          if (i <= 0) continue;
          const [p0, c0] = recs[i - 1], [p1, c1] = recs[i];
          const avail = p0 + ((tc - c0) / Math.max(1e-6, c1 - c0)) * (p1 - p0);
          let j = i;
          while (j < recs.length && !recs[j][2]) j++;
          if (j < recs.length && recs[j][0] - avail < 300) lat.push(recs[j][0] - avail);
        }
        lat.sort((a, b) => a - b);
        const mean = lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length);
        const sd = Math.sqrt(lat.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, lat.length));
        const iv = [];
        for (let k = 1; k < recs.length; k++) iv.push(recs[k][0] - recs[k - 1][0]);
        iv.sort((a, b) => a - b);
        return { n: lat.length, expected: s.onsets.kick.length, median: lat[Math.floor(lat.length / 2)], mean, sd, max: lat[lat.length - 1], frameInterval: iv[Math.floor(iv.length / 2)], diag: engine.diagnostics() };
      },
    };
    return testing;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis.VJ = globalThis.VJ || {});
