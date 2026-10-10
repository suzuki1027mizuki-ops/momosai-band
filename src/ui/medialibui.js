/* メディアの一覧（パネル ⑤「メディアの一覧」）：登録・名前の変更・並べ替え・削除・「出す」。
 * 画像・動画の中身はこの PC の保存場所（mediastore.js）に入れ、設定には鍵だけを持つ（設定ファイルが大きくならないように）。
 * 2 画面のときは、入れた中身を出力ウィンドウへも渡す（link.js の 'media'）。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);
  const KIND_TAG = { image: 'IMG', video: 'VIDEO', web: 'WEB', camera: 'CAM' };

  /** data URL → Blob（fetch を使わない：古い環境・file:// でも動くように） */
  function dataUrlToBlob(url) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
    if (!m) return null;
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: m[1] || 'application/octet-stream' });
  }

  const ui = {
    app: null,
    _thumbs: new Map(), // 鍵 → 見本の object URL
    _del: '', // 「消す？」と確かめている id
    _sig: '',

    install(app) {
      ui.app = app;
      $('btn-ml-add').addEventListener('click', () => ui.addCurrent());
      $('btn-ml-files').addEventListener('click', () => $('ml-files').click());
      $('ml-files').addEventListener('change', (e) => {
        const fs = Array.from(e.target.files || []);
        e.target.value = '';
        ui.addFiles(fs);
      });
      const el = $('ml-list');
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const list = VJ.mediaLib.list(app.settings), i = list.findIndex((x) => x.id === b.dataset.id);
        if (i < 0) return;
        const act = b.dataset.act;
        if (act === 'show') ui.show(list[i].id);
        else if (act === 'up' && i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; ui.changed(); }
        else if (act === 'down' && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; ui.changed(); }
        else if (act === 'del') { ui._del = ui._del === list[i].id ? '' : list[i].id; ui.render(true); }
        else if (act === 'del-yes') ui.remove(list[i].id);
        else if (act === 'del-no') { ui._del = ''; ui.render(true); }
      });
      el.addEventListener('change', (e) => {
        const inp = e.target.closest('input[data-f="name"]');
        if (inp) ui.rename(inp.dataset.id, inp.value);
      });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[data-f="name"]')) e.target.blur(); });
      ui.render(true);
    },

    /** 一覧を描く（名前の入力中は描き直さない。中身が変わっていなければ描き直さない） */
    render(force) {
      const el = $('ml-list');
      if (!el || !ui.app) return;
      const ae = document.activeElement;
      if (!force && ae && el.contains(ae) && ae.matches('input')) return;
      const s = ui.app.settings, o = s.overlay, list = VJ.mediaLib.list(s);
      const cur = o.mediaKind === 'lib' ? o.libId : '';
      const sig = JSON.stringify([list, cur, ui._del, VJ.i18n.lang]);
      if (!force && sig === ui._sig) return;
      ui._sig = sig;
      let html = '';
      list.forEach((x, i) => {
        const thumb = x.kind === 'image' ? `<img data-key="${esc(x.key)}" alt="">` : `<span class="ml-thumb" style="display:flex;align-items:center;justify-content:center;font:10px var(--mono);color:var(--muted)">${KIND_TAG[x.kind]}</span>`;
        html += `<div class="ml-row${cur === x.id ? ' on' : ''}"><span class="ml-no">m${i + 1}</span>${thumb}`
          + `<input type="text" data-f="name" data-id="${esc(x.id)}" value="${esc(x.name)}" maxlength="60" spellcheck="false" data-i18n-skip aria-label="${esc(t('名前'))}">`
          + `<span class="ml-kind">${esc(VJ.panel.mediaKindName(x.kind))}</span>`
          + `<button data-act="show" data-id="${esc(x.id)}" title="${esc(t('出す'))}">▶</button>`
          + `<button data-act="up" data-id="${esc(x.id)}" title="${esc(t('上へ'))}"${i === 0 ? ' disabled' : ''}>▲</button>`
          + `<button data-act="down" data-id="${esc(x.id)}" title="${esc(t('下へ'))}"${i === list.length - 1 ? ' disabled' : ''}>▼</button>`
          + `<button data-act="del" data-id="${esc(x.id)}" title="${esc(t('消す'))}">✕</button></div>`;
        if (ui._del === x.id) {
          html += `<div class="row sl-confirm"><span>${esc(t('一覧から消しますか？（曲・キューの指定は「見つからない」になります）'))}</span>`
            + `<button data-act="del-yes" data-id="${esc(x.id)}">${esc(t('消す'))}</button><button data-act="del-no" data-id="${esc(x.id)}">${esc(t('やめる'))}</button></div>`;
        }
      });
      el.innerHTML = html || `<div class="hint">${esc(t('まだ登録されていません'))}</div>`;
      for (const img of el.querySelectorAll('img[data-key]')) ui._thumb(img.dataset.key).then((u) => { if (u) img.src = u; });
    },

    async _thumb(key) {
      if (ui._thumbs.has(key)) return ui._thumbs.get(key);
      const b = await VJ.mediaStore.get(key);
      if (!b) return '';
      const u = URL.createObjectURL(b);
      ui._thumbs.set(key, u);
      return u;
    },

    /** 一覧が変わった：パネル・セットリストの表・キューを合わせて、設定を反映 */
    changed() {
      VJ.panel.syncOverlay();
      ui.render(true);
      VJ.panel.applyShow(true);
      VJ.setlistEd.render(true);
      if (VJ.cuesUI) VJ.cuesUI.render(true);
    },

    /** 中身を保存場所に入れて鍵を返す（2 画面のときは出力ウィンドウにも渡す） */
    async _store(blob) {
      const key = VJ.mediaStore.newKey();
      const saved = await VJ.mediaStore.put(key, blob);
      VJ.link.send({ t: 'media', key, blob });
      if (!saved) ui.app.ui.toast(t('保存できませんでした。このウィンドウを閉じるまで使えます'), 'warn');
      return key;
    },

    _full() {
      if (VJ.mediaLib.list(ui.app.settings).length < VJ.mediaLib.MAX) return false;
      ui.app.ui.toast(t('一覧はいっぱいです（{0} 個まで）', VJ.mediaLib.MAX), 'warn');
      return true;
    },

    /** 1 件入れる（id・重ならない名前を付ける） */
    add(item, quiet) {
      const s = ui.app.settings;
      if (ui._full()) return null;
      if (!Array.isArray(s.mediaLib)) s.mediaLib = [];
      const c = VJ.mediaLib.clean(Object.assign({}, item, { id: VJ.mediaLib.newId(), name: VJ.mediaLib.uniqueName(s, item.name) }));
      if (!c) return null;
      s.mediaLib.push(c);
      ui.changed();
      if (!quiet) ui.app.ui.toast(t('メディアの一覧に入れました：{0} {1}', VJ.mediaLib.label(s, c.id), c.name));
      return c;
    },

    /** いま「メディアを重ねる」で選んでいるものを一覧に入れる */
    async addCurrent() {
      const s = ui.app.settings, o = s.overlay, kind = o.mediaKind || 'image', toast = (m) => ui.app.ui.toast(m, 'warn');
      if (ui._full()) return null;
      if (kind === 'image') {
        const blob = o.image ? dataUrlToBlob(o.image) : null;
        if (!blob) { toast(t('画像が選ばれていません')); return null; }
        return ui.add({ kind: 'image', key: await ui._store(blob), name: t('画像') });
      }
      if (kind === 'video') {
        if (!o.videoKey) { toast(t('動画が選ばれていません')); return null; }
        return ui.add({ kind: 'video', key: o.videoKey, name: String(o.videoName || '').replace(/\.[^.]+$/, '') || t('動画') });
      }
      if (kind === 'web') {
        const info = VJ.media.parseWebUrl(o.webUrl);
        if (!info) { toast(t('YouTube / ニコニコの URL ではありません')); return null; }
        return ui.add({ kind: 'web', url: o.webUrl, name: (info.provider === 'youtube' ? 'YouTube ' : t('ニコニコ') + ' ') + info.id });
      }
      if (kind === 'camera') return ui.add({ kind: 'camera', cameraId: o.cameraId || '', mirror: !!o.cameraMirror, name: o.cameraLabel || t('カメラ') });
      if (kind === 'capture') { toast(t('画面・タブの取り込みは一覧に入れられません')); return null; }
      toast(t('一覧から出しているメディアです'));
      return null;
    },

    /** ファイル（画像・動画）をまとめて一覧に入れる */
    async addFiles(files) {
      let n = 0;
      for (const f of files) {
        if (ui._full()) break;
        const name = String(f.name || '').replace(/\.[^.]+$/, '').slice(0, 56);
        try {
          if (/^image\//.test(f.type)) {
            const blob = dataUrlToBlob(await VJ.panel._readImage(f, 1920, 4e6));
            if (blob && ui.add({ kind: 'image', key: await ui._store(blob), name: name || t('画像') }, true)) n++;
          } else if (/^video\//.test(f.type) || /\.(mp4|webm|mov|m4v)$/i.test(f.name || '')) {
            if (ui.add({ kind: 'video', key: await ui._store(f), name: name || t('動画') }, true)) n++;
          }
        } catch (e) {
          ui.app.ui.toast(t('読み込めませんでした：{0}', f.name || ''), 'warn');
        }
      }
      if (n) ui.app.ui.toast(t('メディアの一覧に {0} 件入れました', n));
      else if (files.length) ui.app.ui.toast(t('画像か動画のファイルを選んでください'), 'warn');
      return n;
    },

    /** 出す（いまの曲の m:… より優先。次の曲で曲の指定に戻る） */
    show(id) {
      const s = ui.app.settings;
      s.overlay.mediaKind = 'lib';
      s.overlay.libId = id;
      s.overlayOn = true;
      VJ.panel.syncOverlay();
      ui.render(true);
      VJ.panel.applyShow(true);
      ui.app.show.overrideSongMedia();
    },

    /** 名前を変える（ほかと重ならないように。セットリストの「m:古い名前」も書き換える） */
    rename(id, raw) {
      const s = ui.app.settings, it = VJ.mediaLib.byId(s, id);
      if (!it) return;
      const name = VJ.mediaLib.uniqueName(s, String(raw || '').trim() || it.name, id);
      if (name === it.name) { ui.render(true); return; }
      const old = it.name;
      it.name = name;
      // 曲の指定（m:古い名前）を新しい名前に：出ているバンドと、ほかのバンドのセットリスト
      s.setlistText = VJ.mediaLib.renameRefs(s.setlistText, old, name);
      for (const b of Array.isArray(s.bands) ? s.bands : []) if (b && typeof b.setlistText === 'string') b.setlistText = VJ.mediaLib.renameRefs(b.setlistText, old, name);
      if ($('setlist').value !== s.setlistText) $('setlist').value = s.setlistText;
      ui.changed();
    },

    /** 一覧から消す（中身も保存場所から消す。いまの動画が同じ中身なら残す） */
    remove(id) {
      const s = ui.app.settings, list = VJ.mediaLib.list(s), i = list.findIndex((x) => x.id === id);
      if (i < 0) return;
      const [it] = list.splice(i, 1);
      if (s.overlay.mediaKind === 'lib' && s.overlay.libId === id) s.overlay.libId = '';
      ui._del = '';
      if (it.key && ui._thumbs.has(it.key)) { URL.revokeObjectURL(ui._thumbs.get(it.key)); ui._thumbs.delete(it.key); }
      VJ.panel.pruneMedia();
      ui.changed();
    },
  };

  ui.dataUrlToBlob = dataUrlToBlob;
  VJ.mediaLibUI = ui;
})(globalThis.VJ = globalThis.VJ || {});
