/* サウンドチェック（パネル ①）：静かな状態 5 秒 → 演奏 15 秒 を測り、結果とおすすめの設定を出す。
 * 測るのは app.scBegin / scEnd（main.js。2 画面のときは出力ウィンドウ）、判定は VJ.soundcheck.analyze。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);
  const ICON = { ok: '✅', info: '💡', warn: '⚠️', bad: '❌' };

  const sc = {
    app: null,
    running: false,
    last: null, // { at, worst }（本番前チェックで使う）
    cfg: { quiet: 5, music: 15, musicMin: 6 }, // 秒（テストでは短くする）
    _timer: null,
    _endEarly: null,

    install(app) {
      sc.app = app;
      $('btn-sc').addEventListener('click', () => (sc.running ? sc.cancel() : sc.start()));
    },

    _box(html) {
      const el = $('sc-box');
      el.hidden = false;
      el.innerHTML = html;
      return el;
    },

    /** sec 秒待つ（進み具合の棒を動かす）。opts.minSec を過ぎたら「ここで終える」を押せる */
    _wait(sec, title, opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        const t0 = performance.now();
        const el = sc._box(`<div class="sc-step">${title}</div><div class="sc-bar"><i style="width:0%"></i></div>`
          + `<div class="row"><span class="hint" id="sc-left"></span>`
          + (opts.skip ? `<button id="sc-skip">${esc(opts.skip)}</button>` : '')
          + `<button id="sc-cancel">${esc(t('やめる'))}</button></div>`);
        const bar = el.querySelector('.sc-bar i'), left = el.querySelector('#sc-left'), skip = el.querySelector('#sc-skip');
        const done = (how) => { clearInterval(sc._timer); sc._timer = null; sc._endEarly = null; resolve(how); };
        sc._endEarly = done;
        if (skip) skip.addEventListener('click', () => { if (!skip.disabled) done('skip'); });
        el.querySelector('#sc-cancel').addEventListener('click', () => done('cancel'));
        const tick = () => {
          const e = (performance.now() - t0) / 1000;
          bar.style.width = Math.min(100, (e / sec) * 100).toFixed(1) + '%';
          left.textContent = t('あと {0} 秒', Math.max(0, Math.ceil(sec - e)));
          if (skip && opts.minSec) skip.disabled = e < opts.minSec;
          if (e >= sec) done('time');
        };
        tick();
        sc._timer = setInterval(tick, 100);
      });
    },

    async start() {
      const app = sc.app;
      if (!app.engine.running) { app.ui.toast(t('先に「▶ 音声入力を開始」を押してください'), 'warn'); return; }
      sc.running = true;
      $('btn-sc').textContent = t('サウンドチェックをやめる');
      let quiet = null, music = null;
      try {
        await app.scBegin();
        const q = await sc._wait(sc.cfg.quiet, esc(t('① 会場を静かにしてください（雑音の大きさを測ります）')), { skip: t('飛ばす') });
        const qs = await app.scEnd();
        if (q === 'cancel') return sc._close();
        if (q === 'time') quiet = qs;
        await app.scBegin();
        const m = await sc._wait(sc.cfg.music, esc(t('② 演奏してもらってください（いちばん大きい曲・サビがおすすめ）')), { skip: t('ここで終える'), minSec: sc.cfg.musicMin });
        music = await app.scEnd();
        if (m === 'cancel') return sc._close();
        sc.showResult(VJ.soundcheck.analyze(quiet, music, app.settings));
      } catch (e) {
        sc._box(`<div class="err">${esc(t('サウンドチェックができませんでした：') + ((e && e.message) || e))}</div>`);
      } finally {
        sc.running = false;
        $('btn-sc').textContent = t('サウンドチェック（自動調整）');
      }
    },

    cancel() { if (sc._endEarly) sc._endEarly('cancel'); },

    _close() { $('sc-box').hidden = true; $('sc-box').innerHTML = ''; },

    showResult(r) {
      const app = sc.app, s = app.settings;
      sc.last = { at: Date.now(), worst: r.worst };
      const recs = [];
      if (r.rec.profile) recs.push(['profile', t('音楽のタイプ：{0}', VJ.profileName(VJ.profileById(r.rec.profile))) + ' ' + t('（いま：{0}）', VJ.profileName(VJ.profileById(s.profile)))]);
      if (r.rec.gateDb !== undefined) recs.push(['gateDb', t('無音とみなす音量：{0} dBFS', r.rec.gateDb) + ' ' + t('（いま：{0} dBFS）', s.gateDb)]);
      const el = sc._box(`<div class="sc-step">${esc(t('サウンドチェックの結果'))}</div>`
        + `<ul class="sc-items">${r.items.map((i) => `<li class="${i.level}"><span>${ICON[i.level]}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>`
        + (recs.length ? `<div class="hint">${esc(t('おすすめの設定'))}</div>`
          + recs.map(([k, label]) => `<div class="row"><label><input type="checkbox" data-rec="${k}" checked> ${esc(label)}</label></div>`).join('') : '')
        + `<div class="row">${recs.length ? `<button class="primary" id="sc-apply">${esc(t('おすすめの設定にする'))}</button>` : ''}`
        + `<button id="sc-again">${esc(t('もう一度'))}</button><button id="sc-close">${esc(t('閉じる'))}</button></div>`);
      const apply = el.querySelector('#sc-apply');
      if (apply) apply.addEventListener('click', () => {
        for (const cb of el.querySelectorAll('input[data-rec]')) if (cb.checked) s[cb.dataset.rec] = r.rec[cb.dataset.rec];
        VJ.panel.replaceSettings(s);
        app.ui.toast(t('サウンドチェックのおすすめを設定しました'));
        apply.disabled = true;
        apply.textContent = t('設定しました');
      });
      el.querySelector('#sc-again').addEventListener('click', () => sc.start());
      el.querySelector('#sc-close').addEventListener('click', () => sc._close());
    },
  };

  VJ.soundcheckUI = sc;
})(globalThis.VJ = globalThis.VJ || {});
