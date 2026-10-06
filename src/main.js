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
      if (!app.extractor || app.extractor.sr !== sr) {
        app.extractor = new VJ.dsp.FeatureExtractor({ sampleRate: sr });
        app.extractor.setSensitivity(app.show.state.sens);
      }
      return app.extractor;
    };
    app.getText = (main, sub) => app.renderer.text.get(main, sub);
    app.startAudio = async (opts) => {
      await app.engine.start(opts);
      app.ensureExtractor().resync();
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
      togglePanel: () => VJ.panel.toggle(),
      closeOverlays: () => { help.hidden = true; VJ.hud.toggle(false); VJ.panel.toggle(false); },
      enterFullscreen: () => VJ.guard.enterFullscreen(),
      softReset: async () => {
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
      },
    };
    help.addEventListener('click', () => { help.hidden = true; });

    VJ.hud.init(document.getElementById('hud'));
    VJ.guard.install();
    VJ.keys.install(app);
    VJ.panel.init(app);
    if (VJ.params.test) VJ.testing = makeTesting(app);

    let last = 0;
    const silent = new Float32Array(8192);
    let prefetchAt = 0;
    function frame(ts) {
      requestAnimationFrame(frame);
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
        app.renderer.render(app.show.frame(f, dt, app.getText), ts);
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
          if (o.seconds) samples = samples.subarray(0, Math.round(o.seconds * sr));
          const settings = Object.assign({}, app.settings, o.settings || {});
          const show = new VJ.ShowController(settings);
          show.sceneAvailable = (id) => app.renderer.available(id);
          const fx = new VJ.dsp.FeatureExtractor({ sampleRate: sr });
          if (o.sceneId) show._applyScene(o.sceneId);
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
          return res;
        } finally {
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
