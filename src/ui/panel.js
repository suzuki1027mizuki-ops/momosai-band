/* 設定パネル（開始画面兼用）。映像は背後で動き続けるので、設定しながら見え方を確認できる。
 * 操作はすべて app 経由（app.show / app.engine / app.applySettings）。出力ウィンドウ（2 画面）のときは
 * app.show・app.engine がリモコン（link.js）に差し替わるので、このファイルは同じまま動く。 */
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

      // ④ 表示
      const out = s.output;
      $('out-rotate').value = String(out.rotate);
      $('out-rotate').addEventListener('change', () => { out.rotate = +$('out-rotate').value; panel.applyShow(true); });
      $('out-fliph').checked = !!out.flipH;
      $('out-fliph').addEventListener('change', () => { out.flipH = $('out-fliph').checked; panel.applyShow(true); });
      $('out-flipv').checked = !!out.flipV;
      $('out-flipv').addEventListener('change', () => { out.flipV = $('out-flipv').checked; panel.applyShow(true); });
      const bindOut = (id, key, fmt) => {
        const el = $(id), v = $(id + '-v');
        el.value = out[key];
        v.textContent = fmt(+el.value);
        el.addEventListener('input', () => { out[key] = +el.value; v.textContent = fmt(+el.value); if (!panel._bulk) panel.applyShow(true); });
      };
      bindOut('out-size', 'size', (x) => Math.round(x * 100) + '%');
      bindOut('out-x', 'x', (x) => (x > 0 ? '+' : '') + Math.round(x * 100) + '%');
      bindOut('out-y', 'y', (x) => (x > 0 ? '+' : '') + Math.round(x * 100) + '%');
      $('btn-test').addEventListener('click', () => app.show.toggleTestPattern());
      $('btn-out-reset').addEventListener('click', () => {
        Object.assign(out, OUT_DEFAULT);
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
      $('opt-xfade').value = String(s.crossfade);
      if ($('opt-xfade').selectedIndex < 0) $('opt-xfade').value = '-1';
      $('opt-xfade').addEventListener('change', () => { s.crossfade = +$('opt-xfade').value; panel.applyShow(true); });
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

    _srcChanged() {
      const src = panel.source();
      $('mic-opts').hidden = src !== 'mic';
      $('demo-opts').hidden = src !== 'demo';
      $('display-opts').hidden = src !== 'display';
      $('file-opts').hidden = src !== 'file';
      $('monitor-row').hidden = src === 'mic' || src === 'display';
    },

    source() {
      const r = document.querySelector('input[name=src]:checked');
      return r ? r.value : 'mic';
    },

    async refreshDevices() {
      const sel = $('device'), s = panel.app.settings;
      let devs = [];
      try { devs = await panel.app.engine.listDevices(); } catch (e) { devs = []; }
      const opts = [`<option value="">${esc(t('（既定のデバイス）'))}</option>`];
      devs.forEach((d, i) => {
        if (d.deviceId === 'default' || d.deviceId === '') return;
        opts.push(`<option value="${esc(d.deviceId)}">${esc(d.label || t('入力デバイス {0}（開始すると名前が出ます）', i + 1))}</option>`);
      });
      sel.innerHTML = opts.join('');
      // 保存されたデバイス（ID → 名前の順で探す）。「既定」は先頭の選択肢に対応
      let pick = devs.find((d) => d.deviceId === s.deviceId && d.deviceId !== 'default');
      if (!pick && s.deviceLabel) pick = devs.find((d) => d.label === s.deviceLabel && d.deviceId !== 'default');
      sel.value = pick ? pick.deviceId : '';
      if (sel.selectedIndex < 0) sel.value = '';
    },

    /** 入力の開始。opts を省略するとパネルの選択から作る */
    async startAudio(given) {
      const app = panel.app, s = app.settings;
      const src = given ? given.source : panel.source();
      const opts = Object.assign({ source: src, deviceId: $('device').value || s.deviceId, deviceLabel: s.deviceLabel, channel: s.channel, monitor: s.monitor, demo: s.demoKind }, given || {});
      if (src === 'file' && !opts.files) {
        if (!panel.files.length) { panel.renderStatus('error', t('音声ファイルを選んでください（複数選ぶと順番に再生）')); return false; }
        opts.files = [];
        for (const f of panel.files) opts.files.push({ name: f.name, data: await f.arrayBuffer() });
      }
      $('btn-start').disabled = true;
      try {
        await app.startAudio(opts);
        s.lastSource = src;
        if (src === 'mic') {
          s.deviceId = app.engine.opts.deviceId;
          s.deviceLabel = app.engine.opts.deviceLabel;
          await panel.refreshDevices();
        }
        panel.save();
        $('btn-start').textContent = t('↻ 入力を切り替え / 再開始');
        $('btn-skip').hidden = !(src === 'file' && opts.files && opts.files.length > 1);
        return true;
      } catch (e) {
        return false;
      } finally {
        $('btn-start').disabled = false;
      }
    },

    renderStatus(st, msg) {
      const el = $('audio-status'), e = panel.app.engine;
      // 入力中でも「PC の音が届いていません」のような注意が付いているときは注意の色で
      const note = st === 'running' && msg && e.opts.source === 'display';
      el.className = 'status ' + (note ? 'warn' : st === 'running' ? 'ok' : st === 'error' ? 'bad' : st === 'idle' ? '' : 'warn');
      if (st === 'running') {
        const d = e.diagnostics();
        el.textContent = t('入力中：{0}（{1}Hz / {2}ch）', d.device, d.sampleRate, d.channels) + (msg ? ' — ' + msg : '');
      } else if (st === 'starting') el.textContent = msg || t('開始中…（マイクや画面共有の許可を求められたら「許可」）');
      else if (st === 'error') el.textContent = msg || t('エラー');
      else if (st === 'lost' || st === 'reconnecting') el.textContent = msg || t('再接続中…');
      else el.textContent = t('まだ開始していません');
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
      // 激しさが自動のとき、いまの段階を表示
      const sh = panel.app.show, lvName = ['控えめ', 'ふつう', '激しい', '最大'][sh.state.intLv];
      const nowTxt = +panel.app.settings.intensity < 0 && lvName ? t('いま：{0}', t(lvName)) : '';
      if ($('intensity-now').textContent !== nowTxt) $('intensity-now').textContent = nowTxt;
      VJ.scenePick.update();
      VJ.guide.tick(f);
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

    renderProfile() {
      const p = VJ.profileById(panel.app.settings.profile);
      $('profile-desc').textContent = VJ.profileDesc(p);
    },

    /** セットリストの表（setlisted.js。入力中は作り直さない） */
    renderSetlist() { VJ.setlistEd.render(); },

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

    /** ⑦ 外部連携（ブリッジ・OSC・DMX） */
    bindIo() {
      const s = panel.app.settings;
      const sub = (k, def) => { if (!s[k] || typeof s[k] !== 'object') s[k] = Object.assign({}, def); return s[k]; };
      const D = VJ.defaultSettings;
      const changed = () => { panel.renderIo(); panel.applyShow(true); };
      const bindIn = (id, obj, key, conv, ev) => {
        const el = $(id);
        const o = () => sub(obj, D[obj]);
        if (el.type === 'checkbox') el.checked = !!o()[key]; else el.value = o()[key];
        el.addEventListener(ev || 'change', () => { o()[key] = el.type === 'checkbox' ? el.checked : conv ? conv(el.value) : el.value; changed(); });
      };
      bindIn('net-on', 'net', 'enabled');
      bindIn('net-url', 'net', 'url', (v) => v.trim());
      bindIn('osc-on', 'osc', 'enabled');
      bindIn('osc-host', 'osc', 'host', (v) => v.trim());
      bindIn('osc-port', 'osc', 'port', (v) => Math.max(1, Math.min(65535, Math.round(+v) || 9001)));
      bindIn('osc-rate', 'osc', 'rate', (v) => +v);
      bindIn('dmx-on', 'dmx', 'enabled');
      bindIn('dmx-out', 'dmx', 'out');
      bindIn('dmx-host', 'dmx', 'host', (v) => v.trim());
      bindIn('dmx-uni', 'dmx', 'universe', (v) => Math.max(0, Math.min(32767, Math.round(+v) || 0)));
      bindIn('dmx-type', 'dmx', 'type');
      bindIn('dmx-count', 'dmx', 'count', (v) => Math.max(1, Math.min(128, Math.round(+v) || 1)));
      bindIn('dmx-start', 'dmx', 'start', (v) => Math.max(1, Math.min(512, Math.round(+v) || 1)));
      bindIn('dmx-flash', 'dmx', 'flash');
      for (const k of ['max', 'pulse']) {
        const el = $('dmx-' + k), v = $('dmx-' + k + '-v');
        el.value = sub('dmx', D.dmx)[k];
        v.textContent = Math.round(el.value * 100) + '%';
        el.addEventListener('input', () => { s.dmx[k] = +el.value; v.textContent = Math.round(el.value * 100) + '%'; panel.applyShow(); });
      }
      $('btn-qr').addEventListener('click', async () => {
        const box = $('net-qr');
        if (!box.hidden) { box.hidden = true; $('btn-qr').textContent = t('スマホ用の QR コードを表示'); return; }
        let codes = [];
        try { codes = (await panel.app.netQr()) || []; } catch (e) { codes = []; }
        if (!codes.length) { panel.app.ui.toast(t('QR コードを作れません（ブリッジにつながっていないか、LAN に接続されていません）'), 'warn'); return; }
        box.innerHTML = codes.map((q) => `<figure><img src="${esc(q.img)}" alt="QR"><figcaption data-i18n-skip>${esc(q.url)}</figcaption></figure>`).join('')
          + `<div class="hint">${esc(t('スマホのカメラで読み取ると、暗証番号を入れずにつながります。QR には暗証番号が入っているので、観客から見えるところでは表示しないでください。'))}</div>`;
        box.hidden = false;
        $('btn-qr').textContent = t('QR コードを隠す');
      });
      $('dmx-port').addEventListener('click', async () => {
        try {
          const port = await VJ.dmx.chooseSerial();
          if (VJ.link.role === 'control') await VJ.link.request({ t: 'cmd', target: 'dmx', name: 'openGranted', args: [port.getInfo ? port.getInfo() : null] });
          else await VJ.dmx.openSerial(port);
          panel.renderIo();
        } catch (e) {
          if (e && e.name !== 'NotFoundError') panel.app.ui.toast('USB-DMX: ' + e.message, 'warn');
        }
      });
      panel.renderIo();
    },

    /** 外部連携の表示（ブリッジの暗証番号・スマホの URL・DMX の状態） */
    renderIo() {
      const s = panel.app.settings, d = s.dmx || {};
      $('dmx-art').hidden = d.out !== 'artnet';
      $('dmx-usb').hidden = d.out === 'artnet';
      const io = VJ.link.role === 'control' ? (VJ.link.lastStatus && VJ.link.lastStatus.io) || {} : { net: VJ.net.state(), dmx: VJ.dmx.state() };
      const n = io.net || { status: 'off' };
      const el = $('net-status');
      if (!(n.status === 'on' && n.info)) { $('btn-qr').hidden = true; $('net-qr').hidden = true; $('btn-qr').textContent = t('スマホ用の QR コードを表示'); }
      if (!(s.net && s.net.enabled)) { el.className = 'status'; el.textContent = t('つないでいません'); }
      else if (n.status === 'on' && n.info) {
        el.className = 'status ok';
        el.textContent = t('ブリッジに接続中。スマホで {0} を開き、暗証番号 {1} を入力', n.info.urls.length ? n.info.urls.join(' / ') : t('（LAN に接続されていません）'), n.info.pin)
          + t('（接続中のスマホ {0} 台・OSC 受信 {1} 番）', n.info.phones, n.info.oscPort);
        if ($('osc-in')) $('osc-in').textContent = n.info.oscPort || '—';
        $('btn-qr').hidden = false;
      } else {
        el.className = 'status warn';
        el.textContent = n.status === 'connecting' ? t('接続中…') : t('ブリッジが見つかりません（起動しているか、アドレスを確認）。2 秒ごとに再接続します');
      }
      const m = io.dmx || { status: 'off' };
      const label = { off: t('使っていません'), on: t('送信中（{0} フレーム）', m.sent), 'wait-bridge': t('ブリッジにつながるのを待っています（Art-Net はブリッジ経由）'), 'no-port': t('「USB-DMX を選ぶ」を押してください'), error: t('エラー：') + (m.error || '') };
      $('dmx-status').textContent = d.enabled ? label[m.status] || m.status : t('使っていません');
      $('dmx-status').className = 'status ' + (!d.enabled ? '' : m.status === 'on' ? 'ok' : m.status === 'error' ? 'bad' : 'warn');
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

    async enableMidi() {
      const ok = await VJ.midi.init(panel.app);
      VJ.midi.onchange = () => panel.renderMidiStatus(true);
      panel.renderMidiStatus(ok);
      return ok;
    },

    renderMidiStatus(ok) {
      $('midi-status').textContent = ok
        ? (VJ.midi.inputs.length ? t('接続中：') + VJ.midi.inputs.join(', ') : t('MIDI 機器が見つかりません（つなぐと自動で認識）'))
        : t('この環境では MIDI を使えません');
    },

    /** MIDI の割り当て一覧（学習ボタン付き） */
    renderMidiMap() {
      const s = panel.app.settings, map = VJ.midi.map(s);
      const keyOf = (id) => Object.keys(map).filter((k) => map[k] === id);
      const learning = VJ.midi.learning && VJ.midi.learning.action;
      $('midi-map').innerHTML = VJ.midi.actions().map((a) => `<span>${esc(a.name)}</span><span class="k">${esc(keyOf(a.id).map(VJ.midi.keyLabel).join(' / ') || '—')}</span>`
        + `<button data-act="${esc(a.id)}" class="${learning === a.id ? 'wait' : ''}">${esc(learning === a.id ? t('待機中…') : t('学習'))}</button>`).join('');
      $('midi-map').querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (VJ.midi.learning && VJ.midi.learning.action === act) { VJ.midi.cancelLearn(); panel.renderMidiMap(); return; }
        if (!(await panel.enableMidi())) return;
        VJ.midi.learn(act, (key) => {
          VJ.midi.assign(s, key, act);
          panel.save();
          panel.renderMidiMap();
          panel.app.ui.toast(`MIDI: ${VJ.midi.keyLabel(key)} → ${VJ.midi.actions().find((x) => x.id === act).name}`);
        });
        panel.renderMidiMap();
      }));
    },

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

    /** オーバーレイ（画像・重ねるシーン・隅の文字）の欄。設定の中身は読み込みなどで入れ替わるので、毎回 settings から読む */
    initOverlay() {
      const s = panel.app.settings;
      const apply = () => panel.applyShow(true);
      const pct = (x) => Math.round(x * 100) + '%';
      $('ov-on').addEventListener('change', () => { s.overlayOn = $('ov-on').checked; apply(); });
      $('ov-file').addEventListener('change', panel.loadOverlayImage);
      $('btn-ov-clear').addEventListener('click', () => { s.overlay.image = ''; $('ov-file').value = ''; panel.syncOverlay(); apply(); });
      for (const [id, key] of [['ov-fit', 'imageFit'], ['ov-imgblend', 'imageBlend'], ['ov-scene', 'scene'], ['ov-sceneblend', 'sceneBlend'], ['ov-corner', 'corner']]) {
        $(id).addEventListener('change', () => { s.overlay[key] = $(id).value; apply(); });
      }
      for (const [id, key] of [['ov-clock', 'clock'], ['ov-band', 'band'], ['ov-song', 'song']]) {
        $(id).addEventListener('change', () => { s.overlay[key] = $(id).checked; apply(); });
      }
      $('ov-text').addEventListener('input', () => { s.overlay.text = $('ov-text').value; panel.applyShow(); });
      for (const [id, key] of [['ov-imgop', 'imageOpacity'], ['ov-sceneop', 'sceneOpacity'], ['ov-textop', 'textOpacity'], ['ov-textsize', 'textSize']]) {
        $(id).addEventListener('input', () => { s.overlay[key] = +$(id).value; $(id + '-v').textContent = pct(+$(id).value); apply(); });
      }
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
      const sel = $('ov-scene');
      sel.innerHTML = `<option value="">${esc(t('重ねない'))}</option>` + VJ.scenes.list.filter((d) => !d.hidden && d.id !== 'title')
        .map((d) => `<option value="${d.id}">${esc(d.key.replace('s', 'Shift+'))} ${esc(VJ.sceneName(d))}</option>`).join('');
      sel.value = o.scene;
      if (sel.selectedIndex < 0) sel.value = '';
      for (const [id, key] of [['ov-fit', 'imageFit'], ['ov-imgblend', 'imageBlend'], ['ov-sceneblend', 'sceneBlend'], ['ov-corner', 'corner']]) $(id).value = o[key];
      for (const [id, key] of [['ov-clock', 'clock'], ['ov-band', 'band'], ['ov-song', 'song']]) $(id).checked = !!o[key];
      if ($('ov-text').value !== o.text) $('ov-text').value = o.text;
      for (const [id, key] of [['ov-imgop', 'imageOpacity'], ['ov-sceneop', 'sceneOpacity'], ['ov-textop', 'textOpacity'], ['ov-textsize', 'textSize']]) {
        $(id).value = o[key];
        $(id + '-v').textContent = pct(o[key]);
      }
      const img = $('ov-preview');
      img.hidden = !o.image;
      if (o.image) img.src = o.image; else img.removeAttribute('src');
    },

    /** オーバーレイの画像を読み込む（長辺 1920px 以下・900KB 程度まで） */
    async loadOverlayImage(e) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        panel.app.settings.overlay.image = await panel._readImage(f, 1920, 9e5);
        panel.app.settings.overlayOn = true;
        panel.syncOverlay();
        panel.applyShow(true);
      } catch (err) {
        panel.app.ui.toast(t('画像を読み込めませんでした：') + err.message, 'warn');
      }
    },

    syncOutputUi() {
      const out = panel.app.settings.output;
      $('out-rotate').value = String(out.rotate);
      $('out-fliph').checked = !!out.flipH;
      $('out-flipv').checked = !!out.flipV;
      for (const [id, key] of [['out-size', 'size'], ['out-x', 'x'], ['out-y', 'y']]) {
        $(id).value = out[key];
        $(id).dispatchEvent(new Event('input'));
      }
    },

    renderWarnings() {
      const app = panel.app, w = [];
      if (VJ.compat.browser !== 'chromium') {
        const miss = VJ.compat.missing();
        w.push(t('{0} でも動きますが、次の機能は使えません：{1}。本番は Chrome か Microsoft Edge（または単体アプリ）がおすすめです。', VJ.compat.name, miss.join(t('・')) || t('なし')));
      }
      const r = app.renderer.info();
      if (r.software) w.push(t('GPU が使われていません（ソフトウェア描画）。Chrome の 設定 → システム →「グラフィック アクセラレーションが使用可能な場合は使用する」を ON にして再起動してください。'));
      if (r.failed.length) w.push(t('一部のシーンを読み込めませんでした（自動的に飛ばします）：') + r.failed.join(', '));
      try {
        if (location.protocol === 'file:' && /[^\x00-\x7f]/.test(decodeURIComponent(location.pathname))) {
          w.push(t('フォルダ名に日本語などが含まれています。念のため C:\\momosai-vj のような英数字だけの場所に置くのがおすすめです。'));
        }
      } catch (e) { /* noop */ }
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

    exportSettings() {
      const blob = new Blob([VJ.storage.toJSON(panel.app.settings)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'momosai-vj-settings.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },

    async importSettings(e) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        panel.replaceSettings(VJ.storage.fromJSON(await f.text()));
        panel.app.ui.toast(t('設定を読み込みました'));
      } catch (err) {
        alert(t('設定ファイルを読み込めませんでした：') + err.message);
      }
      e.target.value = '';
    },

    /** 設定をまるごと入れ替えて画面に反映 */
    replaceSettings(ns) {
      // 入力欄の更新で何度も反映しないように、最後に 1 回だけ（2 画面のときは出力側へ送る回数も減る）
      panel._bulk = true;
      try { panel._replace(ns); } finally { panel._bulk = false; }
      panel.applyShow(true);
      VJ.storage.save(panel.app.settings);
    },

    /** フラッシュの上限・激しさの表示（設定ファイルの値が選択肢に無ければ足す）と、推奨を超えたときの警告 */
    syncFlashLimit() {
      const s = panel.app.settings, sel = $('opt-flashlimit');
      const v = String(s.flashLimit);
      if (!Array.from(sel.options).some((o) => o.value === v)) sel.add(new Option(t('1 秒に {0} 回', v), v));
      sel.value = v;
      sel.disabled = !!s.noFlash;
      $('flashlimit-warn').hidden = !!s.noFlash || !VJ.safety.overSafe(s.flashLimit);
      $('opt-intensity').value = String(s.intensity);
    },

    _replace(ns) {
      const s = panel.app.settings;
      for (const k of Object.keys(ns)) s[k] = ns[k];
      s.output = Object.assign({}, OUT_DEFAULT, s.output || {});
      $('band').value = s.bandName;
      $('setlist').value = s.setlistText;
      $('channel').value = s.channel;
      $('monitor').checked = s.monitor;
      $('opt-profile').value = VJ.profileById(s.profile).id;
      panel.renderProfile();
      for (const [id, key] of [['opt-auto', 'auto'], ['opt-autoflash', 'autoFlash'], ['opt-noflash', 'noFlash'], ['opt-toast', 'toast'],
        ['opt-latsq', 'latencySquare'], ['opt-autostart', 'autoStart'], ['opt-desync', 'desynchronized'], ['opt-speechtitle', 'speechTitle'],
        ['opt-palauto', 'paletteAuto']]) $(id).checked = !!s[key];
      $('opt-xfade').value = String(s.crossfade);
      if ($('opt-xfade').selectedIndex < 0) $('opt-xfade').value = '-1';
      panel.syncFlashLimit();
      $('demo-kind').value = ['band', 'sing', 'speech'].includes(s.demoKind) ? s.demoKind : 'band';
      $('opt-lang').value = ['auto', 'ja', 'en'].includes(s.lang) ? s.lang : 'auto';
      if (VJ.i18n.resolve(s.lang) !== VJ.i18n.lang) panel.setLang(s.lang);
      for (const [id, key] of [['opt-sens', 'sensitivity'], ['opt-react', 'react'], ['opt-master', 'master'], ['opt-scale', 'maxScale'], ['opt-gate', 'gateDb']]) {
        $(id).value = s[key];
        $(id).dispatchEvent(new Event('input'));
      }
      $('opt-fps').value = String(s.fpsCap || 0);
      $('opt-palette').value = s.paletteIdx;
      panel.app.show.setPalette(s.paletteIdx | 0);
      $('opt-logomode').value = s.logoMode;
      $('opt-logocorner').value = s.logoCorner;
      for (let i = 0; i < 3; i++) $('msg-' + i).value = s.messages[i] || '';
      $('opt-countdown').value = s.countdownTo || '';
      panel.renderCustom();
      panel.renderAutoScenes();
      panel.renderSceneParams(true);
      panel.syncOverlay();
      VJ.sections.render();
      if ($('midi-map-box').open) panel.renderMidiMap();
      for (const [id, o, k] of [['net-on', 'net', 'enabled'], ['net-url', 'net', 'url'], ['osc-on', 'osc', 'enabled'], ['osc-host', 'osc', 'host'], ['osc-port', 'osc', 'port'], ['osc-rate', 'osc', 'rate'],
        ['dmx-on', 'dmx', 'enabled'], ['dmx-out', 'dmx', 'out'], ['dmx-host', 'dmx', 'host'], ['dmx-uni', 'dmx', 'universe'], ['dmx-type', 'dmx', 'type'], ['dmx-count', 'dmx', 'count'],
        ['dmx-start', 'dmx', 'start'], ['dmx-flash', 'dmx', 'flash'], ['dmx-max', 'dmx', 'max'], ['dmx-pulse', 'dmx', 'pulse']]) {
        const v = (s[o] || {})[k];
        if ($(id).type === 'checkbox') $(id).checked = !!v; else $(id).value = v === undefined ? '' : v;
      }
      for (const k of ['max', 'pulse']) $('dmx-' + k + '-v').textContent = Math.round($('dmx-' + k).value * 100) + '%';
      panel.renderIo();
      panel.renderLogo();
      panel.syncOutputUi();
    },

    /** キー操作などで変わった設定をパネルの表示に反映（出力ウィンドウからの通知など） */
    syncFromSettings() {
      const s = panel.app.settings;
      if (+$('opt-palette').value !== (s.paletteIdx | 0)) { $('opt-palette').value = s.paletteIdx; panel.renderCustom(); }
      for (const [id, key] of [['opt-sens', 'sensitivity'], ['opt-master', 'master']]) {
        if (+$(id).value !== +s[key]) { $(id).value = s[key]; $(id + '-v').textContent = key === 'master' ? Math.round(s[key] * 100) + '%' : (s[key] > 0 ? '+' : '') + s[key]; }
      }
      $('opt-auto').checked = !!s.auto;
      $('ov-on').checked = !!s.overlayOn;
    },
  };

  VJ.panel = panel;
})(globalThis.VJ = globalThis.VJ || {});
