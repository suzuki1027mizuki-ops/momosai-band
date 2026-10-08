/* 出演バンドの一覧（パネル ③）と切替。キー N / Shift+N・スマホ・OSC からも呼ばれる。
 * 2 画面のときは操作ウィンドウが設定を持っているので、出力ウィンドウで受けた切替（スマホ・OSC・キー）は操作側へ回す。
 * 本番中（演奏中・音が来ている・ショー開始後）の切替は、キーは 2 回押し、パネルはその場の確認ボタンで（誤操作で
 * タイトルに戻らないように）。確認ダイアログ（confirm）は使わない：2 画面のとき出力の映像まで止まるため。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);
  const CONFIRM_SEC = 3;

  const ui = {
    app: null,
    _armed: { t: -1e9, d: 0 }, // 本番中に N を 1 回押した時刻（秒）と向き（もう一度で切替）
    _editing: -1, // その場で編集している（出演中でない）バンドの番号
    _confirm: null, // その場の確認 { act: 'switch' | 'del', i }

    install(app) {
      ui.app = app;
      $('band-list').addEventListener('click', (e) => {
        if (e.target.closest('[data-act="edit-close"]')) { ui._editing = -1; ui.render(); return; }
        const cf = e.target.closest('[data-cf]');
        if (cf) {
          const c = ui._confirm;
          ui._confirm = null;
          if (cf.dataset.cf === 'yes' && c) {
            if (c.act === 'switch') ui.switchTo(c.i);
            else if (c.act === 'del') ui.remove(c.i);
          }
          ui.render();
          return;
        }
        const row = e.target.closest('[data-i]');
        if (!row) return;
        const i = +row.dataset.i, s = app.settings;
        const act = e.target.closest('button') && e.target.closest('button').dataset.act;
        if (act === 'up' || act === 'down') {
          VJ.bands.move(s, i, act === 'up' ? -1 : 1);
          ui._editing = -1;
          ui._confirm = null;
          ui.changed();
        } else if (act === 'del') {
          ui._confirm = { act: 'del', i };
          ui.render();
        } else if (act === 'edit') {
          // 出演中のバンドは下の欄で編集。ほかのバンドはその場で（切り替えずに）名前・開演時刻・セットリストを
          if (i === s.bandIdx) { $('band').focus(); $('band').scrollIntoView({ block: 'center' }); return; }
          ui._editing = ui._editing === i ? -1 : i;
          ui.render();
          const f = $('band-list').querySelector('[data-bf="bandName"]');
          if (f) f.focus();
        } else if (!act && i !== s.bandIdx) {
          // 行を押す：本番中はその場で確かめてから
          if (ui.live()) { ui._confirm = { act: 'switch', i }; ui.render(); } else ui.switchTo(i);
        }
      });
      $('band-add').addEventListener('click', () => {
        const i = VJ.bands.add(app.settings, '');
        if (i < 0) { app.ui.toast(t('これ以上追加できません'), 'warn'); return; }
        // 追加しても切り替えない（本番中にタイトルへ戻らないように）。その場で名前・開演時刻・セットリストを
        ui._editing = i;
        ui.changed();
        const f = $('band-list').querySelector('[data-bf="bandName"]');
        if (f) f.focus();
        app.ui.toast(t('追加しました。行を押すと出演中になります'));
      });
      // その場の編集：入力した値をそのバンドに入れる（出演中のバンドは上の階層にあるので対象外）
      const onEdit = (e, done) => {
        const el = e.target.closest('[data-bf]');
        if (!el) return;
        const s = app.settings, i = ui._editing;
        if (!(i >= 0 && i < s.bands.length) || i === s.bandIdx) return;
        s.bands[i][el.dataset.bf] = el.value;
        VJ.bands.touch();
        // 2 画面なら出力側へも（タイトルの「次は ○○」・スマホの表示）
        VJ.panel.applyShow();
        if (done) ui._refreshRows();
      };
      $('band-list').addEventListener('input', (e) => onEdit(e, false));
      $('band-list').addEventListener('change', (e) => onEdit(e, true));
      $('band-next').addEventListener('click', () => ui.step(1));
      ui.render();
    },

    /** 曲の途中（1 曲目〜最後の曲）か */
    midSet() {
      const st = ui.app.show.state;
      return st.songIdx >= 0 && !st.endState;
    },

    /** 本番中か：曲の途中・ショー開始後・音が来ている（セットリストの無いバンドの演奏中・1 曲目の前も含む） */
    live() {
      const app = ui.app;
      const f = VJ.link.role === 'control' ? VJ.link._features : app.lastFeatures;
      return ui.midSet() || !!VJ.guard.showing || !!(app.engine.running && f && f.active);
    },

    /** 一覧を変えたあと：2 画面なら出力側へも送り、保存する */
    changed() {
      ui.render();
      VJ.panel.applyShow();
    },

    /** i 番目を消す（出演中なら隣に切り替わる） */
    remove(i) {
      const s = ui.app.settings;
      const wasCur = i === s.bandIdx;
      if (!VJ.bands.remove(s, i)) return false;
      ui._editing = -1;
      if (wasCur) ui._applied(); else ui.changed();
      return true;
    },

    /** d（+1 / -1）だけ隣のバンドへ。演奏中にキーで押したときは 2 回目で切り替える（誤操作の防止） */
    step(d, opts) {
      opts = opts || {};
      const app = ui.app, s = app.settings;
      if (VJ.link.role === 'output') return ui._toControl({ t: 'band', d, force: !!opts.force });
      VJ.bands.ensure(s);
      const i = s.bandIdx + d;
      if (i < 0 || i >= s.bands.length) {
        app.ui.toast(s.bands.length < 2 ? t('出演バンドが 1 つだけです（設定 M の ③ で追加）') : d > 0 ? t('最後のバンドです') : t('最初のバンドです'));
        return false;
      }
      if (!opts.force && ui.live()) {
        const now = performance.now() / 1000;
        if (now - ui._armed.t > CONFIRM_SEC || ui._armed.d !== d) {
          ui._armed = { t: now, d };
          app.ui.toast(t('本番中です。もう一度押すと「{0}」に切り替えます', VJ.bands.nameOf(s, i) || t('（名前なし）')), 'warn');
          return false;
        }
      }
      ui._armed = { t: -1e9, d: 0 };
      return ui.switchTo(i);
    },

    /** i 番目のバンドにする（スマホ・OSC からは番号で） */
    switchTo(i) {
      const app = ui.app, s = app.settings;
      if (VJ.link.role === 'output') return ui._toControl({ t: 'band', i });
      if (!VJ.bands.select(s, i)) return false;
      ui._applied();
      return true;
    },

    /** 出力ウィンドウ：設定を持っている操作ウィンドウへ頼む（閉じられていたら知らせる） */
    _toControl(msg) {
      if (VJ.link.send(msg)) return true;
      ui.app.ui.toast(t('操作ウィンドウが閉じられているため、バンドを切り替えられません'), 'warn');
      return false;
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
      VJ.bands.ensure(s);
      // 編集していたバンドが出演中になった（スマホなどから）・無くなった：その場の編集欄を閉じる
      const closeEdit = ui._editing === s.bandIdx || ui._editing >= s.bands.length;
      if (closeEdit) ui._editing = -1;
      // 入力中は作り直さない（文字が消えないように）。一覧の行だけ更新する
      if (!closeEdit && $('band-list').contains(document.activeElement) && document.activeElement.matches('[data-bf]')) { ui._refreshRows(); return; }
      const list = VJ.bands.list(s);
      const n = list.length;
      const c = ui._confirm && ui._confirm.i < n && !(ui._confirm.act === 'switch' && ui._confirm.i === s.bandIdx) ? ui._confirm : null;
      ui._confirm = c;
      const name = (i) => VJ.bands.nameOf(s, i) || t('（名前なし）');
      const confirmHtml = (b) => (!c || c.i !== b.i ? '' : `<div class="band-confirm"><span data-i18n-skip>${esc(c.act === 'del'
        ? (b.current ? t('出演中の「{0}」を消しますか？（隣のバンドに切り替わり、タイトルに戻ります）', name(b.i)) : t('「{0}」を一覧から消しますか？（セットリスト・ロゴも消えます）', name(b.i)))
        : t('「{0}」に切り替えますか？（いまの演奏はタイトルに戻ります）', name(b.i)))}</span>`
        + `<button data-cf="yes">${esc(c.act === 'del' ? t('消す') : t('切り替える'))}</button><button data-cf="no">${esc(t('やめる'))}</button></div>`);
      // 名前・時刻・セットリストは入力された文字なので訳さない
      $('band-list').innerHTML = list.map((b) => `<div class="band-row${b.current ? ' on' : ''}${ui._editing === b.i ? ' editing' : ''}" data-i="${b.i}">`
        + `<span class="bi">${b.i + 1}</span><span class="bt" data-i18n-skip>${esc(b.start || '')}</span>`
        + `<span class="bn" data-i18n-skip>${esc(b.name || t('（名前なし）'))}</span>`
        + `<span class="bs">${esc(t('{0} 曲', b.songs))}${b.current ? ' · ' + esc(t('出演中')) : ''}</span>`
        + `<button data-act="edit" title="${esc(b.current ? t('下の欄で編集') : t('切り替えずに編集'))}">✎</button>`
        + `<button data-act="up" title="${esc(t('上へ'))}"${b.i === 0 ? ' disabled' : ''}>▲</button>`
        + `<button data-act="down" title="${esc(t('下へ'))}"${b.i === n - 1 ? ' disabled' : ''}>▼</button>`
        + `<button data-act="del" title="${esc(t('消す'))}"${n < 2 ? ' disabled' : ''}>✕</button></div>`
        + confirmHtml(b) + (ui._editing === b.i ? ui._editHtml(b.i) : '')).join('');
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
