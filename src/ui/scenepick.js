/* シーンを絵で選ぶ：見本画像（VJ.thumbs）つきのボタン一覧（パネル ⑥）と、印刷用のキー早見表。
 * ボタンを押すとキーと同じ動き（次のビートで切替。もう一度押すとすぐ。タイトルはすぐ）。
 * セットリストの表（setlisted.js）のシーン選びもここの部品を使う。 */
(function (VJ) {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);

  /** キーの表示（'s3' → '⇧3'） */
  const keyLabel = (d) => (d.key.startsWith('s') ? '⇧' + d.key.slice(1) : d.key);

  const pick = {
    /** 見本にするシーン（テストパターンなどの隠しシーンは除く）。キーの順（0, 1〜9, ⇧1〜⇧9） */
    list() {
      const order = (d) => (d.id === 'title' ? -1 : d.key.startsWith('s') ? 10 + +d.key.slice(1) : +d.key || 50);
      return VJ.scenes.list.filter((d) => !d.hidden).sort((a, b) => order(a) - order(b));
    },

    thumb(id) { return (VJ.thumbs && VJ.thumbs[id]) || ''; },

    /** 1 つのシーンのボタン（data-scene） */
    button(d, extra) {
      const img = pick.thumb(d.id);
      return `<button type="button" class="scene-btn${extra ? ' ' + extra : ''}" data-scene="${esc(d.id)}" title="${esc(VJ.sceneName(d))}">`
        + (img ? `<img src="${img}" alt="" draggable="false">` : '<span class="noimg"></span>')
        + `<span class="sk">${esc(keyLabel(d))}</span><span class="sn">${esc(VJ.sceneName(d))}</span></button>`;
    },

    /** パネルの一覧を描く（言語を切り替えたときも呼ぶ） */
    render(app) {
      pick.app = app;
      const el = document.getElementById('scene-grid');
      if (!el) return;
      el.innerHTML = pick.list().map((d) => pick.button(d)).join('');
      pick._sig = '';
      pick.update(true);
    },

    install(app) {
      pick.app = app;
      const el = document.getElementById('scene-grid');
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-scene]');
        if (!b) return;
        const id = b.dataset.scene;
        const show = pick.app.show;
        if (show.state && show.state.locked) { pick.app.ui.toast(t('ロック中（L 長押しで解除 / B は暗転）'), 'warn'); return; }
        show.selectScene(id, { immediate: id === 'title' });
        if (pick.app.onAction) pick.app.onAction('scene-grid');
        pick.update(true);
      });
      document.getElementById('btn-cheatsheet').addEventListener('click', () => pick.printSheet());
      pick.render(app);
    },

    /** いまのシーン・切替待ちのシーンに印を付ける（パネルの更新ごと） */
    update(force) {
      const st = pick.app && pick.app.show && pick.app.show.state;
      if (!st) return;
      const sig = st.sceneId + '|' + (st.pending ? st.pending.id : '');
      if (!force && sig === pick._sig) return;
      pick._sig = sig;
      for (const b of document.querySelectorAll('#scene-grid button[data-scene]')) {
        b.classList.toggle('on', b.dataset.scene === st.sceneId);
        b.classList.toggle('pending', !!st.pending && b.dataset.scene === st.pending.id);
      }
    },

    /** 印刷用の早見表（A4 横 1 枚）。単体アプリでも使えるよう、別ウィンドウではなくページ内の枠で印刷する */
    sheetHtml() {
      const app = pick.app, s = app ? app.settings : {};
      const name = (app && app.show && app.show.bandName && app.show.bandName()) || s.bandName || '';
      const cell = (d) => `<div class="c"><div class="im">${pick.thumb(d.id) ? `<img src="${pick.thumb(d.id)}">` : ''}<b>${esc(keyLabel(d))}</b></div><span>${esc(VJ.sceneName(d))}</span></div>`;
      const keys = VJ.keys.KEY_HELP.filter(([k]) => !/^(1〜9|Shift\+1〜9|0)$/.test(k))
        .map(([k, v]) => `<tr><td><kbd>${esc(t(k))}</kbd></td><td>${esc(t(v))}</td></tr>`).join('');
      return `<!doctype html><html lang="${VJ.i18n.lang}"><head><meta charset="utf-8"><title>${esc(t('キー早見表'))}</title><style>
@page { size: A4 landscape; margin: 10mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 11px/1.35 "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 16px; margin: 0 0 6px; } h1 small { font-weight: normal; color: #555; margin-left: 8px; }
.wrap { display: grid; grid-template-columns: 1fr 64mm; gap: 6mm; }
.scenes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3mm; align-content: start; }
.c span { display: block; text-align: center; font-size: 10px; }
.im { position: relative; aspect-ratio: 16 / 9; background: #111; border-radius: 2mm; overflow: hidden; }
.im img { width: 100%; height: 100%; object-fit: cover; display: block; }
.im b { position: absolute; left: 1mm; top: 1mm; background: #fff; color: #000; border-radius: 1mm; padding: 0 1.5mm; font-size: 13px; }
table { border-collapse: collapse; width: 100%; } td { border-bottom: 0.2mm solid #bbb; padding: 0.8mm 1mm; vertical-align: top; }
kbd { font-family: ui-monospace, Menlo, Consolas, monospace; border: 0.2mm solid #888; border-radius: 1mm; padding: 0 1mm; white-space: nowrap; }
p { margin: 4px 0 0; color: #444; }
</style></head><body><h1>MOMOSAI VJ — ${esc(t('キー早見表'))}${name ? `<small>${esc(name)}</small>` : ''}</h1>
<div class="wrap"><div><div class="scenes">${pick.list().map(cell).join('')}</div>
<p>${esc(t('数字キー（⇧ は Shift を押しながら）で次のビートに切替。もう一度押すとすぐ。0 はタイトル。'))}</p></div>
<div><table>${keys}</table></div></div></body></html>`;
    },

    printSheet() {
      const old = document.getElementById('print-frame');
      if (old) old.remove();
      const f = document.createElement('iframe');
      f.id = 'print-frame';
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(f);
      const doc = f.contentDocument;
      doc.open();
      doc.write(pick.sheetHtml());
      doc.close();
      const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { pick.app.ui.toast(t('印刷できませんでした：') + e.message, 'warn'); } };
      // 画像を読み込んでから印刷
      const imgs = Array.from(doc.images);
      Promise.all(imgs.map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = r; im.onerror = r; })))).then(() => setTimeout(go, 50));
    },
  };

  pick.keyLabel = keyLabel;
  VJ.scenePick = pick;
})(globalThis.VJ = globalThis.VJ || {});
