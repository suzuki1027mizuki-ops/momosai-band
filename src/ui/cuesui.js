/* キュー（パネル ⑥）：シーン・色・メディア・重ねるシーンを 1 回でまとめて切り替えるボタンと、その編集。
 * 出す：ボタン・Alt+1〜9・MIDI・スマホ・OSC（/vj/cue 1）。設定（メディア・重ねるシーン）は設定を持っているウィンドウで変えるので、
 * 2 画面の出力ウィンドウで受けたときは操作ウィンドウへ渡す（link.js の 'cue'）。中身の形は src/show/cues.js。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { html, raw } = VJ.dom; // 値を必ずエスケープする HTML（dom.js）
  const t = (...a) => VJ.t(...a);

  const ui = {
    app: null,
    _del: -1, // 「消す？」と確かめているキューの番号
    _sig: '',
    _gridSig: '',

    install(app) {
      ui.app = app;
      $('cue-grid').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-cue]');
        if (b) ui.recall(+b.dataset.cue);
      });
      $('btn-cue-add').addEventListener('click', () => ui.add());
      const ed = $('cue-edit');
      ed.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const list = ui.list(), i = +b.dataset.i, act = b.dataset.act;
        if (!list[i]) return;
        if (act === 'capture') { list[i] = VJ.cues.capture(app.settings, app.show.state, list[i].name); ui.changed(); app.ui.toast(t('キュー {0} にいまの状態を入れました', i + 1)); }
        else if (act === 'up' && i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; ui._del = -1; ui.changed(); }
        else if (act === 'down' && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; ui._del = -1; ui.changed(); }
        else if (act === 'del') { ui._del = ui._del === i ? -1 : i; ui.render(true); }
        else if (act === 'del-yes') { list.splice(i, 1); ui._del = -1; ui.changed(); }
        else if (act === 'del-no') { ui._del = -1; ui.render(true); }
        else if (act === 'go') ui.recall(i);
      });
      ed.addEventListener('change', (e) => {
        const x = e.target.closest('[data-cf]');
        if (!x) return;
        const list = ui.list(), i = +x.dataset.i;
        if (!list[i]) return;
        const f = x.dataset.cf;
        const c = Object.assign({}, list[i], { [f]: f === 'palette' ? +x.value : x.value });
        list[i] = VJ.cues.clean(c) || list[i];
        ui.changed();
      });
      ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[data-cf]')) e.target.blur(); });
      ui.render(true);
    },

    list() {
      const s = ui.app.settings;
      if (!Array.isArray(s.cues)) s.cues = [];
      return s.cues;
    },

    changed() {
      ui.render(true);
      VJ.panel.applyShow(true);
    },

    /** いまの状態をキューに入れる（最後に足す） */
    add() {
      const list = ui.list();
      if (list.length >= VJ.cues.MAX) { ui.app.ui.toast(t('キューは {0} 個までです', VJ.cues.MAX), 'warn'); return null; }
      const c = VJ.cues.capture(ui.app.settings, ui.app.show.state, t('キュー {0}', list.length + 1));
      list.push(c);
      $('cue-edit-box').open = true;
      ui.changed();
      return c;
    },

    /** キューを出す（i は 0 から）。2 画面の出力ウィンドウでは操作ウィンドウへ渡す */
    recall(i) {
      const app = ui.app || VJ.panel.app, s = app.settings;
      const c = Array.isArray(s.cues) ? s.cues[i] : null;
      if (VJ.link.role === 'output' && VJ.link.peer && !VJ.link.peer.closed) { VJ.link.send({ t: 'cue', i }); return !!c; }
      if (!c) { app.ui.toast(t('キュー {0} はありません（⑥ の「キューを作る・直す」）', i + 1), 'warn'); return false; }
      if (VJ.cues.applySettings(s, c)) { VJ.panel.syncOverlay(); VJ.panel.applyShow(true); }
      // 一覧のメディアを選ぶキューは、曲の m:… より優先（次の曲で曲の指定に戻る）
      if (c.media && c.media !== 'on' && c.media !== 'off') app.show.overrideSongMedia();
      // 「メディア：出す」は、曲の指定が「出さない」（m:off）でも出す
      if (c.media === 'on') app.show.setOverlay(true);
      if (c.scene) app.show.selectScene(c.scene, { immediate: true, quiet: true });
      if (c.palette >= 0) app.show.setPalette(c.palette);
      app.ui.toast(t('キュー {0}：{1}', i + 1, c.name || VJ.cues.describe(s, c)));
      const b = document.querySelector(`#cue-grid button[data-cue="${i}"]`);
      if (b) { b.classList.add('fired'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('fired'), 600); }
      return true;
    },

    /** ボタンと編集欄を描く（編集欄は入力中は描き直さない） */
    render(force) {
      if (!ui.app) return;
      const s = ui.app.settings, list = ui.list();
      const gsig = JSON.stringify([list, s.mediaLib, VJ.i18n.lang]);
      if (force || gsig !== ui._gridSig) {
        ui._gridSig = gsig;
        VJ.dom.set($('cue-grid'), list.length ? list.map((c, i) => html`<button data-cue="${i}" title="${VJ.cues.describe(s, c)}"><span class="ck">${i < 9 ? 'Alt+' + (i + 1) : ''}</span>`
          + html`<span class="cn" data-i18n-skip>${c.name || t('キュー {0}', i + 1)}</span><span class="cd">${VJ.cues.describe(s, c)}</span></button>`).map(raw)
          : html`<div class="hint">${t('まだありません。下の「キューを作る・直す」で、いまの状態を入れます')}</div>`);
      }
      const ed = $('cue-edit'), ae = document.activeElement;
      if (!force && ae && ed.contains(ae) && ae.matches('input, select')) return;
      const sig = JSON.stringify([gsig, ui._del]);
      if (!force && sig === ui._sig) return;
      ui._sig = sig;
      const scenes = VJ.scenes.list.filter((d) => d.id !== 'test');
      const sel = (on) => (on ? raw(' selected') : '');
      const sceneOpts = (v, none) => html`<option value="">${none}</option>${scenes.map((d) => html`<option value="${d.id}"${sel(d.id === v)}>${(d.key ? d.key + ' ' : '') + VJ.sceneName(d)}</option>`)}`;
      const ovOpts = (v) => html`<option value="">${t('重ね：そのまま')}</option><option value="off"${sel(v === 'off')}>${t('重ね：やめる')}</option>`
        + html`${scenes.filter((d) => !d.hidden && d.id !== 'title').map((d) => html`<option value="${d.id}"${sel(d.id === v)}>${t('重ね：{0}', VJ.sceneName(d))}</option>`)}`;
      const palOpts = (v) => html`<option value="-1">${t('色：そのまま')}</option>${VJ.palettes.map((p, k) => html`<option value="${k}"${sel(k === v)}>${t(p.name)}</option>`)}`;
      const lib = VJ.mediaLib.list(s);
      const mediaOpts = (v) => html`<option value="">${t('メディア：そのまま')}</option><option value="on"${sel(v === 'on')}>${t('メディア：出す')}</option><option value="off"${sel(v === 'off')}>${t('メディア：消す')}</option>`
        + html`${lib.map((m, k) => html`<option value="${m.id}"${sel(m.id === v)}>m${k + 1} ${m.name || VJ.panel.mediaKindName(m.kind)}</option>`)}`
        + (v && v !== 'on' && v !== 'off' && !VJ.mediaLib.byId(s, v) ? html`<option value="${v}" selected>${t('（消えたメディア）')}</option>` : '');
      VJ.dom.set(ed, list.map((c, i) => html`<div class="cue-ed">`
        + html`<div class="row"><span class="ml-no">${i + 1}</span><input type="text" data-cf="name" data-i="${i}" value="${c.name}" maxlength="40" spellcheck="false" data-i18n-skip aria-label="${t('キューの名前')}">`
        + html`<button data-act="go" data-i="${i}" title="${t('出す')}">▶</button>`
        + html`<button data-act="up" data-i="${i}" title="${t('上へ')}"${i === 0 ? raw(' disabled') : ''}>▲</button>`
        + html`<button data-act="down" data-i="${i}" title="${t('下へ')}"${i === list.length - 1 ? raw(' disabled') : ''}>▼</button>`
        + html`<button data-act="del" data-i="${i}" title="${t('消す')}">✕</button></div>`
        + html`<div class="row"><select data-cf="scene" data-i="${i}">${sceneOpts(c.scene, t('シーン：そのまま'))}</select><select data-cf="palette" data-i="${i}">${palOpts(c.palette)}</select></div>`
        + html`<div class="row"><select data-cf="media" data-i="${i}">${raw(mediaOpts(c.media))}</select><select data-cf="ovScene" data-i="${i}">${raw(ovOpts(c.ovScene))}</select></div>`
        + html`<div class="row"><button data-act="capture" data-i="${i}">${t('いまの状態を入れる')}</button></div>`
        + (ui._del === i ? html`<div class="row sl-confirm"><span>${t('このキューを消しますか？')}</span><button data-act="del-yes" data-i="${i}">${t('消す')}</button><button data-act="del-no" data-i="${i}">${t('やめる')}</button></div>` : '')
        + '</div>').map(raw));
      $('btn-cue-add').disabled = list.length >= VJ.cues.MAX;
    },
  };

  VJ.cuesUI = ui;
})(globalThis.VJ = globalThis.VJ || {});
