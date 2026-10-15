/* 設定パネル（開始画面兼用）。映像は背後で動き続けるので、設定しながら見え方を確認できる。
 * 操作はすべて app 経由（app.show / app.engine / app.applySettings）。出力ウィンドウ（2 画面）のときは
 * app.show・app.engine がリモコン（link.js）に差し替わるので、このファイルは同じまま動く。
 * 節ごとのメソッドは panel-input.js（①②）・panel-overlay.js（ロゴ・メディア）・panel-io.js（⑦・MIDI）・
 * panel-settings.js（書き出し・読み込み・設定を映し直す）にある（どれも VJ.panel にメソッドを足す）。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const OUT_DEFAULT = { rotate: 0, flipH: false, flipV: false, size: 1, x: 0, y: 0 };
  const t = (...a) => VJ.t(...a);

  const panel = {
    app: null,
    visible: true,
    _saveT: null,
    _prevT: null,
    _meterT: 0,
    files: [],

    init(app) {
      panel.app = app;
      const s = app.settings;
      s.output = Object.assign({}, OUT_DEFAULT, s.output || {});
      // マウスで押したボタン・チェックボックス・ラジオボタン・折りたたみは、押した直後にフォーカスを外す
      // （残ると Space が「フラッシュ」ではなく「その部品を押す」になるため。キーボードで押したときは外さない）
      $('panel').addEventListener('click', (e) => {
        if (!e.detail) return; // キーボード（Space / Enter）での操作
        const lab = e.target.closest('label');
        const ctl = e.target.closest('button, summary, input[type=checkbox], input[type=radio]')
          || (lab && lab.querySelector('input[type=checkbox], input[type=radio]'));
        if (ctl) setTimeout(() => { if (document.activeElement === ctl) ctl.blur(); }, 0);
      });
      $('panel').addEventListener('change', (e) => {
        if (e.target.matches('select, input[type=file], input[type=color]') && panel._pointer) e.target.blur();
      });
      $('panel').addEventListener('pointerdown', () => { panel._pointer = true; });
      $('panel').addEventListener('keydown', () => { panel._pointer = false; });
      $('ver').textContent = VJ.version.startsWith('__') ? t('開発版（index.html）') : `v${VJ.version} ${VJ.buildTime}`;

      $('opt-lang').value = ['auto', 'ja', 'en'].includes(s.lang) ? s.lang : 'auto';
      $('opt-lang').addEventListener('change', () => { s.lang = $('opt-lang').value; panel.setLang(s.lang); panel.applyShow(true); });

      // ① 入力
      document.querySelectorAll('input[name=src]').forEach((r) => r.addEventListener('change', panel._srcChanged));
      // このブラウザで使えない入力は選べないようにする（Firefox・Safari は画面共有で音を取れない）
      const feat = VJ.compat.features();
      if (!feat.displayAudio) {
        const r = document.querySelector('input[name=src][value=display]');
        r.disabled = true;
        r.parentElement.title = t('このブラウザでは使えません（Chrome / Edge / 単体アプリで使えます）');
        r.parentElement.style.opacity = '0.5';
      }
      $('btn-refresh').addEventListener('click', () => panel.refreshDevices());
      $('btn-start').addEventListener('click', () => panel.startAudio());
      $('device').addEventListener('change', () => {
        const d = $('device');
        s.deviceId = d.value;
        s.deviceLabel = d.value && d.selectedOptions[0] ? d.selectedOptions[0].textContent : '';
        panel.save();
        if (app.engine.running && app.engine.opts.source === 'mic') panel.startAudio();
      });
      $('file').addEventListener('change', () => { panel.files = Array.from($('file').files || []); });
      $('btn-skip').addEventListener('click', () => app.engine.skipFile(1));
      $('demo-kind').value = ['band', 'sing', 'speech'].includes(s.demoKind) ? s.demoKind : 'band';
      $('demo-kind').addEventListener('change', () => {
        s.demoKind = $('demo-kind').value;
        panel.save();
        if (app.engine.running && app.engine.opts.source === 'demo') panel.startAudio();
      });
      $('channel').value = s.channel;
      $('channel').addEventListener('change', () => { s.channel = $('channel').value; app.engine.setChannel(s.channel); panel.save(); });
      $('monitor').checked = s.monitor;
      $('monitor').addEventListener('change', () => { s.monitor = $('monitor').checked; app.engine.setMonitor(s.monitor); panel.save(); });
      panel.bindEngine();

      // ② 音楽のタイプ・テンポ
      const prof = $('opt-profile');
      prof.innerHTML = VJ.profiles.map((p) => `<option value="${p.id}">${esc(VJ.profileName(p))}</option>`).join('');
      prof.value = VJ.profileById(s.profile).id;
      prof.addEventListener('change', () => { s.profile = prof.value; panel.renderProfile(); panel.applyShow(true); });
      panel.renderProfile();
      $('btn-tap').addEventListener('click', () => app.show.tap());

      // ③ バンド名・セットリスト・文字
      $('band').value = s.bandName;
      $('setlist').value = s.setlistText;
      $('band').addEventListener('input', () => { s.bandName = $('band').value; panel.applyShow(); });
      $('setlist').addEventListener('input', () => { s.setlistText = $('setlist').value; panel.applyShow(); });
      $('logo-file').addEventListener('change', panel.loadLogo);
      $('btn-logo-clear').addEventListener('click', () => { s.logo = ''; $('logo-file').value = ''; panel.renderLogo(); panel.applyShow(true); });
      $('opt-logomode').value = s.logoMode;
      $('opt-logomode').addEventListener('change', () => { s.logoMode = $('opt-logomode').value; panel.applyShow(true); });
      $('opt-logocorner').value = s.logoCorner;
      $('opt-logocorner').addEventListener('change', () => { s.logoCorner = $('opt-logocorner').value; panel.applyShow(true); });
      panel.renderLogo();
      panel.initOverlay();
      for (let i = 0; i < 3; i++) {
        $('msg-' + i).value = s.messages[i] || '';
        $('msg-' + i).addEventListener('input', () => { s.messages[i] = $('msg-' + i).value; panel.applyShow(); });
      }
      document.querySelectorAll('button[data-msg]').forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.msg;
        s.messages[i] = $('msg-' + i).value;
        panel.applyShow(true);
        app.show.toggleMessage(i);
      }));
      $('opt-countdown').value = s.countdownTo || '';
      $('opt-countdown').addEventListener('input', () => { s.countdownTo = $('opt-countdown').value; panel.applyShow(); });

      // ④ 表示（バンドの切替・設定の読み込みで s.output は作り直されるので、毎回 settings から読む）
      const out = () => panel.app.settings.output;
      $('out-rotate').value = String(out().rotate);
      $('out-rotate').addEventListener('change', () => { out().rotate = +$('out-rotate').value; panel.applyShow(true); });
      $('out-fliph').checked = !!out().flipH;
      $('out-fliph').addEventListener('change', () => { out().flipH = $('out-fliph').checked; panel.applyShow(true); });
      $('out-flipv').checked = !!out().flipV;
      $('out-flipv').addEventListener('change', () => { out().flipV = $('out-flipv').checked; panel.applyShow(true); });
      const bindOut = (id, key, fmt) => {
        const el = $(id), v = $(id + '-v');
        el.value = out()[key];
        v.textContent = fmt(+el.value);
        el.addEventListener('input', () => { out()[key] = +el.value; v.textContent = fmt(+el.value); if (!panel._bulk) panel.applyShow(true); });
      };
      bindOut('out-size', 'size', (x) => Math.round(x * 100) + '%');
      bindOut('out-x', 'x', (x) => (x > 0 ? '+' : '') + Math.round(x * 100) + '%');
      bindOut('out-y', 'y', (x) => (x > 0 ? '+' : '') + Math.round(x * 100) + '%');
      $('btn-test').addEventListener('click', () => app.show.toggleTestPattern());
      $('btn-out-reset').addEventListener('click', () => {
        Object.assign(out(), OUT_DEFAULT);
        panel.syncOutputUi();
        panel.applyShow(true);
      });
      $('btn-output').addEventListener('click', () => VJ.link.openOutput(app));
      $('btn-output-close').addEventListener('click', () => VJ.link.closeOutput());
      $('btn-output-stop').addEventListener('click', () => VJ.link.closeOutput());
      $('remote-preview-on').addEventListener('change', () => VJ.link._previewOn());

      // ⑤ オプション
      const bindCheck = (id, key, after) => {
        $(id).checked = !!s[key];
        $(id).addEventListener('change', () => { s[key] = $(id).checked; if (after) after(); panel.applyShow(true); });
      };
      bindCheck('opt-auto', 'auto');
      bindCheck('opt-autoflash', 'autoFlash');
      bindCheck('opt-noflash', 'noFlash', () => panel.syncFlashLimit());
      $('opt-flashlimit').addEventListener('change', () => {
        s.flashLimit = +$('opt-flashlimit').value;
        panel.syncFlashLimit();
        if (VJ.safety.overSafe(s.flashLimit)) app.ui.toast(t('フラッシュの上限が推奨（1 秒に 3 回）を超えています'), 'warn');
        panel.applyShow(true);
      });
      $('opt-intensity').addEventListener('change', () => { s.intensity = +$('opt-intensity').value; panel.applyShow(true); });
      panel.syncFlashLimit();
      bindCheck('opt-speechtitle', 'speechTitle');
      bindCheck('opt-palauto', 'paletteAuto');
      // シーンの切り替え：種類（音楽のタイプに合わせる・カット・フェード・ワイプ…）と長さ。
      // 設定は crossfade（-1 = 音楽のタイプ / 0 = カット / 秒）と transition（種類）
      $('opt-trans').addEventListener('change', () => {
        const v = $('opt-trans').value;
        if (v === 'auto') s.crossfade = -1;
        else if (v === 'cut') s.crossfade = 0;
        else { s.transition = v; s.crossfade = +$('opt-xfade').value || 0.5; }
        panel.syncTransition();
        panel.applyShow(true);
      });
      $('opt-xfade').addEventListener('change', () => { if (s.crossfade > 0) s.crossfade = +$('opt-xfade').value; panel.applyShow(true); });
      panel.syncTransition();
      bindCheck('opt-toast', 'toast');
      bindCheck('opt-latsq', 'latencySquare');
      bindCheck('opt-autostart', 'autoStart');
      bindCheck('opt-desync', 'desynchronized', () => app.ui.toast(t('低遅延描画の切替は再読み込み後に有効になります')));
      const bindRange = (id, key, fmt) => {
        const el = $(id), v = $(id + '-v');
        el.value = s[key];
        v.textContent = fmt(+el.value);
        el.addEventListener('input', () => { s[key] = +el.value; v.textContent = fmt(+el.value); if (!panel._bulk) panel.applyShow(true); });
      };
      bindRange('opt-sens', 'sensitivity', (x) => (x > 0 ? '+' : '') + x);
      bindRange('opt-react', 'react', (x) => Math.round(x * 100) + '%');
      bindRange('opt-master', 'master', (x) => Math.round(x * 100) + '%');
      bindRange('opt-scale', 'maxScale', (x) => Math.round(x * 100) + '%');
      bindRange('opt-gate', 'gateDb', (x) => x + ' dBFS');
      $('opt-fps').value = String(s.fpsCap || 0);
      $('opt-fps').addEventListener('change', () => { s.fpsCap = +$('opt-fps').value; panel.applyShow(true); });
      const pal = $('opt-palette');
      pal.innerHTML = VJ.palettes.map((p, i) => `<option value="${i}">${i + 1}. ${esc(t(p.name))}</option>`).join('');
      pal.value = s.paletteIdx;
      // パネルで選んだ色は、出演中のバンドの色として覚える（曲ごとの色・C キーでの変更とは別）
      pal.addEventListener('change', () => { app.show.setPalette(+pal.value); s.paletteIdx = +pal.value; s.bandPalette = +pal.value; VJ.bands.touch(); panel.renderCustom(); panel.applyShow(true); });
      panel.renderCustom();
      panel.renderAutoScenes();

      // シーンごとの調整
      $('sp-scene').innerHTML = VJ.scenes.list.filter((d) => !d.hidden && d.params.length)
        .map((d) => `<option value="${d.id}">${esc(d.key.replace('s', 'Shift+'))} ${esc(VJ.sceneName(d))}</option>`).join('');
      $('sp-scene').addEventListener('change', () => { $('sp-follow').checked = false; panel.renderSceneParams(); });
      $('sp-follow').addEventListener('change', () => panel.renderSceneParams());
      $('sp-reset').addEventListener('click', () => {
        delete s.sceneParams[$('sp-scene').value];
        panel.renderSceneParams(true);
        panel.applyShow(true);
      });
      panel.renderSceneParams(true);

      // MIDI の割り当て
      $('btn-midi-default').addEventListener('click', () => { s.midiMap = {}; VJ.midi.cancelLearn(); panel.renderMidiMap(); panel.save(); });
      $('midi-map-box').addEventListener('toggle', () => { if ($('midi-map-box').open) { panel.renderMidiMap(); panel.enableMidi(); } else VJ.midi.cancelLearn(); });

      $('btn-export').addEventListener('click', panel.exportSettings);
      $('btn-import').addEventListener('click', () => $('import-file').click());
      $('import-file').addEventListener('change', panel.importSettings);
      $('btn-reset').addEventListener('click', () => {
        if (!confirm(t('設定（出演バンド・セットリスト・ロゴを含むすべて）を初期状態に戻しますか？'))) return;
        panel.replaceSettings(VJ.storage.reset());
      });
      $('btn-midi').addEventListener('click', () => panel.enableMidi());

      // ⑦ 外部連携
      panel.bindIo();

      // ⑥ 本番・再開
      $('btn-show').addEventListener('click', () => panel.startShow());
      $('panel-close').addEventListener('click', () => panel.toggle(false));
      $('btn-resume').addEventListener('click', () => { app.show.restoreSession(panel._resume); $('resume-box').hidden = true; });
      $('btn-resume-no').addEventListener('click', () => { $('resume-box').hidden = true; });

      // キー一覧・シーンを絵で選ぶ・出演バンド
      panel.renderKeys();
      VJ.scenePick.install(app);
      VJ.bandsUI.install(app);
      VJ.soundcheckUI.install(app);
      VJ.sections.install(app);
      VJ.guide.install(app);
      VJ.setlistEd.install(app);
      VJ.mediaLibUI.install(app);
      VJ.cuesUI.install(app);

      // 前回の音声入力の種類を選んでおく
      const last = s.lastSource;
      const lastR = last && document.querySelector(`input[name=src][value=${last}]`);
      if (lastR && !lastR.disabled) lastR.checked = true;
      panel._srcChanged();
      panel.renderSetlist();
      panel.renderWarnings();
      panel.refreshDevices();
    },

    /** app.engine（差し替わることがある）の状態通知を受け取る */
    bindEngine() {
      panel.app.engine.on((st, msg) => panel.renderStatus(st, msg));
    },

    /** メーター・テンポ表示（20Hz） */
    tick(f, perfNow) {
      if (!panel.visible || perfNow - panel._meterT < 50) return;
      panel._meterT = perfNow;
      const m = panel.app.engine.updateMeters();
      const pct = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      $('ml').style.width = pct(m.l) + '%';
      $('mlp').style.left = pct(m.lPeak) + '%';
      $('mlv').textContent = m.l > -119 ? m.l.toFixed(1) + 'dB' : '—';
      $('mr').style.width = (m.mono ? 0 : pct(m.r)) + '%';
      $('mrp').style.left = (m.mono ? 0 : pct(m.rPeak)) + '%';
      $('mrv').textContent = m.mono ? 'mono' : m.r > -119 ? m.r.toFixed(1) + 'dB' : '—';
      const L = VJ.hud.lamps;
      $('lk').classList.toggle('on', perfNow - L.k < 120);
      $('ls').classList.toggle('on', perfNow - L.s < 120);
      $('lh').classList.toggle('on', perfNow - L.h < 120);
      $('la').classList.toggle('on', perfNow - L.a < 200);
      $('lb').classList.toggle('on', perfNow - L.b < 120);
      panel.renderStrip(f, m);
      // 激しさが自動のとき、いまの段階を表示
      const sh = panel.app.show, lvName = ['控えめ', 'ふつう', '激しい', '最大'][sh.state.intLv];
      const nowTxt = +panel.app.settings.intensity < 0 && lvName ? t('いま：{0}', t(lvName)) : '';
      if ($('intensity-now').textContent !== nowTxt) $('intensity-now').textContent = nowTxt;
      VJ.scenePick.update();
      VJ.guide.tick(f);
      if ($('overlay-box').open) panel.renderMediaStatus();
      if (perfNow - (panel._syncT || 0) > 500) { panel._syncT = perfNow; panel.syncFromSettings(); }
      if (f) {
        $('bpm-view').textContent = f.bpm && f.beatConf > 0.2 ? `${Math.round(f.bpm)} BPM${f.tempoManual ? t('（タップ）') : ''}` : '— BPM';
        const vm = VJ.makeDspConfig(panel.app.settings).voice.mode;
        $('mode-view').textContent = !f.active ? '' : t(f.speech ? '話し声に反応中' : vm === 'sing' ? '歌に反応中' : f.melodic ? 'ドラムの無い曲として反応中' : 'ドラムに反応中');
        $('voice-view').textContent = f.voiced > 0.5 && f.note ? VJ.dsp.noteName(f.note) : '—';
        $('speech-view').textContent = f.speech ? t('話し声（MC）を検出中：自動フラッシュ・テンポ切替を止めています') : '';
        if ($('sp-follow').checked && panel.app.show.state && panel.app.show.state.sceneId !== panel._spScene) panel.renderSceneParams();
        if (perfNow - (panel._ioT || 0) > 500) { panel._ioT = perfNow; panel.renderIo(); }
      }
    },

    /** パネルの上の「いまの状態」（入力と音量・テンポ・オート / 暗転 / ロック・シーン・曲）。どの項目を見ていても分かるように
     *  上に残す。変わったところだけ書く（20Hz） */
    renderStrip(f, m) {
      const app = panel.app, sh = app.show, st = sh.state || {}, es = app.engine.status;
      const set = (id, txt) => { const el = $(id); if (el.textContent !== txt) el.textContent = txt; };
      const cls = (id, name, on) => { const el = $(id); if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on); };
      const dot = es === 'running' ? 'ok' : es === 'error' ? 'bad' : es === 'idle' ? '' : 'warn';
      for (const k of ['ok', 'warn', 'bad']) cls('ps-dot', k, k === dot);
      set('ps-in', es === 'running' ? t('入力中') : es === 'error' ? t('エラー') : es === 'idle' ? t('未開始') : es === 'starting' ? t('開始中…') : t('再接続中…'));
      const db = es === 'running' && m ? Math.max(m.l, m.mono ? -120 : m.r) : -120;
      $('ps-lv').style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + '%';
      set('ps-bpm', f && f.bpm && f.beatConf > 0.2 ? `${Math.round(f.bpm)} BPM` : '— BPM');
      cls('ps-auto', 'on', st.auto);
      for (const [id, on] of [['ps-black', st.blackout], ['ps-lock', st.locked]]) { cls(id, 'on', on); cls(id, 'alert', on); }
      const sc = VJ.scenes.byId[st.sceneId], pd = st.pending && VJ.scenes.byId[st.pending.id];
      const key = (d) => (d.key ? d.key.replace('s', '⇧') + ' ' : '');
      set('ps-scene', (sc ? key(sc) + VJ.sceneName(sc) : '') + (pd ? ' → ' + VJ.sceneName(pd) : ''));
      const song = sh.currentSong ? sh.currentSong() : null;
      set('ps-song', song ? `M${st.songIdx + 1} ${song.title}` : st.endState ? t('（終演）') : t('（開演前）'));
    },

    applyShow(immediate) {
      clearTimeout(panel._prevT);
      const run = () => {
        panel.app.applySettings();
        panel.renderSetlist();
        VJ.bandsUI.render();
        panel.save();
      };
      if (immediate) run(); else panel._prevT = setTimeout(run, 200);
    },

    renderCustom() {
      const s = panel.app.settings, el = $('custom-colors');
      if (VJ.palettes[s.paletteIdx].id !== 'custom') { el.innerHTML = ''; return; }
      el.innerHTML = s.customPalette.map((c, i) => `<input type="color" data-i="${i}" value="${esc(c)}">`).join('');
      el.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
        s.customPalette[+inp.dataset.i] = inp.value;
        panel.applyShow(true);
      }));
    },

    renderAutoScenes() {
      const s = panel.app.settings;
      if (!s.autoScenes || typeof s.autoScenes !== 'object') s.autoScenes = {};
      const el = $('auto-scenes');
      el.innerHTML = VJ.scenes.list.filter((d) => !d.hidden && d.id !== 'title')
        .map((d) => `<label><input type="checkbox" data-scene="${d.id}" ${s.autoScenes[d.id] === false ? '' : 'checked'}> ${d.key} ${esc(VJ.sceneName(d))}</label>`).join('');
      el.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
        s.autoScenes[inp.dataset.scene] = inp.checked;
        panel.applyShow(true);
      }));
    },

    renderKeys() {
      const row = ([k, d]) => `<kbd>${esc(t(k))}</kbd><span>${esc(t(d))}</span>`;
      $('keys-full').innerHTML = VJ.keys.KEY_HELP.map(row).join('');
      $('keys-mini').innerHTML = VJ.keys.KEY_HELP.slice(0, 8).map(row).join('');
    },

    /** 表示の言語を切り替える（作り直す部品も描き直す） */
    setLang(setting) {
      const app = panel.app;
      VJ.i18n.setLang(VJ.i18n.resolve(setting));
      const prof = $('opt-profile');
      prof.innerHTML = VJ.profiles.map((p) => `<option value="${p.id}">${esc(VJ.profileName(p))}</option>`).join('');
      prof.value = VJ.profileById(app.settings.profile).id;
      const pal = $('opt-palette');
      pal.innerHTML = VJ.palettes.map((p, i) => `<option value="${i}">${i + 1}. ${esc(t(p.name))}</option>`).join('');
      pal.value = app.settings.paletteIdx;
      const sp = $('sp-scene'), spv = sp.value;
      sp.innerHTML = VJ.scenes.list.filter((d) => !d.hidden && d.params.length)
        .map((d) => `<option value="${d.id}">${esc(d.key.replace('s', 'Shift+'))} ${esc(VJ.sceneName(d))}</option>`).join('');
      sp.value = spv;
      panel.renderProfile();
      panel.renderSetlist();
      panel.renderAutoScenes();
      panel.renderSceneParams(true);
      panel.syncOverlay();
      if (VJ.cuesUI) VJ.cuesUI.render(true);
      if ($('midi-map-box').open) panel.renderMidiMap();
      panel.renderKeys();
      VJ.scenePick.render(app);
      VJ.bandsUI.render();
      VJ.guide.render();
      if (!$('precheck').hidden) VJ.guide.renderPrecheck();
      panel.renderWarnings();
      panel.renderIo();
      panel.renderStatus(app.engine.status, app.engine.message);
      $('ver').textContent = VJ.version.startsWith('__') ? t('開発版（index.html）') : `v${VJ.version} ${VJ.buildTime}`;
      if (app.engine.running) $('btn-start').textContent = t('↻ 入力を切り替え / 再開始');
      if (VJ.link.role === 'control') $('btn-output').textContent = t('出力ウィンドウを前面に');
      VJ.i18n.translateDom(document.body);
      panel.renderIo(); // 訳し直した説明文の中の受信ポート番号（#osc-in）を入れ直す
    },

    /** シーンごとの調整（スライダー）。force で値も作り直す */
    renderSceneParams(force) {
      const s = panel.app.settings, sel = $('sp-scene');
      if ($('sp-follow').checked && panel.app.show.state) {
        const cur = VJ.scenes.byId[panel.app.show.state.sceneId];
        if (cur && cur.params.length) sel.value = cur.id;
      }
      const id = sel.value;
      if (!force && id === panel._spScene && $('sp-params').childElementCount) return;
      panel._spScene = $('sp-follow').checked && panel.app.show.state ? panel.app.show.state.sceneId : id;
      const def = VJ.scenes.byId[id];
      if (!def) { $('sp-params').innerHTML = ''; return; }
      const vals = VJ.scenes.paramValues(def, s.sceneParams[id]);
      $('sp-params').innerHTML = def.params.map((p, i) => `<div class="sp-row"><span>${esc(t(p.name))}</span>`
        + `<input type="range" data-i="${i}" min="${p.min}" max="${p.max}" step="${p.step}" value="${vals[i]}"><span>${(+vals[i]).toFixed(2)}</span></div>`).join('');
      $('sp-params').querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
        const cur = Array.from(VJ.scenes.paramValues(def, s.sceneParams[id])).slice(0, def.params.length);
        cur[+inp.dataset.i] = +inp.value;
        s.sceneParams[id] = cur;
        inp.nextElementSibling.textContent = (+inp.value).toFixed(2);
        panel.applyShow();
      }));
    },

    _notes: [],

    renderWarnings() {
      panel._notes.push(...VJ.storage.takeNotes().filter((n) => !panel._notes.includes(n)));
      const app = panel.app, w = [];
      if (VJ.compat.browser !== 'chromium') {
        const miss = VJ.compat.missing();
        w.push(t('{0} でも動きますが、次の機能は使えません：{1}。本番は Chrome か Microsoft Edge（または単体アプリ）がおすすめです。', VJ.compat.name, miss.join(t('・')) || t('なし')));
      }
      const r = app.renderer.info();
      if (r.software) w.push(t('GPU が使われていません（ソフトウェア描画）。Chrome の 設定 → システム →「グラフィック アクセラレーションが使用可能な場合は使用する」を ON にして再起動してください。'));
      if (r.failed.length) w.push(t('一部のシーンを読み込めませんでした（自動的に飛ばします）：') + r.failed.join(', '));
      try {
        const p = location.protocol === 'file:' ? decodeURIComponent(location.pathname) : '';
        // OneDrive・Dropbox などの同期されるフォルダ：起動スクリプトの設定の保存場所（.vj-profile）もフォルダの中にあるので、
        // Chrome が使っている最中のファイルが同期され続ける（単体アプリの設定は別の場所なので関係ない）
        if (VJ.params.app !== '1' && VJ.compat.syncedPath(p)) {
          w.push(t('このフォルダは OneDrive などの同期されるフォルダの中にあります。設定の保存場所（.vj-profile）も同期の対象になり、使っている最中のファイルが同期され続けます。本番の PC では C:\\momosai-vj のような、同期されない英数字だけの場所に置くのがおすすめです。'));
        } else if (/[^\x00-\x7f]/.test(p)) {
          w.push(t('フォルダ名に日本語などが含まれています。念のため C:\\momosai-vj のような英数字だけの場所に置くのがおすすめです。'));
        }
      } catch (e) { /* noop */ }
      // 読み込んだ設定についての知らせ（このウィンドウを閉じるまで出す）
      for (const n of panel._notes) {
        if (n === 'web-removed') w.push(t('YouTube・ニコニコの埋め込みはなくなりました（埋め込みの規約に沿えないため）。使っていたメディアは画像に戻し、メディアの一覧からも外しました。曲の m:… に残っていれば、本番前チェックに出ます。'));
      }
      $('warnings').innerHTML = w.map((x) => `<div class="warnbox">⚠ ${esc(x)}</div>`).join('');
    },

    /** 前回の続き（起動時に main.js から） */
    offerResume(sess) {
      panel._resume = sess;
      const songs = panel.app.show.setlist.songs;
      const song = sess.songIdx >= 0 && songs[sess.songIdx];
      $('resume-text').textContent = song ? t('前回は M{0}「{1}」まで進んでいました。', sess.songIdx + 1, song.title) : sess.endState ? t('前回は終演まで進んでいました。') : t('前回の状態が残っています。');
      $('resume-box').hidden = false;
    },

    async startShow() {
      const app = panel.app;
      const warn = (e) => { app.ui.toast(t('ショー開始に失敗しました：') + ((e && e.message) || e), 'warn'); };
      // 全画面はクリック直後でないと許可されないので、ふつうは先に。
      // ただし「PC で再生中の音」は画面共有の開始にもクリック直後が必要なので、そちらを先にする
      const displayFirst = !app.engine.running && panel.source() === 'display';
      let shown = null;
      if (!displayFirst) shown = Promise.resolve().then(() => app.ui.startShow()).catch(warn);
      panel.toggle(false);
      if (!app.engine.running) {
        const ok = await panel.startAudio();
        if (!ok) { panel.toggle(true); app.ui.toast(t('音声入力を開始できませんでした（パネルの表示を確認）'), 'warn'); }
      }
      if (displayFirst) shown = Promise.resolve().then(() => app.ui.startShow()).catch(warn);
      await shown;
      if (VJ.link.role === 'solo' && !VJ.compat.fullscreenElement()) app.ui.toast(t('F キーで全画面にできます'), 'warn');
      else app.ui.toast(t('ショー開始 — H でキー一覧 / M で設定'));
    },

    toggle(force) {
      panel.visible = force === undefined ? !panel.visible : !!force;
      $('panel').hidden = !panel.visible;
      // 暗証番号入りの QR は、パネルを閉じたら隠す（開き直したときにスクリーンに映らないように）
      if (!panel.visible && !$('net-qr').hidden) { $('net-qr').hidden = true; $('btn-qr').textContent = t('スマホ用の QR コードを表示'); }
      if (!panel.visible && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    },

    save() {
      if (VJ.link && VJ.link.role === 'output') return; // 出力ウィンドウは保存しない（操作側が保存する）
      clearTimeout(panel._saveT);
      panel._saveT = setTimeout(() => {
        if (!VJ.storage.save(panel.app.settings)) panel.app.ui.toast(t('設定を保存できませんでした（ロゴ画像が大きすぎる可能性があります）'), 'warn');
      }, 300);
    },

  };

  VJ.panel = panel;
})(globalThis.VJ = globalThis.VJ || {});
