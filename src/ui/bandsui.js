/* 出演バンドの一覧（パネル ③）と切替。キー N / Shift+N・スマホ・OSC からも呼ばれる。
 * 2 画面のときは操作ウィンドウが設定を持っているので、出力ウィンドウで受けた切替（スマホ・OSC・キー）は操作側へ回す。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);
  const CONFIRM_SEC = 3;

  const ui = {
    app: null,
    _armed: -1e9, // 演奏中に N を 1 回押した時刻（秒。もう一度で切替）
    _editing: -1, // その場で編集している（出演中でない）バンドの番号

    install(app) {
      ui.app = app;
      $('band-list').addEventListener('click', (e) => {
        if (e.target.closest('[data-act="edit-close"]')) { ui._editing = -1; ui.render(); return; }
        const row = e.target.closest('[data-i]');
        if (!row) return;
        const i = +row.dataset.i, s = app.settings;
        const act = e.target.closest('button') && e.target.closest('button').dataset.act;
        if (act === 'up' || act === 'down') {
          VJ.bands.move(s, i, act === 'up' ? -1 : 1);
          ui._editing = -1;
          ui.render();
          VJ.panel.save();
        } else if (act === 'del') {
          if (!confirm(t('「{0}」を一覧から消しますか？（セットリスト・ロゴも消えます）', VJ.bands.nameOf(s, i) || t('（名前なし）')))) return;
          const wasCur = i === s.bandIdx;
          VJ.bands.remove(s, i);
          ui._editing = -1;
          if (wasCur) ui._applied(); else { ui.render(); VJ.panel.save(); }
        } else if (act === 'edit') {
          // 出演中のバンドは下の欄で編集。ほかのバンドはその場で（切り替えずに）名前・開演時刻・セットリストを
          if (i === s.bandIdx) { $('band').focus(); $('band').scrollIntoView({ block: 'center' }); return; }
          ui._editing = ui._editing === i ? -1 : i;
          ui.render();
          const f = $('band-list').querySelector('[data-bf="bandName"]');
          if (f) f.focus();
        } else if (i !== s.bandIdx) {
          if (ui.midSet() && !confirm(t('演奏中です。「{0}」に切り替えますか？', VJ.bands.nameOf(s, i) || t('（名前なし）')))) return;
          ui.switchTo(i);
        }
      });
      $('band-add').addEventListener('click', () => {
        const i = VJ.bands.add(app.settings, '');
        if (i < 0) { app.ui.toast(t('これ以上追加できません'), 'warn'); return; }
        if (ui.midSet()) {
          // 演奏中は切り替えない（次のバンドの準備をその場で）
          ui._editing = i;
          ui.render();
          VJ.panel.save();
          const f = $('band-list').querySelector('[data-bf="bandName"]');
          if (f) f.focus();
          app.ui.toast(t('追加しました（演奏中なので切り替えていません）'));
          return;
        }
        ui.switchTo(i);
        $('band').focus();
      });
      // その場の編集：入力した値をそのバンドに入れる（出演中のバンドは上の階層にあるので対象外）
      const onEdit = (e, done) => {
        const el = e.target.closest('[data-bf]');
        if (!el) return;
        const s = app.settings, i = ui._editing;
        if (!(i >= 0 && i < s.bands.length) || i === s.bandIdx) return;
        s.bands[i][el.dataset.bf] = el.value;
        VJ.panel.save();
        if (done) ui._refreshRows();
      };
      $('band-list').addEventListener('input', (e) => onEdit(e, false));
      $('band-list').addEventListener('change', (e) => onEdit(e, true));
      $('band-next').addEventListener('click', () => {
        if (ui.midSet() && !confirm(t('演奏中です。次のバンドに切り替えますか？'))) return;
        ui.step(1, { force: true });
      });
      ui.render();
    },

    /** 曲の途中（1 曲目〜最後の曲）か */
    midSet() {
      const st = ui.app.show.state;
      return st.songIdx >= 0 && !st.endState;
    },

    /** d（+1 / -1）だけ隣のバンドへ。演奏中にキーで押したときは 2 回目で切り替える（誤操作の防止） */
    step(d, opts) {
      opts = opts || {};
      const app = ui.app, s = app.settings;
      if (VJ.link.role === 'output') { VJ.link.send({ t: 'band', d, force: !!opts.force }); return true; }
      VJ.bands.ensure(s);
      const i = s.bandIdx + d;
      if (i < 0 || i >= s.bands.length) {
        app.ui.toast(s.bands.length < 2 ? t('出演バンドが 1 つだけです（設定 M の ③ で追加）') : d > 0 ? t('最後のバンドです') : t('最初のバンドです'), 'warn');
        return false;
      }
      if (!opts.force && ui.midSet()) {
        const now = performance.now() / 1000;
        if (now - ui._armed > CONFIRM_SEC) {
          ui._armed = now;
          app.ui.toast(t('演奏中です。もう一度押すと「{0}」に切り替えます', VJ.bands.nameOf(s, i) || t('（名前なし）')), 'warn');
          return false;
        }
      }
      ui._armed = -1e9;
      return ui.switchTo(i);
    },

    /** i 番目のバンドにする（スマホ・OSC からは番号で） */
    switchTo(i) {
      const app = ui.app, s = app.settings;
      if (VJ.link.role === 'output') { VJ.link.send({ t: 'band', i }); return true; }
      if (!VJ.bands.select(s, i)) return false;
      ui._applied();
      return true;
    },

    /** 設定のバンドの値が入れ替わったあと：入力欄・映像（2 画面なら出力側も）を合わせ、開演前に戻す */
    _applied() {
      const app = ui.app;
      VJ.panel.replaceSettings(app.settings);
      app.show.resetShow();
      ui.render();
    },

    render() {
      const app = ui.app;
      if (!app || !$('band-list')) return;
      const s = app.settings;
      // 入力中は作り直さない（文字が消えないように）。一覧の行だけ更新する
      if ($('band-list').contains(document.activeElement) && document.activeElement.matches('[data-bf]')) { ui._refreshRows(); return; }
      const list = VJ.bands.list(s);
      const n = list.length;
      if (ui._editing === s.bandIdx || ui._editing >= n) ui._editing = -1;
      // 名前・時刻・セットリストは入力された文字なので訳さない
      $('band-list').innerHTML = list.map((b) => `<div class="band-row${b.current ? ' on' : ''}${ui._editing === b.i ? ' editing' : ''}" data-i="${b.i}">`
        + `<span class="bi">${b.i + 1}</span><span class="bt" data-i18n-skip>${esc(b.start || '')}</span>`
        + `<span class="bn" data-i18n-skip>${esc(b.name || t('（名前なし）'))}</span>`
        + `<span class="bs">${esc(t('{0} 曲', b.songs))}${b.current ? ' · ' + esc(t('出演中')) : ''}</span>`
        + `<button data-act="edit" title="${esc(b.current ? t('下の欄で編集') : t('切り替えずに編集'))}">✎</button>`
        + `<button data-act="up" title="${esc(t('上へ'))}"${b.i === 0 ? ' disabled' : ''}>▲</button>`
        + `<button data-act="down" title="${esc(t('下へ'))}"${b.i === n - 1 ? ' disabled' : ''}>▼</button>`
        + `<button data-act="del" title="${esc(t('消す'))}"${n < 2 ? ' disabled' : ''}>✕</button></div>`
        + (ui._editing === b.i ? ui._editHtml(b.i) : '')).join('');
      $('band-next').disabled = n < 2;
    },

    /** 出演中でないバンドをその場で編集する欄（名前・開演時刻・セットリスト） */
    _editHtml(i) {
      const b = VJ.bands.get(ui.app.settings, i) || {};
      return `<div class="band-edit" data-i18n-skip>`
        + `<div class="row"><input type="text" data-bf="bandName" value="${esc(b.bandName || '')}" placeholder="${esc(t('バンド名'))}" style="flex: 1; width: auto">`
        + `<span>${esc(t('開演'))}</span><input type="time" data-bf="countdownTo" value="${esc(b.countdownTo || '')}"></div>`
        + `<textarea data-bf="setlistText" spellcheck="false" placeholder="${esc(t('1 行 1 曲（曲名 | シーン | パレット）'))}">${esc(b.setlistText || '')}</textarea>`
        + `<div class="row"><span class="hint">${esc(t('ロゴ・音楽のタイプ・色・テロップは、出演中にしてから下の欄で'))}</span>`
        + `<button data-act="edit-close">${esc(t('閉じる'))}</button></div></div>`;
    },

    /** 一覧の行の名前・時刻・曲数だけを更新（編集中の欄は残す） */
    _refreshRows() {
      const list = VJ.bands.list(ui.app.settings);
      for (const b of list) {
        const row = $('band-list').querySelector(`.band-row[data-i="${b.i}"]`);
        if (!row) continue;
        row.querySelector('.bt').textContent = b.start || '';
        row.querySelector('.bn').textContent = b.name || t('（名前なし）');
        row.querySelector('.bs').textContent = t('{0} 曲', b.songs) + (b.current ? ' · ' + t('出演中') : '');
      }
    },

    /** スマホ・HUD 用の状態 */
    state(s) {
      VJ.bands.ensure(s);
      return { i: s.bandIdx, n: s.bands.length, name: VJ.bands.nameOf(s, s.bandIdx), next: s.bandIdx + 1 < s.bands.length ? VJ.bands.nameOf(s, s.bandIdx + 1) : '' };
    },
  };

  VJ.bandsUI = ui;
})(globalThis.VJ = globalThis.VJ || {});
