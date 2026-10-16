/* パネルの ①〜⑦ を折りたためるように。見出しを押すと開閉し、閉じた見出しは設定（panelFold）に覚える。
 * 「すべて開く / すべて閉じる」と、ガイド・本番前チェックから飛ぶときは自動で開く（open）。
 * パネルの上の目次（①〜⑦ へ飛ぶ。いま見ている項目に印）と、説明の文を出す / 隠す（panelHelp）もここ。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const sections = {
    app: null,

    install(app) {
      sections.app = app;
      for (const sec of sections.list()) {
        sec.querySelector('.psec-btn').addEventListener('click', () => sections.toggle(+sec.dataset.sec));
      }
      $('psec-open-all').addEventListener('click', () => sections.setAll(false));
      $('psec-close-all').addEventListener('click', () => sections.setAll(true));
      $('psec-help').addEventListener('click', () => {
        const s = app.settings;
        s.panelHelp = s.panelHelp === false;
        sections.render();
        VJ.panel.save();
      });
      $('psec-adv').addEventListener('click', () => sections.toggleAdvanced());
      $('psec-live').addEventListener('click', () => sections.toggleLive());
      sections.adopt(app.settings);
      // 目次・いまの状態を押すと、その項目へ（閉じていたら開く）
      $('panel-top').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-go]');
        if (b) sections.go(+b.dataset.go);
      });
      // 上に残る部分の高さ（飛んだ先の見出しが、その下に隠れないように）
      const panel = $('panel'), top = $('panel-top');
      const measure = () => {
        const sticky = getComputedStyle(top).position === 'sticky';
        panel.style.setProperty('--top-h', (sticky ? top.offsetHeight : 0) + 'px');
        sections.mark();
      };
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(top);
      window.addEventListener('resize', measure);
      let queued = false;
      panel.addEventListener('scroll', () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; sections.mark(); });
      }, { passive: true });
      sections.render();
      measure();
    },

    list() { return Array.from(document.querySelectorAll('#panel .psec')); },
    fold() {
      const s = sections.app.settings;
      if (!s.panelFold || typeof s.panelFold !== 'object') s.panelFold = {};
      return s.panelFold;
    },
    isOpen(n) { return !sections.fold()[n]; },

    /** n 番（1〜7）を閉じる / 開く */
    set(n, closed) {
      const f = sections.fold();
      if (!!f[n] === !!closed) return;
      if (closed) f[n] = true;
      else delete f[n];
      sections._leaveLive();
      sections.render();
      VJ.panel.save();
    },
    toggle(n) { sections.set(n, sections.isOpen(n)); },
    open(n) { sections.set(n, false); },
    setAll(closed) {
      const f = sections.fold();
      for (const sec of sections.list()) {
        if (closed) f[sec.dataset.sec] = true;
        else delete f[sec.dataset.sec];
      }
      sections._leaveLive();
      sections.render();
      VJ.panel.save();
    },

    /** 本番だけ表示：⑥ 本番だけを開き、ほかを閉じる。もう一度押すと、入る前の開き方に戻す。
     *  見出しを手で開け閉めしたら（目次・ガイドから飛んだときも）、その開き方のまま抜ける */
    toggleLive() {
      const s = sections.app.settings;
      if (s.panelLive) {
        s.panelFold = Object.assign({}, s.panelFoldPrev || {});
        s.panelFoldPrev = {};
        s.panelLive = false;
      } else {
        s.panelFoldPrev = Object.assign({}, sections.fold());
        const f = {};
        for (const sec of sections.list()) if (sec.dataset.sec !== '6') f[sec.dataset.sec] = true;
        s.panelFold = f;
        s.panelLive = true;
      }
      sections.render();
      VJ.panel.save();
      if (s.panelLive) document.querySelector('#panel .psec[data-sec="6"]').scrollIntoView({ block: 'start' });
    },
    _leaveLive() {
      const s = sections.app.settings;
      if (!s.panelLive) return;
      s.panelLive = false;
      s.panelFoldPrev = {};
    },

    /** 拡張機能（照明・OSC・MIDI の割り当て・シーンごとの調整・透過ウィンドウ・画質やフレームレートなど）を使っているか */
    usesAdvanced(s) {
      return !!((s.osc && s.osc.enabled) || (s.dmx && s.dmx.enabled) || Object.keys(s.midiMap || {}).length || Object.keys(s.sceneParams || {}).length
        || s.desynchronized === false || s.latencySquare || s.maxScale < 1 || s.fpsCap > 0);
    },
    /** 設定を読み込んだとき（起動・読み込み・初期化・バンドの切替）：使っている拡張機能があれば表示にする。
     *  隠すほうへは自動で戻さない（使っている人が設定を見失わないように） */
    adopt(s) {
      if (!s.panelAdvanced && sections.usesAdvanced(s)) s.panelAdvanced = true;
    },
    toggleAdvanced() {
      const s = sections.app.settings;
      s.panelAdvanced = !s.panelAdvanced;
      sections.render();
      VJ.panel.save();
    },

    /** n 番の項目を開いて、そこまでスクロールし、見出しを少し光らせる */
    go(n) {
      const sec = document.querySelector(`#panel .psec[data-sec="${n}"]`);
      if (!sec) return;
      sections.open(n);
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const h = sec.querySelector('h2');
      h.classList.remove('flash-h');
      void h.offsetWidth;
      h.classList.add('flash-h');
    },

    /** 目次に、いま見ている項目の印を付ける（パネルの上の端にいちばん近い項目） */
    mark() {
      const panel = $('panel'), nav = $('pnav');
      if (!panel || !nav) return;
      const line = panel.getBoundingClientRect().top + (parseFloat(panel.style.getPropertyValue('--top-h')) || 0) + 24;
      let cur = 0;
      for (const sec of sections.list()) {
        if (sec.getBoundingClientRect().top <= line) cur = +sec.dataset.sec;
      }
      // いちばん下まで来たら、最後の項目（短い項目は、上の端まで届かない）
      if (panel.scrollTop > 0 && panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4) {
        const all = sections.list();
        const last = all[all.length - 1];
        if (last && last.getBoundingClientRect().top < panel.getBoundingClientRect().bottom) cur = Math.max(cur, +last.dataset.sec);
      }
      if (cur === sections._cur) return;
      sections._cur = cur;
      for (const b of nav.querySelectorAll('button[data-go]')) b.classList.toggle('on', +b.dataset.go === cur);
    },

    render() {
      const f = sections.fold(), s = sections.app.settings;
      for (const sec of sections.list()) {
        const closed = !!f[sec.dataset.sec];
        sec.classList.toggle('closed', closed);
        sec.querySelector('.psec-btn').setAttribute('aria-expanded', String(!closed));
        const nb = document.querySelector(`#pnav button[data-go="${sec.dataset.sec}"]`);
        if (nb) nb.classList.toggle('closed', closed);
      }
      // 説明の文（.help）を出す / 隠す
      const help = s.panelHelp !== false;
      $('panel').classList.toggle('nohelp', !help);
      const hb = $('psec-help'), label = VJ.t(help ? '説明を隠す' : '説明を表示');
      if (hb.textContent !== label) hb.textContent = label;
      // 拡張機能（data-adv の部品）を出す / 隠す。本番だけ表示
      $('panel').classList.toggle('adv', !!s.panelAdvanced);
      const ab = $('psec-adv'), al = VJ.t(s.panelAdvanced ? '拡張機能を隠す' : '拡張機能を表示');
      if (ab && ab.textContent !== al) ab.textContent = al;
      const lb = $('psec-live');
      if (lb) { lb.classList.toggle('on', !!s.panelLive); lb.setAttribute('aria-pressed', String(!!s.panelLive)); }
      sections.mark();
    },
  };

  VJ.sections = sections;
})(globalThis.VJ = globalThis.VJ || {});
