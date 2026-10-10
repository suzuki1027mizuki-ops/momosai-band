/* セットリストを表で編集（パネル ③）。曲名・シーン（見本画像から選ぶ）・パレット・曲名表示を 1 曲ずつ。
 * 並べ替え・追加・削除。編集すると上の文字の欄（セットリストの書式）を書き直す。文字の欄を直接書いてもよい。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);

  const ed = {
    app: null,
    model: null, // { band, end, songs: [{ title, scenes, palette, notitle, line, dirty }] }
    _src: null, // 表を作ったときのセットリストの文字と出演バンドの番号（別のバンドに書き込まないように）
    _picking: -1, // シーンを選んでいる曲の番号
    _del: -1, // 「消す？」と確かめている曲の番号（確認ダイアログは 2 画面の映像まで止めるので使わない）

    install(app) {
      ed.app = app;
      const el = $('setlist-preview');
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        if (ed.stale()) { ed.render(true); return; }
        const i = +b.dataset.i, act = b.dataset.act, songs = ed.model.songs;
        // 並べ替え・削除では、シーンを選んでいる曲・「消す？」の曲の番号も一緒に動かす（別の曲を変えない・消さないように）
        const follow = (map) => { ed._picking = ed._picking < 0 ? -1 : map(ed._picking); ed._del = ed._del < 0 ? -1 : map(ed._del); };
        if (act === 'up' && i > 0) { [songs[i - 1], songs[i]] = [songs[i], songs[i - 1]]; follow((x) => (x === i ? i - 1 : x === i - 1 ? i : x)); }
        else if (act === 'down' && i < songs.length - 1) { [songs[i + 1], songs[i]] = [songs[i], songs[i + 1]]; follow((x) => (x === i ? i + 1 : x === i + 1 ? i : x)); }
        else if (act === 'del') { ed._del = ed._del === i ? -1 : i; ed.render(true); return; }
        else if (act === 'del-yes') { songs.splice(i, 1); follow((x) => (x === i ? -1 : x > i ? x - 1 : x)); ed._del = -1; }
        else if (act === 'del-no') { ed._del = -1; ed.render(true); return; }
        else if (act === 'add') { songs.push({ title: t('新しい曲 {0}', songs.length + 1), scenes: [], palette: null, notitle: false, line: null, dirty: true }); ed._focusLast = true; }
        else if (act === 'pick') { ed._picking = ed._picking === i ? -1 : i; ed.render(true); return; }
        else if (act === 'unpick') { const k = +b.dataset.k; songs[i].scenes.splice(k, 1); songs[i].dirty = true; }
        else if (act === 'done') { ed._picking = -1; ed.render(true); return; }
        else return;
        ed.commit(true);
      });
      el.addEventListener('click', (e) => {
        // シーンの選択欄：押すと追加（同じシーンを続けては入れない）
        const sb = e.target.closest('.sl-picker button[data-scene]');
        if (!sb || ed._picking < 0) return;
        if (ed.stale()) { ed.render(true); return; }
        const song = ed.model.songs[ed._picking];
        if (song.scenes[song.scenes.length - 1] !== sb.dataset.scene) { song.scenes.push(sb.dataset.scene); song.dirty = true; }
        ed.commit(true);
      });
      el.addEventListener('input', (e) => {
        const inp = e.target.closest('input[data-f="title"]');
        if (!inp) return;
        if (ed.stale()) { ed.render(true); return; }
        const song = ed.model.songs[+inp.dataset.i];
        song.title = inp.value;
        song.dirty = true;
        ed.commit(false);
      });
      el.addEventListener('change', (e) => {
        const x = e.target;
        if (!x.matches('select[data-f="palette"], input[data-f="showtitle"]')) return;
        if (ed.stale()) { ed.render(true); return; }
        const song = ed.model.songs[+x.dataset.i];
        if (x.matches('select')) song.palette = x.value === '' ? null : +x.value;
        else song.notitle = !x.checked;
        song.dirty = true;
        ed.commit(false);
      });
    },

    /** 表を作ったあとで、セットリストの文字か出演バンドが変わった（スマホ・OSC・出力ウィンドウからの切替など） */
    stale() {
      const s = ed.app.settings;
      return !ed._src || ed._src.text !== s.setlistText || ed._src.band !== s.bandIdx;
    },

    /** 表の内容 → 文字の欄・設定。元の文字は行ごとに残し、曲の行だけを書き直す。rerender で表も描き直す */
    commit(rerender) {
      const s = ed.app.settings;
      if (ed.stale()) { ed.render(true); return; }
      const text = VJ.setlist.rewrite(s.setlistText, ed.model.songs);
      s.setlistText = text;
      $('setlist').value = text;
      if (rerender) ed.render(true);
      else {
        // 書き直した文字に合わせて元の行番号を付け直す（表は描き直さない：入力中の文字が消えないように）
        const p = VJ.setlist.parse(text);
        ed.model.songs.forEach((x, k) => { if (p.songs[k]) x.line = p.songs[k].line; });
        ed._src = { text, band: s.bandIdx };
      }
      VJ.panel.applyShow();
    },

    /** 解析結果から表を作る。入力中（表の中にフォーカスがある）は作り直さない（文字が消えないように） */
    render(force) {
      const app = ed.app, el = $('setlist-preview');
      if (!app || !el) return;
      // 入力中は作り直さない。ただし別のバンドに切り替わったら作り直す（古い表で別のバンドを書き換えないように）
      const s = app.settings;
      const bandChanged = !!ed._src && ed._src.band !== s.bandIdx;
      if (!force && !bandChanged && el.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (bandChanged) { ed._picking = -1; ed._del = -1; }
      const p = VJ.setlist.parse(s.setlistText);
      ed._src = { text: s.setlistText, band: s.bandIdx };
      ed.model = { band: p.band, end: p.end, songs: p.songs.map((x) => ({ title: x.title, scenes: x.scenes.slice(), palette: x.palette, notitle: x.notitle, line: x.line, dirty: false })) };
      if (ed._picking >= ed.model.songs.length) ed._picking = -1;
      if (ed._del >= ed.model.songs.length) ed._del = -1;
      const pals = `<option value="">${esc(t('パレット：そのまま'))}</option>` + VJ.palettes.map((q, i) => `<option value="${i}">${esc(t(q.name))}</option>`).join('');
      const chip = (id, i, k) => {
        const d = VJ.scenes.byId[id];
        if (!d) return '';
        const img = VJ.scenePick.thumb(id);
        return `<span class="sl-chip">${img ? `<img src="${img}" alt="">` : ''}<span>${esc(VJ.scenePick.keyLabel(d))} ${esc(VJ.sceneName(d))}</span>`
          + `<button data-act="unpick" data-i="${i}" data-k="${k}" title="${esc(t('外す'))}">×</button></span>`;
      };
      let html = '';
      // バンド名・曲名は入力された文字なので訳さない（data-i18n-skip）
      if (p.band) html += `<div class="hint">${esc(t('バンド名：'))}<b data-i18n-skip>${esc(p.band)}</b>${esc(t('（@band が優先）'))}</div>`;
      html += '<div class="sl-list">';
      ed.model.songs.forEach((x, i) => {
        html += `<div class="sl-song${ed._picking === i ? ' picking' : ''}"><div class="sl-row1"><span class="sl-no">M${i + 1}</span>`
          + `<input type="text" data-f="title" data-i="${i}" value="${esc(x.title)}" data-i18n-skip spellcheck="false" aria-label="${esc(t('曲名'))}">`
          + `<button data-act="up" data-i="${i}" title="${esc(t('上へ'))}"${i === 0 ? ' disabled' : ''}>▲</button>`
          + `<button data-act="down" data-i="${i}" title="${esc(t('下へ'))}"${i === ed.model.songs.length - 1 ? ' disabled' : ''}>▼</button>`
          + `<button data-act="del" data-i="${i}" title="${esc(t('消す'))}">✕</button></div>`
          + `<div class="sl-row2">${x.scenes.length ? x.scenes.map((id, k) => chip(id, i, k)).join('<span class="sl-arrow">→</span>') : `<span class="hint">${esc(t('シーン：オート'))}</span>`}`
          + `<button data-act="pick" data-i="${i}">${esc(ed._picking === i ? t('選び終える') : t('＋ シーン'))}</button></div>`
          + `<div class="sl-row3"><select data-f="palette" data-i="${i}">${pals}</select>`
          + `<label><input type="checkbox" data-f="showtitle" data-i="${i}"${x.notitle ? '' : ' checked'}> ${esc(t('曲名を表示'))}</label></div>`
          + (ed._del === i ? `<div class="row sl-confirm"><span>${esc(t('この曲を消しますか？'))}</span><button data-act="del-yes" data-i="${i}">${esc(t('消す'))}</button><button data-act="del-no" data-i="${i}">${esc(t('やめる'))}</button></div>` : '');
        if (ed._picking === i) {
          html += `<div class="sl-picker"><div class="hint">${esc(t('押した順に使います（2 つ以上ならオートで順番に）'))}</div>`
            + `<div class="scene-grid">${VJ.scenePick.list().map((d) => VJ.scenePick.button(d)).join('')}</div>`
            + `<button data-act="done" data-i="${i}">${esc(t('選び終える'))}</button></div>`;
        }
        html += '</div>';
      });
      html += `</div><div class="row"><button data-act="add" data-i="-1">${esc(t('＋ 曲を追加'))}</button>`
        + (ed.model.songs.length ? '' : `<span class="hint">${esc(t('曲が登録されていません（→ キーの曲送りは使えません）'))}</span>`) + '</div>';
      if (p.end) html += `<div class="hint">${esc(t('終演の文字：'))}<b data-i18n-skip>${esc(p.end)}</b></div>`;
      for (const e of p.errors) html += `<div class="err">${esc(t('{0} 行目：{1}', e.line, e.msg))}</div>`;
      el.innerHTML = html;
      el.querySelectorAll('select[data-f="palette"]').forEach((sel) => { const x = ed.model.songs[+sel.dataset.i]; sel.value = x.palette === null ? '' : String(x.palette); });
      if (ed._focusLast) {
        ed._focusLast = false;
        const inputs = el.querySelectorAll('input[data-f="title"]');
        const last = inputs[inputs.length - 1];
        if (last) { last.focus(); last.select(); }
      }
    },
  };

  VJ.setlistEd = ed;
})(globalThis.VJ = globalThis.VJ || {});
