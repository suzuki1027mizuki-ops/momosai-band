/* はじめてのガイド（パネルの上に 5 つの手順。終わったものは自動で ✓）と、本番前チェック（⑥。緑/黄/赤の一覧）。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);
  const ICON = { ok: '✅', info: '💡', warn: '⚠️', bad: '❌' };

  // [手順, 説明, 移動先の見出し（パネルの h2 の番号）]
  const STEPS = [
    ['音声入力を始める', '① で入力（マイク / ライン・PC の音など）を選んで「▶ 音声入力を開始」', 1],
    ['音が来ているか確かめる', 'メーターが動けば OK。リハでは「サウンドチェック」で自動調整', 1],
    ['スクリーンに合わせる', '④ でテストパターン（G）を出して位置・大きさ・向きを合わせる。2 画面なら出力ウィンドウを開く', 4],
    ['出演バンドとセットリスト', '③ にバンド名・曲・開演時刻。出演者が複数なら「＋ バンドを追加」', 3],
    ['本番前チェック → ショー開始', '⑥ の「本番前チェック」で確認してから「ショー開始」', 6],
  ];

  const guide = {
    app: null,
    done: [false, false, false, false, false],
    _activeT: 0,
    _testSeen: false,
    _precheckSeen: false,

    install(app) {
      guide.app = app;
      $('btn-guide').addEventListener('click', () => { app.settings.guide = !app.settings.guide; guide.render(); VJ.panel.save(); });
      $('guide').addEventListener('click', (e) => {
        if (e.target.closest('#guide-close')) { app.settings.guide = false; guide.render(); VJ.panel.save(); return; }
        const li = e.target.closest('li[data-sec]');
        if (li) guide.scrollTo(+li.dataset.sec);
      });
      $('btn-precheck').addEventListener('click', () => {
        const box = $('precheck');
        box.hidden = !box.hidden;
        guide._precheckSeen = true;
        $('btn-precheck').textContent = box.hidden ? t('本番前チェック') : t('本番前チェックを閉じる');
        guide.renderPrecheck();
      });
      guide.render();
    },

    /** パネルの n 番の見出しまでスクロールして、少し光らせる（閉じていたら開く） */
    scrollTo(n) {
      const h = Array.from(document.querySelectorAll('#panel h2')).find((x) => x.textContent.trim().startsWith('①②③④⑤⑥⑦'[n - 1]));
      if (!h) return;
      if (VJ.sections) VJ.sections.open(n);
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      h.classList.remove('flash-h');
      void h.offsetWidth;
      h.classList.add('flash-h');
    },

    /** 手順が終わったか（パネルの更新ごと。一度終わったものは戻さない） */
    check(f) {
      const app = guide.app, s = app.settings, st = app.show.state || {};
      const d = guide.done;
      if (app.engine.running) d[0] = true;
      if (f && f.active) guide._activeT += 0.05; // 20Hz で呼ばれる
      if (guide._activeT > 2 || (VJ.soundcheckUI && VJ.soundcheckUI.last)) d[1] = true;
      if (st.sceneId === 'test') guide._testSeen = true;
      if (guide._testSeen || VJ.link.role === 'control') d[2] = true;
      const D = VJ.defaultSettings;
      if ((s.setlistText !== D.setlistText && s.setlistText !== VJ.defaultSetlistEn) || s.bandName !== D.bandName || (Array.isArray(s.bands) && s.bands.length > 1)) d[3] = true;
      if (guide._precheckSeen || VJ.guard.showing) d[4] = true;
    },

    render() {
      const app = guide.app, el = $('guide');
      if (!el) return;
      el.hidden = !app.settings.guide;
      $('btn-guide').classList.toggle('on', !!app.settings.guide);
      if (el.hidden) return;
      const next = guide.done.indexOf(false);
      el.innerHTML = `<div class="g-head"><b>${esc(t('はじめてのガイド'))}</b><span class="hint">${esc(t('{0} / {1} 完了', guide.done.filter(Boolean).length, STEPS.length))}</span>`
        + `<button id="guide-close" title="${esc(t('ガイドを閉じる（右上の ? でまた開く）'))}">×</button></div><ol>`
        + STEPS.map(([title, desc, sec], i) => `<li data-sec="${sec}" class="${guide.done[i] ? 'done' : i === next ? 'next' : ''}">`
          + `<span class="g-mark">${guide.done[i] ? '✓' : i + 1}</span><span><b>${esc(t(title))}</b><br><span class="hint">${esc(t(desc))}</span></span></li>`).join('')
        + '</ol>';
      guide._sig = guide.done.join();
    },

    /** パネルの更新（20Hz）から */
    tick(f) {
      const app = guide.app;
      if (!app) return;
      guide.check(f);
      if (app.settings.guide && guide.done.join() !== guide._sig) guide.render();
      if (!$('precheck').hidden && performance.now() - (guide._pcT || 0) > 500) { guide._pcT = performance.now(); guide.renderPrecheck(); }
    },

    /** 本番前チェックの項目 [{ level, text }] */
    items() {
      const app = guide.app, s = app.settings, e = app.engine, st = app.show.state || {};
      const out = [];
      const add = (level, text) => out.push({ level, text });
      const remote = VJ.link.role === 'control';
      const ls = VJ.link.lastStatus || {};
      // 音
      if (!e.running) add('bad', t('音声入力が始まっていません（① の「▶ 音声入力を開始」）'));
      else {
        add('ok', t('音声入力：{0}', (e.diagnostics().device || '') || t('入力中')));
        const f = remote ? VJ.link._features : app.lastFeatures;
        const m = e.updateMeters ? e.meter : null;
        if (f && f.active) add('ok', t('音が来ています'));
        else add('warn', t('いま音が来ていません（メーターが動くか確認。演奏が始まれば大丈夫です）'));
        if (m && Math.max(m.lPeak, m.mono ? -120 : m.rPeak) > -0.5) add('warn', t('音が割れているかもしれません（入力の音量を下げる）'));
      }
      const scl = VJ.soundcheckUI && VJ.soundcheckUI.last;
      if (!scl) add('info', t('リハで「サウンドチェック」をしておくと安心です（①）'));
      else add(scl.worst === 'bad' ? 'warn' : 'ok', scl.worst === 'bad' ? t('サウンドチェックで問題がありました（① の結果を確認）') : t('サウンドチェック済み'));
      // 映像
      const r = remote ? { fps: ls.fps, software: false } : app.renderer.info();
      if (r.software) add('warn', t('GPU が使われていません（ソフトウェア描画）。映像が重くなります'));
      if (r.fps && r.fps < 40) add('warn', t('描画が重いです（{0} fps）。⑤ の「画質上限」を下げるか、フレームレートを 30 に', Math.round(r.fps)));
      else if (r.fps) add('ok', t('描画 {0} fps', Math.round(r.fps)));
      if (remote) {
        if (ls.fullscreen) add('ok', t('出力ウィンドウは全画面です'));
        else add('warn', t('出力ウィンドウが全画面ではありません（プロジェクター側でダブルクリック）'));
      } else add('info', t('「ショー開始」で全画面になります（2 画面にするなら ④ の「出力ウィンドウを開く」）'));
      if (st.blackout) add('warn', t('暗転中です（B で解除）'));
      if (st.sceneId === 'test') add('warn', t('テストパターンを表示中です（G で戻す）'));
      // 出演・曲
      const p = app.show.setlist || { songs: [], errors: [] };
      const bs = VJ.bandsUI ? VJ.bandsUI.state(s) : null;
      const who = (bs && bs.name) || (app.show.bandName ? app.show.bandName() : '') || '—';
      if (p.songs.length) add('ok', t('出演：{0}（{1} 曲）', who, p.songs.length) + (bs && bs.n > 1 ? ' ' + t('— {0} 組中 {1} 組目', bs.n, bs.i + 1) : ''));
      else add('info', t('出演：{0}（曲が登録されていません。→ キーの曲送りは使えません）', who));
      if (p.errors.length) add('warn', t('セットリストに読めない行があります（{0} 件。③ を確認）', p.errors.length));
      // 光
      if (s.noFlash) add('info', t('フラッシュを一切使わない設定です'));
      else if (VJ.safety.overSafe(s.flashLimit)) {
        add('warn', (+s.flashLimit ? t('フラッシュの上限が 1 秒に {0} 回です', s.flashLimit) : t('フラッシュの上限が「制限なし」です'))
          + t('（推奨は 3 回まで。光過敏性発作のおそれ）。会場に「強い光の点滅があります」と必ず掲示してください（⑤）'));
      } else add('ok', t('フラッシュは 1 秒に {0} 回まで（光過敏対策）。会場に「光の点滅があります」と掲示してください', s.flashLimit));
      // メディアのオーバーレイ（動画の中の点滅は制限できない）。設定のメディア・曲ごとのメディア（m:…）・キューで使うものを調べる
      const ov = s.overlay || {};
      const baseItem = ov.mediaKind === 'lib' ? VJ.mediaLib.byId(s, ov.libId) : null;
      const baseKind = ov.mediaKind === 'lib' ? (baseItem ? baseItem.kind : '') : ov.mediaKind;
      const used = new Set();
      if (s.overlayOn && baseKind) used.add(baseKind);
      const lost = [];
      for (const sg of p.songs) {
        if (!sg.media) continue;
        const it = VJ.mediaLib.find(s, sg.media);
        if (!it) lost.push(sg.media);
        else if (!it.off) used.add(it.kind);
      }
      for (const c of Array.isArray(s.cues) ? s.cues : []) {
        const it = c.media && c.media !== 'on' && c.media !== 'off' ? VJ.mediaLib.byId(s, c.media) : null;
        if (it) used.add(it.kind);
        else if (c.media && c.media !== 'on' && c.media !== 'off') lost.push(c.name || '?');
      }
      const ms = remote ? ls.media || {} : VJ.media.state();
      const moving = ['video', 'capture', 'web'].filter((k) => used.has(k));
      if (moving.length) {
        const names = moving.map((k) => ({ video: t('動画ファイル'), capture: t('画面・タブの取り込み'), web: 'YouTube / ' + t('ニコニコ') }[k])).join(t('・'));
        add('warn', t('メディアに{0}を使っています。動画の中の点滅はフラッシュの上限で制限できないので、事前に確認してください', names));
      }
      if (s.overlayOn && baseKind === 'capture' && !ms.capture) add('warn', t('画面の取り込みが止まっています（⑤ のメディア）'));
      if (s.overlayOn && ms.kind === 'video' && (ms.status === 'missing' || ms.status === 'error')) add('bad', t('メディアの動画を読めません（⑤ で選び直す）'));
      if (s.overlayOn && ms.kind === 'image' && ms.status === 'missing') add('bad', t('メディアの画像を読めません（⑤ のメディアの一覧に入れ直す）'));
      if (s.overlayOn && ms.kind === 'camera') {
        if (ms.camera) add('ok', t('カメラ：{0}', ms.cameraLabel || t('使用中')));
        else if (ms.status === 'camerror') add('bad', t('カメラを開けません：{0}', ms.error || ''));
        else add('warn', t('カメラが開いていません（⑤ のメディアで「カメラを開く」）'));
      } else if (used.has('camera')) add('info', t('曲・キューでカメラを使います。リハで一度出して、許可・映り方を確かめてください'));
      if (used.has('web')) add('info', t('YouTube / ニコニコはインターネットが必要です。会場の回線で再生できるか確かめてください'));
      if (lost.length) add('warn', t('メディアの一覧にないメディアを指定しています：{0}（③ のセットリスト・⑥ のキュー）', [...new Set(lost)].join(t('・'))));
      // スリープ
      if (VJ.compat.features().wakeLock) add('ok', t('「ショー開始」で画面のスリープを止めます'));
      else add('warn', t('この環境では画面のスリープを止められません。PC の設定でスリープ・画面オフを「なし」に'));
      // 外部連携
      const io = remote ? ls.io || {} : { net: VJ.net.state(), dmx: VJ.dmx.state() };
      if (s.net && s.net.enabled) {
        const n = io.net || {};
        if (n.status === 'on' && n.info) add('ok', t('ブリッジに接続中（スマホ {0} 台）', n.info.phones));
        else add('bad', t('ブリッジにつながっていません（⑦）'));
      }
      if (s.dmx && s.dmx.enabled) {
        const d = io.dmx || {};
        if (d.status === 'on') add('ok', t('照明（DMX）を送信中'));
        else add('warn', t('照明（DMX）を送れていません（⑦）'));
      }
      return out;
    },

    renderPrecheck() {
      const items = guide.items();
      const bad = items.filter((i) => i.level === 'bad').length, warn = items.filter((i) => i.level === 'warn').length;
      const head = bad ? t('要対応 {0} 件', bad) + (warn ? ' / ' + t('注意 {0} 件', warn) : '') : warn ? t('注意 {0} 件', warn) : t('準備 OK');
      $('precheck').innerHTML = `<div class="sc-step ${bad ? 'bad' : warn ? 'warn' : 'ok'}">${esc(head)}</div>`
        + `<ul class="sc-items">${items.map((i) => `<li class="${i.level}"><span>${ICON[i.level]}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>`;
    },
  };

  VJ.guide = guide;
})(globalThis.VJ = globalThis.VJ || {});
