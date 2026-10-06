/* 設定パネル（開始画面兼用）。映像は背後で動き続けるので、設定しながら見え方を確認できる。
 * 操作はすべて app 経由（app.show / app.engine / app.applySettings）。出力ウィンドウ（2 画面）のときは
 * app.show・app.engine がリモコン（link.js）に差し替わるので、このファイルは同じまま動く。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const OUT_DEFAULT = { rotate: 0, flipH: false, flipV: false, size: 1, x: 0, y: 0 };

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
      $('ver').textContent = VJ.version.startsWith('__') ? '開発版（index.html）' : `v${VJ.version} ${VJ.buildTime}`;

      // ① 入力
      document.querySelectorAll('input[name=src]').forEach((r) => r.addEventListener('change', panel._srcChanged));
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
      $('channel').value = s.channel;
      $('channel').addEventListener('change', () => { s.channel = $('channel').value; app.engine.setChannel(s.channel); panel.save(); });
      $('monitor').checked = s.monitor;
      $('monitor').addEventListener('change', () => { s.monitor = $('monitor').checked; app.engine.setMonitor(s.monitor); panel.save(); });
      panel.bindEngine();

      // ② 音楽のタイプ・テンポ
      const prof = $('opt-profile');
      prof.innerHTML = VJ.profiles.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
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
        el.addEventListener('input', () => { out[key] = +el.value; v.textContent = fmt(+el.value); panel.applyShow(true); });
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

      // ⑤ オプション
      const bindCheck = (id, key, after) => {
        $(id).checked = !!s[key];
        $(id).addEventListener('change', () => { s[key] = $(id).checked; if (after) after(); panel.applyShow(true); });
      };
      bindCheck('opt-auto', 'auto');
      bindCheck('opt-autoflash', 'autoFlash');
      bindCheck('opt-noflash', 'noFlash');
      bindCheck('opt-toast', 'toast');
      bindCheck('opt-latsq', 'latencySquare');
      bindCheck('opt-autostart', 'autoStart');
      bindCheck('opt-desync', 'desynchronized', () => app.ui.toast('低遅延描画の切替は再読み込み後に有効になります'));
      const bindRange = (id, key, fmt) => {
        const el = $(id), v = $(id + '-v');
        el.value = s[key];
        v.textContent = fmt(+el.value);
        el.addEventListener('input', () => { s[key] = +el.value; v.textContent = fmt(+el.value); panel.applyShow(true); });
      };
      bindRange('opt-sens', 'sensitivity', (x) => (x > 0 ? '+' : '') + x);
      bindRange('opt-react', 'react', (x) => Math.round(x * 100) + '%');
      bindRange('opt-master', 'master', (x) => Math.round(x * 100) + '%');
      bindRange('opt-scale', 'maxScale', (x) => Math.round(x * 100) + '%');
      bindRange('opt-gate', 'gateDb', (x) => x + ' dBFS');
      $('opt-fps').value = String(s.fpsCap || 0);
      $('opt-fps').addEventListener('change', () => { s.fpsCap = +$('opt-fps').value; panel.applyShow(true); });
      const pal = $('opt-palette');
      pal.innerHTML = VJ.palettes.map((p, i) => `<option value="${i}">${i + 1}. ${esc(p.name)}</option>`).join('');
      pal.value = s.paletteIdx;
      pal.addEventListener('change', () => { app.show.setPalette(+pal.value); s.paletteIdx = +pal.value; panel.renderCustom(); panel.applyShow(true); });
      panel.renderCustom();
      panel.renderAutoScenes();

      $('btn-export').addEventListener('click', panel.exportSettings);
      $('btn-import').addEventListener('click', () => $('import-file').click());
      $('import-file').addEventListener('change', panel.importSettings);
      $('btn-reset').addEventListener('click', () => {
        if (!confirm('設定（セットリスト含む）を初期状態に戻しますか？')) return;
        panel.replaceSettings(VJ.storage.reset());
      });
      $('btn-midi').addEventListener('click', async () => {
        const ok = await VJ.midi.init(app);
        $('midi-status').textContent = ok
          ? (VJ.midi.inputs.length ? '接続中：' + VJ.midi.inputs.join(', ') : 'MIDI 機器が見つかりません（つなぐと自動で認識）')
          : 'この環境では MIDI を使えません';
      });

      // ⑥ 本番・再開
      $('btn-show').addEventListener('click', () => panel.startShow());
      $('panel-close').addEventListener('click', () => panel.toggle(false));
      $('btn-resume').addEventListener('click', () => { app.show.restoreSession(panel._resume); $('resume-box').hidden = true; });
      $('btn-resume-no').addEventListener('click', () => { $('resume-box').hidden = true; });

      // キー一覧
      $('keys-full').innerHTML = VJ.keys.KEY_HELP.map(([k, d]) => `<kbd>${esc(k)}</kbd><span>${esc(d)}</span>`).join('');
      $('keys-mini').innerHTML = VJ.keys.KEY_HELP.slice(0, 8).map(([k, d]) => `<kbd>${esc(k)}</kbd><span>${esc(d)}</span>`).join('');

      // 前回の音声入力の種類を選んでおく
      const last = s.lastSource;
      if (last && document.querySelector(`input[name=src][value=${last}]`)) document.querySelector(`input[name=src][value=${last}]`).checked = true;
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
      const opts = ['<option value="">（既定のデバイス）</option>'];
      devs.forEach((d, i) => {
        if (d.deviceId === 'default' || d.deviceId === '') return;
        opts.push(`<option value="${esc(d.deviceId)}">${esc(d.label || `入力デバイス ${i + 1}（開始すると名前が出ます）`)}</option>`);
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
      const opts = Object.assign({ source: src, deviceId: $('device').value || s.deviceId, deviceLabel: s.deviceLabel, channel: s.channel, monitor: s.monitor }, given || {});
      if (src === 'file' && !opts.files) {
        if (!panel.files.length) { panel.renderStatus('error', '音声ファイルを選んでください（複数選ぶと順番に再生）'); return false; }
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
        $('btn-start').textContent = '↻ 入力を切り替え / 再開始';
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
      el.className = 'status ' + (st === 'running' ? 'ok' : st === 'error' ? 'bad' : st === 'idle' ? '' : 'warn');
      if (st === 'running') {
        const d = e.diagnostics();
        el.textContent = `入力中：${d.device}（${d.sampleRate}Hz / ${d.channels}ch）${msg ? ' — ' + msg : ''}`;
      } else if (st === 'starting') el.textContent = '開始中…（マイクや画面共有の許可を求められたら「許可」）';
      else if (st === 'error') el.textContent = msg || 'エラー';
      else if (st === 'lost' || st === 'reconnecting') el.textContent = msg || '再接続中…';
      else el.textContent = 'まだ開始していません';
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
      if (perfNow - (panel._syncT || 0) > 500) { panel._syncT = perfNow; panel.syncFromSettings(); }
      if (f) {
        $('bpm-view').textContent = f.bpm && f.beatConf > 0.2 ? `${Math.round(f.bpm)} BPM${f.tempoManual ? '（タップ）' : ''}` : '— BPM';
        $('mode-view').textContent = !f.active ? '' : f.melodic ? 'ドラムの無い曲として反応中' : 'ドラムに反応中';
      }
    },

    applyShow(immediate) {
      clearTimeout(panel._prevT);
      const run = () => {
        panel.app.applySettings();
        panel.renderSetlist();
        panel.save();
      };
      if (immediate) run(); else panel._prevT = setTimeout(run, 200);
    },

    renderProfile() {
      const p = VJ.profileById(panel.app.settings.profile);
      $('profile-desc').textContent = p.desc;
    },

    renderSetlist() {
      const p = panel.app.show.setlist;
      const name = (id) => (VJ.scenes.byId[id] ? VJ.scenes.byId[id].key + ' ' + VJ.scenes.byId[id].nameJa : id);
      let html = '';
      if (p.band) html += `<div class="hint">バンド名：<b>${esc(p.band)}</b>（@band が優先）</div>`;
      if (p.songs.length) {
        html += '<table class="setlist"><tr><th>#</th><th>曲名</th><th>シーン</th><th>パレット</th></tr>';
        p.songs.forEach((s, i) => {
          html += `<tr><td>M${i + 1}</td><td>${esc(s.title)}${s.notitle ? ' <span class="hint">(曲名なし)</span>' : ''}</td>`
            + `<td>${s.scenes.length ? s.scenes.map(name).map(esc).join(' → ') : '<span class="hint">オート</span>'}</td>`
            + `<td>${s.palette !== null ? esc(VJ.palettes[s.palette].name) : '<span class="hint">—</span>'}</td></tr>`;
        });
        html += '</table>';
      } else {
        html += '<div class="hint">曲が登録されていません（→ キーの曲送りは使えません）</div>';
      }
      if (p.end) html += `<div class="hint">終演の文字：<b>${esc(p.end)}</b></div>`;
      for (const e of p.errors) html += `<div class="err">${e.line} 行目：${esc(e.msg)}</div>`;
      $('setlist-preview').innerHTML = html;
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
        .map((d) => `<label><input type="checkbox" data-scene="${d.id}" ${s.autoScenes[d.id] === false ? '' : 'checked'}> ${d.key} ${esc(d.nameJa)}</label>`).join('');
      el.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
        s.autoScenes[inp.dataset.scene] = inp.checked;
        panel.applyShow(true);
      }));
    },

    renderLogo() {
      const s = panel.app.settings, img = $('logo-preview');
      img.hidden = !s.logo;
      if (s.logo) img.src = s.logo; else img.removeAttribute('src');
    },

    /** ロゴ画像を読み込み、長辺 1024px 以下に縮めて data URL にする（設定に保存できる大きさに） */
    async loadLogo(e) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('画像を読み込めません')); i.src = url; });
        const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        let out = c.toDataURL('image/png');
        if (out.length > 1.5e6) out = c.toDataURL('image/webp', 0.9);
        panel.app.settings.logo = out;
        if (panel.app.settings.logoMode === 'off') { panel.app.settings.logoMode = 'title'; $('opt-logomode').value = 'title'; }
        panel.renderLogo();
        panel.applyShow(true);
      } catch (err) {
        panel.app.ui.toast('ロゴ画像を読み込めませんでした：' + err.message, 'warn');
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
      const ua = navigator.userAgent;
      if (!/Chrome\/|Chromium\/|Edg\//.test(ua) || /Firefox\//.test(ua)) w.push('Chrome か Microsoft Edge で開いてください（このブラウザでは正しく動かない可能性があります）。');
      const r = app.renderer.info();
      if (r.software) w.push('GPU が使われていません（ソフトウェア描画）。Chrome の 設定 → システム →「グラフィック アクセラレーションが使用可能な場合は使用する」を ON にして再起動してください。');
      if (r.failed.length) w.push('一部のシーンを読み込めませんでした（自動的に飛ばします）：' + r.failed.join(', '));
      try {
        if (location.protocol === 'file:' && /[^\x00-\x7f]/.test(decodeURIComponent(location.pathname))) {
          w.push('フォルダ名に日本語などが含まれています。念のため C:\\momosai-vj のような英数字だけの場所に置くのがおすすめです。');
        }
      } catch (e) { /* noop */ }
      $('warnings').innerHTML = w.map((x) => `<div class="warnbox">⚠ ${esc(x)}</div>`).join('');
    },

    /** 前回の続き（起動時に main.js から） */
    offerResume(sess) {
      panel._resume = sess;
      const songs = panel.app.show.setlist.songs;
      const song = sess.songIdx >= 0 && songs[sess.songIdx];
      $('resume-text').textContent = song ? `前回は M${sess.songIdx + 1}「${song.title}」まで進んでいました。` : sess.endState ? '前回は終演まで進んでいました。' : '前回の状態が残っています。';
      $('resume-box').hidden = false;
    },

    async startShow() {
      const app = panel.app;
      const warn = (e) => { app.ui.toast('ショー開始に失敗しました：' + ((e && e.message) || e), 'warn'); };
      // 全画面はクリック直後でないと許可されないので、ふつうは先に。
      // ただし「PC で再生中の音」は画面共有の開始にもクリック直後が必要なので、そちらを先にする
      const displayFirst = !app.engine.running && panel.source() === 'display';
      let shown = null;
      if (!displayFirst) shown = Promise.resolve().then(() => app.ui.startShow()).catch(warn);
      panel.toggle(false);
      if (!app.engine.running) {
        const ok = await panel.startAudio();
        if (!ok) { panel.toggle(true); app.ui.toast('音声入力を開始できませんでした（パネルの表示を確認）', 'warn'); }
      }
      if (displayFirst) shown = Promise.resolve().then(() => app.ui.startShow()).catch(warn);
      await shown;
      if (VJ.link.role === 'solo' && !document.fullscreenElement) app.ui.toast('F キーで全画面にできます', 'warn');
      else app.ui.toast('ショー開始 — H でキー一覧 / M で設定');
    },

    toggle(force) {
      panel.visible = force === undefined ? !panel.visible : !!force;
      $('panel').hidden = !panel.visible;
      if (!panel.visible && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    },

    save() {
      if (VJ.link && VJ.link.role === 'output') return; // 出力ウィンドウは保存しない（操作側が保存する）
      clearTimeout(panel._saveT);
      panel._saveT = setTimeout(() => {
        if (!VJ.storage.save(panel.app.settings)) panel.app.ui.toast('設定を保存できませんでした（ロゴ画像が大きすぎる可能性があります）', 'warn');
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
        panel.app.ui.toast('設定を読み込みました');
      } catch (err) {
        alert('設定ファイルを読み込めませんでした：' + err.message);
      }
      e.target.value = '';
    },

    /** 設定をまるごと入れ替えて画面に反映 */
    replaceSettings(ns) {
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
        ['opt-latsq', 'latencySquare'], ['opt-autostart', 'autoStart'], ['opt-desync', 'desynchronized']]) $(id).checked = !!s[key];
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
      panel.renderLogo();
      panel.syncOutputUi();
      panel.applyShow(true);
      VJ.storage.save(s);
    },

    /** キー操作などで変わった設定をパネルの表示に反映（出力ウィンドウからの通知など） */
    syncFromSettings() {
      const s = panel.app.settings;
      if (+$('opt-palette').value !== (s.paletteIdx | 0)) { $('opt-palette').value = s.paletteIdx; panel.renderCustom(); }
      for (const [id, key] of [['opt-sens', 'sensitivity'], ['opt-master', 'master']]) {
        if (+$(id).value !== +s[key]) { $(id).value = s[key]; $(id + '-v').textContent = key === 'master' ? Math.round(s[key] * 100) + '%' : (s[key] > 0 ? '+' : '') + s[key]; }
      }
      $('opt-auto').checked = !!s.auto;
    },
  };

  VJ.panel = panel;
})(globalThis.VJ = globalThis.VJ || {});
