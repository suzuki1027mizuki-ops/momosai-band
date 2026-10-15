/* 設定パネル：③ ロゴと ⑤ メディアのオーバーレイ（画像・動画・画面の取り込み・カメラ・貼り付け）。
 * panel.js の続き（VJ.panel にメソッドを足す。中身は panel.js から移しただけ）。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);
  const panel = VJ.panel;

  Object.assign(panel, {
    renderLogo() {
      const s = panel.app.settings, img = $('logo-preview');
      img.hidden = !s.logo;
      if (s.logo) img.src = s.logo; else img.removeAttribute('src');
    },

    /** ロゴ画像を読み込み、長辺 1024px 以下に縮めて data URL にする（設定に保存できる大きさに。
     *  出演バンドごとにロゴを持つので、大きいときは WebP にして 1 枚 400KB 程度までにする） */
    async loadLogo(e) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const out = await panel._readImage(f, 1024, 4e5);
        panel.app.settings.logo = out;
        if (panel.app.settings.logoMode === 'off') { panel.app.settings.logoMode = 'title'; $('opt-logomode').value = 'title'; }
        panel.renderLogo();
        panel.applyShow(true);
      } catch (err) {
        panel.app.ui.toast(t('ロゴ画像を読み込めませんでした：') + err.message, 'warn');
      }
    },

    /** 画像ファイルを読み、長辺 maxSide px 以下に縮めて data URL にする。maxLen 文字を超えるときは WebP にして小さくする
     *  （透明度は残る） */
    async _readImage(f, maxSide, maxLen) {
      const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(t('画像を読み込めません'))); i.src = url; });
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/png');
      for (const q of [0.92, 0.8, 0.65]) {
        if (out.length <= maxLen) break;
        const w = c.toDataURL('image/webp', q);
        if (w.startsWith('data:image/webp') && w.length < out.length) out = w;
      }
      return out;
    },

    /** オーバーレイの欄（メディア・シーン・文字）。設定の中身は読み込みなどで入れ替わるので、毎回 settings から読む */
    initOverlay() {
      const s = panel.app.settings;
      const apply = () => panel.applyShow(true);
      const pct = (x) => Math.round(x * 100) + '%';
      // メディア
      $('ov-on').addEventListener('change', () => { s.overlayOn = $('ov-on').checked; apply(); });
      document.querySelectorAll('input[name=ov-kind]').forEach((r) => r.addEventListener('change', () => {
        s.overlay.mediaKind = r.value;
        s.overlayOn = true;
        panel.syncOverlay();
        apply();
      }));
      $('ov-file').addEventListener('change', (e) => { if (e.target.files[0]) panel.setOverlayImageFile(e.target.files[0]); });
      $('btn-ov-paste').addEventListener('click', () => panel.pasteImage());
      $('btn-ov-clear').addEventListener('click', () => { s.overlay.image = ''; $('ov-file').value = ''; panel.syncOverlay(); apply(); });
      $('ov-vfile').addEventListener('change', (e) => { if (e.target.files[0]) panel.setOverlayVideoFile(e.target.files[0]); });
      $('btn-ov-vclear').addEventListener('click', () => {
        const old = s.overlay.videoKey;
        s.overlay.videoKey = ''; s.overlay.videoName = ''; $('ov-vfile').value = '';
        panel.releaseMediaKey(old);
        panel.syncOverlay(); apply();
      });
      $('ov-vloop').addEventListener('change', () => { s.overlay.videoLoop = $('ov-vloop').checked; apply(); });
      $('ov-vsound').addEventListener('change', () => { s.overlay.videoSound = $('ov-vsound').checked; apply(); });
      $('btn-ov-capture').addEventListener('click', () => panel.startCapture());
      $('btn-ov-capstop').addEventListener('click', () => { panel.app.mediaCall('stopCapture').catch(() => {}); });
      $('ov-play').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-mcmd]');
        if (b) panel.app.mediaCall('webCmd', b.dataset.mcmd).catch(() => {});
      });
      // カメラ
      $('ov-cam').addEventListener('change', () => {
        const opt = $('ov-cam').selectedOptions[0];
        s.overlay.cameraId = $('ov-cam').value;
        s.overlay.cameraLabel = opt && opt.value ? opt.textContent.slice(0, 200) : '';
        apply();
      });
      $('btn-ov-camrefresh').addEventListener('click', () => panel.refreshCameras());
      $('btn-ov-camopen').addEventListener('click', () => panel.openCamera());
      $('btn-ov-camstop').addEventListener('click', () => { panel.app.mediaCall('stopCamera').catch(() => {}); setTimeout(() => panel.renderMediaStatus(true), 300); });
      $('ov-cammirror').addEventListener('change', () => { s.overlay.cameraMirror = $('ov-cammirror').checked; apply(); });
      // 一覧から
      $('ov-lib').addEventListener('change', () => { s.overlay.libId = $('ov-lib').value; s.overlay.mediaKind = 'lib'; s.overlayOn = true; panel.syncOverlay(); apply(); });
      for (const [id, key] of [['ov-fit', 'imageFit'], ['ov-imgblend', 'imageBlend'], ['ov-scene', 'scene'], ['ov-sceneblend', 'sceneBlend'], ['ov-corner', 'corner']]) {
        $(id).addEventListener('change', () => { s.overlay[key] = $(id).value; apply(); });
      }
      // シーン・文字
      $('ovs-on').addEventListener('change', () => { s.ovSceneOn = $('ovs-on').checked; apply(); });
      $('ovt-on').addEventListener('change', () => { s.overlay.textOn = $('ovt-on').checked; apply(); });
      for (const [id, key] of [['ov-clock', 'clock'], ['ov-band', 'band'], ['ov-song', 'song']]) {
        $(id).addEventListener('change', () => { s.overlay[key] = $(id).checked; apply(); });
      }
      $('ov-text').addEventListener('input', () => { s.overlay.text = $('ov-text').value; panel.applyShow(); });
      for (const [id, key] of [['ov-imgop', 'imageOpacity'], ['ov-sceneop', 'sceneOpacity'], ['ov-textop', 'textOpacity'], ['ov-textsize', 'textSize']]) {
        $(id).addEventListener('input', () => { s.overlay[key] = +$(id).value; $(id + '-v').textContent = pct(+$(id).value); apply(); });
      }
      // 貼り付け（Ctrl+V）と、ファイルを落としたとき（落とした先のページへ移ってショーが止まらないように、どこに落としても受ける）
      document.addEventListener('paste', (e) => panel.onPaste(e));
      const box = $('overlay-box');
      document.addEventListener('dragover', (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        if (e.target.closest && e.target.closest('input[type=file]')) return;
        e.preventDefault();
        box.classList.toggle('drop', !!(e.target.closest && e.target.closest('#overlay-box')));
        $('medialib-box').classList.toggle('drop', !!(e.target.closest && e.target.closest('#medialib-box')));
      });
      document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { box.classList.remove('drop'); $('medialib-box').classList.remove('drop'); } });
      document.addEventListener('drop', (e) => {
        box.classList.remove('drop');
        $('medialib-box').classList.remove('drop');
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        if (e.target.closest && e.target.closest('input[type=file]')) return; // ファイルの欄はそのまま
        e.preventDefault();
        // メディアの一覧の欄に落としたときは、まとめて一覧に入れる
        if (e.target.closest && e.target.closest('#medialib-box')) { VJ.mediaLibUI.addFiles(Array.from(e.dataTransfer.files)); return; }
        const f = Array.from(e.dataTransfer.files).find((x) => /^(image|video)\//.test(x.type) || /\.(mp4|webm|mov|m4v)$/i.test(x.name));
        if (!f) { panel.app.ui.toast(t('画像か動画のファイルを落としてください（音声ファイルは ① の「音声ファイル」で）'), 'warn'); return; }
        if (/^image\//.test(f.type)) panel.setOverlayImageFile(f); else panel.setOverlayVideoFile(f);
      });
      // 透過ウィンドウ（ほかの画面の上に重ねる）は単体アプリだけ
      const inApp = VJ.params.app === '1';
      $('glass-row').hidden = !inApp;
      $('glass-hint').hidden = inApp;
      $('btn-glass').addEventListener('click', () => VJ.link.openOutput(panel.app, { glass: true }));
      panel.syncOverlay();
    },

    /** オーバーレイの欄を設定に合わせる（シーンの選択肢は表示の言語で作り直す） */
    syncOverlay() {
      const s = panel.app.settings, o = s.overlay;
      const pct = (x) => Math.round(x * 100) + '%';
      $('ov-on').checked = !!s.overlayOn;
      $('ovs-on').checked = !!s.ovSceneOn;
      $('ovt-on').checked = !!o.textOn;
      const kind = o.mediaKind || 'image';
      const lib = VJ.mediaLib.list(s), libItem = kind === 'lib' ? VJ.mediaLib.byId(s, o.libId) : null;
      $('ov-kind-lib').hidden = !lib.length && kind !== 'lib';
      document.querySelectorAll('input[name=ov-kind]').forEach((r) => { r.checked = r.value === kind; });
      document.querySelectorAll('#overlay-box .ov-pane').forEach((p) => { p.hidden = p.dataset.kind !== kind; });
      const shown = libItem ? libItem.kind : kind;
      $('ov-play').hidden = shown !== 'video';
      $('ov-vwarn').hidden = shown === 'image' || shown === 'camera';
      // 一覧から選ぶ欄
      const ls = $('ov-lib');
      ls.innerHTML = (libItem ? '' : `<option value="">${esc(kind === 'lib' && o.libId ? t('（消えたメディア）') : t('選んでください'))}</option>`)
        + lib.map((x, i) => `<option value="${esc(x.id)}">m${i + 1} ${esc(x.name || panel.mediaKindName(x.kind))}</option>`).join('');
      ls.value = libItem ? libItem.id : '';
      // カメラ
      $('ov-cammirror').checked = !!o.cameraMirror;
      const cs = $('ov-cam');
      if (o.cameraId && !Array.from(cs.options).some((x) => x.value === o.cameraId)) {
        cs.add(new Option(o.cameraLabel || t('前に選んだカメラ'), o.cameraId));
      }
      if (cs.value !== o.cameraId) cs.value = o.cameraId || '';
      const sel = $('ov-scene');
      sel.innerHTML = `<option value="">${esc(t('重ねない'))}</option>` + VJ.scenes.list.filter((d) => !d.hidden && d.id !== 'title')
        .map((d) => `<option value="${d.id}">${esc(d.key.replace('s', 'Shift+'))} ${esc(VJ.sceneName(d))}</option>`).join('');
      sel.value = o.scene;
      if (sel.selectedIndex < 0) sel.value = '';
      for (const [id, key] of [['ov-fit', 'imageFit'], ['ov-imgblend', 'imageBlend'], ['ov-sceneblend', 'sceneBlend'], ['ov-corner', 'corner']]) $(id).value = o[key];
      for (const [id, key] of [['ov-clock', 'clock'], ['ov-band', 'band'], ['ov-song', 'song'], ['ov-vloop', 'videoLoop'], ['ov-vsound', 'videoSound']]) $(id).checked = !!o[key];
      if ($('ov-text').value !== o.text) $('ov-text').value = o.text;
      $('ov-vname').textContent = o.videoName ? t('動画：{0}', o.videoName) : t('動画が選ばれていません');
      for (const [id, key] of [['ov-imgop', 'imageOpacity'], ['ov-sceneop', 'sceneOpacity'], ['ov-textop', 'textOpacity'], ['ov-textsize', 'textSize']]) {
        $(id).value = o[key];
        $(id + '-v').textContent = pct(o[key]);
      }
      const img = $('ov-preview');
      img.hidden = !o.image;
      if (o.image) img.src = o.image; else img.removeAttribute('src');
      if (VJ.mediaLibUI) VJ.mediaLibUI.render();
      panel.renderMediaStatus(true);
    },

    /** メディアの状態（再生中・取り込み中・読めない など）を表示（パネルの更新から、1 秒に 4 回まで） */
    renderMediaStatus(force) {
      const now = performance.now();
      if (!force && now - (panel._mstT || 0) < 250) return;
      panel._mstT = now;
      const s = panel.app.settings;
      const st = VJ.link.role === 'control' ? (VJ.link.lastStatus && VJ.link.lastStatus.media) || {} : VJ.media.state();
      // 実際に出ているもの（曲の m:… ・一覧から選んだもの）の種類で書く
      const kind = st.kind !== undefined ? st.kind : s.overlay.mediaKind || 'image';
      let txt = '';
      if (!s.overlayOn) txt = t('メディアは OFF（O キーで表示）');
      else if (kind === 'video') txt = ({ loading: t('読み込み中…'), playing: t('再生中'), paused: t('一時停止中'), ended: t('終わりました（⏮ で最初から）'), missing: t('動画が見つかりません。もう一度選んでください'), error: t('この動画は再生できません（MP4・WebM がおすすめ）'), empty: t('動画が選ばれていません') })[st.status] || '';
      else if (kind === 'capture') txt = st.capture ? t('取り込み中：{0}', st.label || '') : t('取り込んでいません（「取り込む画面・タブを選ぶ」）');
      else if (kind === 'camera') {
        txt = st.camera ? t('カメラ：{0}', st.cameraLabel || t('使用中')) + (st.error ? ' — ' + st.error : '')
          : ({ loading: t('カメラを開いています…（許可を聞かれたら「許可」）'), camerror: t('カメラを開けません：{0}', st.error || ''), lost: t('カメラが外れました。つなぎ直すと戻ります') })[st.status] || t('カメラは止まっています（「カメラを開く」）');
      } else if (kind === 'image') txt = st.status === 'missing' ? t('画像が見つかりません。一覧に入れ直してください') : '';
      else if (s.overlay.mediaKind === 'lib' || st.song) txt = st.song ? t('この曲はメディアを出しません（m:off）') : t('一覧から出すメディアを選んでください');
      // 曲の指定（m:…）・一覧から出しているときは、その名前も
      if (s.overlayOn && st.name) txt = (st.song ? t('曲の指定：{0}', st.name) : t('一覧：{0}', st.name)) + (txt ? ' — ' + txt : '');
      if ($('ov-status').textContent !== txt) $('ov-status').textContent = txt;
      $('ov-play').hidden = kind !== 'video';
      if ($('ov-play').hidden && txt && s.overlayOn) {
        // 再生ボタンが無いときも状態の文字は見せる（ボタンの行ごと隠れないように、文字だけの行にする）
        $('ov-play').hidden = false;
        for (const b of $('ov-play').querySelectorAll('button')) b.hidden = true;
      } else for (const b of $('ov-play').querySelectorAll('button')) b.hidden = false;
      const cap = document.querySelector('#overlay-box .ov-pane[data-kind=capture] .hint');
      if (cap && kind === 'capture') cap.dataset.on = st.capture ? '1' : '';
    },

    /** 画像ファイル（貼り付け・落とした・選んだ）をメディアの画像にする（長辺 1920px 以下・900KB 程度まで） */
    async setOverlayImageFile(f) {
      try {
        const s = panel.app.settings;
        s.overlay.image = await panel._readImage(f, 1920, 9e5);
        s.overlay.mediaKind = 'image';
        s.overlayOn = true;
        panel.syncOverlay();
        panel.applyShow(true);
        panel.app.ui.toast(t('メディアに画像を入れました（O で表示・非表示）'));
      } catch (err) {
        panel.app.ui.toast(t('画像を読み込めませんでした：') + err.message, 'warn');
      }
    },

    /** 動画ファイルをメディアにする（この PC の保存場所に入れ、2 画面のときは出力ウィンドウへ渡す） */
    async setOverlayVideoFile(f) {
      const s = panel.app.settings;
      const key = VJ.mediaStore.newKey();
      const saved = await VJ.mediaStore.put(key, f);
      VJ.link.send({ t: 'media', key, blob: f });
      const old = s.overlay.videoKey;
      s.overlay.videoKey = key;
      s.overlay.videoName = String(f.name || t('動画')).slice(0, 200);
      s.overlay.mediaKind = 'video';
      s.overlayOn = true;
      panel.releaseMediaKey(old);
      panel.syncOverlay();
      panel.applyShow(true);
      panel.app.ui.toast(saved ? t('メディアに動画を入れました（O で表示・非表示）') : t('動画を保存できませんでした。このウィンドウを閉じるまで使えます'), saved ? undefined : 'warn');
    },

    /** 「貼り付け」ボタン：クリップボードの画像を読む（許可を聞かれることがある） */
    async pasteImage() {
      const cb = navigator.clipboard;
      if (!cb || !cb.read) { panel.app.ui.toast(t('この環境ではボタンから貼り付けできません。Ctrl+V で貼り付けてください'), 'warn'); return; }
      try {
        for (const it of await cb.read()) {
          const type = it.types.find((x) => x.startsWith('image/'));
          if (type) { await panel.setOverlayImageFile(await it.getType(type)); return; }
        }
        panel.app.ui.toast(t('クリップボードに画像がありません（画像をコピーしてから）'), 'warn');
      } catch (e) {
        panel.app.ui.toast(t('クリップボードを読めませんでした。Ctrl+V で貼り付けてください'), 'warn');
      }
    },

    /** Ctrl+V：画像・動画のファイルを、メディアにする（文字の欄に文字を貼るときはそのまま） */
    onPaste(e) {
      if (VJ.link.role === 'output') return;
      const cd = e.clipboardData;
      if (!cd) return;
      const tg = e.target;
      const editable = !!tg && (tg.isContentEditable || /^(input|textarea|select)$/i.test(tg.tagName || ''));
      const files = Array.from(cd.files || []);
      const img = files.find((f) => /^image\//.test(f.type)), vid = files.find((f) => /^video\//.test(f.type));
      const text = cd.getData('text/plain') || '';
      if (editable && (text || !(img || vid))) return;
      if (img) { e.preventDefault(); panel.setOverlayImageFile(img); return; }
      if (vid) { e.preventDefault(); panel.setOverlayVideoFile(vid); }
    },

    /** 画面・タブの取り込みを始める（2 画面のときは出力ウィンドウに選ぶ画面が出る） */
    async startCapture() {
      const s = panel.app.settings;
      s.overlay.mediaKind = 'capture';
      s.overlayOn = true;
      panel.syncOverlay();
      panel.applyShow(true);
      if (VJ.link.role === 'control') panel.app.ui.toast(t('出力ウィンドウに、取り込む画面を選ぶ画面が出ています'));
      try {
        await panel.app.mediaCall('startCapture');
      } catch (e) {
        const cancel = e && (e.name === 'NotAllowedError' || e.name === 'AbortError');
        panel.app.ui.toast(cancel ? t('画面の取り込みがキャンセルされました') : t('画面を取り込めませんでした：') + ((e && e.message) || e), 'warn');
      }
      panel.renderMediaStatus(true);
    },

    /** メディアの種類の名前 */
    mediaKindName(kind) {
      return ({ image: t('画像'), video: t('動画'), camera: t('カメラ'), capture: t('画面の取り込み') })[kind] || '';
    },

    /** カメラの一覧を作り直す（描画しているウィンドウで調べる：許可はそちらで出しているので名前が分かる） */
    async refreshCameras() {
      const cs = $('ov-cam'), o = panel.app.settings.overlay;
      let list = [];
      try { list = (await panel.app.mediaCall('listCameras')) || []; } catch (e) { /* noop */ }
      cs.innerHTML = `<option value="">${esc(t('（既定のカメラ）'))}</option>`
        + list.filter((d) => d.id).map((d, i) => `<option value="${esc(d.id)}">${esc(d.label || t('カメラ {0}', i + 1))}</option>`).join('');
      if (o.cameraId && !list.some((d) => d.id === o.cameraId)) cs.add(new Option(t('{0}（見つかりません）', o.cameraLabel || t('前に選んだカメラ')), o.cameraId));
      cs.value = o.cameraId || '';
      if (list.length && !list.some((d) => d.label)) panel.app.ui.toast(t('カメラの名前は、一度「カメラを開く」で許可すると出ます'));
      return list;
    },

    /** カメラを開いてメディアにする（2 画面のときは出力ウィンドウで開く。許可もそちらで聞かれる） */
    async openCamera() {
      const s = panel.app.settings;
      s.overlay.mediaKind = 'camera';
      s.overlayOn = true;
      panel.syncOverlay();
      panel.applyShow(true);
      if (VJ.link.role === 'control') panel.app.ui.toast(t('カメラの使用の許可は、出力ウィンドウで聞かれます'));
      panel.app.show.overrideSongMedia(); // 曲の m:… より、いま開いたカメラを出す（次の曲まで）
      try {
        const r = await panel.app.mediaCall('startCamera', s.overlay.cameraId || '');
        if (r && r.fallback) panel.app.ui.toast(t('選んだカメラが見つからないので、ほかのカメラを使っています'), 'warn');
        // 許可したあとはカメラの名前が分かるので、一覧を作り直す
        const n = $('ov-cam').options.length;
        const list = await panel.refreshCameras();
        if (r && r.label && !s.overlay.cameraId && list.length > 1 && n <= 1) panel.app.ui.toast(t('カメラが {0} 台あります。使うカメラを選べます', list.length));
      } catch (e) {
        const denied = e && e.name === 'NotAllowedError';
        panel.app.ui.toast(denied ? t('カメラの使用が許可されていません（アドレスバー左のアイコンから許可）') : t('カメラを開けません：{0}', (e && e.message) || e), 'warn');
      }
      panel.renderMediaStatus(true);
    },

    /** 使わなくなった中身（動画を入れ替えた・一覧から消した）を保存場所から消す。いまの動画・一覧のどれかが使っていれば残す */
    releaseMediaKey(key) {
      const s = panel.app.settings;
      if (!key || s.overlay.videoKey === key || VJ.mediaLib.keys(s).includes(key)) return Promise.resolve();
      return VJ.mediaStore.remove(key);
    },
  });
})(globalThis.VJ = globalThis.VJ || {});
