/* パネルの ①〜⑦ を折りたためるように。見出しを押すと開閉し、閉じた見出しは設定（panelFold）に覚える。
 * 「すべて開く / すべて閉じる」と、ガイド・本番前チェックから飛ぶときは自動で開く（open）。 */
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
      sections.render();
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
      sections.render();
      VJ.panel.save();
    },

    render() {
      const f = sections.fold();
      for (const sec of sections.list()) {
        const closed = !!f[sec.dataset.sec];
        sec.classList.toggle('closed', closed);
        sec.querySelector('.psec-btn').setAttribute('aria-expanded', String(!closed));
      }
    },
  };

  VJ.sections = sections;
})(globalThis.VJ = globalThis.VJ || {});
