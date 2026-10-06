/* 設定パネル（開始画面兼用）。映像は背後で動き続けるので、設定しながら見え方を確認できる。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const panel = {
    app: null,
    visible: true,
    _saveT: null,
    _prevT: null,
    _meterT: 0,

    init(app) {
      panel.app = app;
      const s = app.settings;
      $('ver').textContent = VJ.version.startsWith('__') ? '開発版（index.html）' : `v${VJ.version} ${VJ.buildTime}`;

      // 入力
      document.querySelectorAll('input[name=src]').forEach((r) => r.addEventListener('change', panel._srcChanged));
      $('btn-refresh').addEventListener('click', () => panel.refreshDevices());
      $('btn-start').addEventListener('click', () => panel.startAudio());
      $('device').addEventListener('change', () => {
        const d = $('device');
        s.deviceId = d.value;
        s.deviceLabel = d.selectedOptions[0] ? d.selectedOptions[0].textContent : '';
        panel.save();
        if (app.engine.running && app.engine.opts.source === 'mic') panel.startAudio();
      });
      $('channel').value = s.channel;
      $('channel').addEventListener('change', () => { s.channel = $('channel').value; app.engine.setChannel(s.channel); panel.save(); });
      $('monitor').checked = s.monitor;
      $('monitor').addEventListener('change', () => { s.monitor = $('monitor').checked; app.engine.setMonitor(s.monitor); panel.save(); });
      app.engine.on((st, msg) => panel.renderStatus(st, msg));

      // バンド名・セットリスト
      $('band').value = s.bandName;
      $('setlist').value = s.setlistText;
      $('band').addEventListener('input', () => { s.bandName = $('band').value; panel.applyShow(); });
      $('setlist').addEventListener('input', () => { s.setlistText = $('setlist').value; panel.applyShow(); });

      // オプション
      const bindCheck = (id, key, after) => {
        $(id).checked = !!s[key];
        $(id).addEventListener('change', () => { s[key] = $(id).checked; if (after) after(); panel.applyShow(true); });
      };
      bindCheck('opt-auto', 'auto');
      bindCheck('opt-autoflash', 'autoFlash');
      bindCheck('opt-toast', 'toast');
      bindCheck('opt-latsq', 'latencySquare');
      bindCheck('opt-desync', 'desynchronized', () => app.ui.toast('低遅延描画の切替は再読み込み後に有効になります'));
      const bindRange = (id, key, fmt, after) => {
        const el = $(id), v = $(id + '-v');
        el.value = s[key];
        v.textContent = fmt(+el.value);
        el.addEventListener('input', () => { s[key] = +el.value; v.textContent = fmt(+el.value); if (after) after(); panel.applyShow(true); });
      };
      bindRange('opt-sens', 'sensitivity', (x) => (x > 0 ? '+' : '') + x);
      bindRange('opt-master', 'master', (x) => Math.round(x * 100) + '%');
      bindRange('opt-scale', 'maxScale', (x) => Math.round(x * 100) + '%', () => app.renderer.setMaxScale(s.maxScale));
      const pal = $('opt-palette');
      pal.innerHTML = VJ.palettes.map((p, i) => `<option value="${i}">${i + 1}. ${esc(p.name)}</option>`).join('');
      pal.value = s.paletteIdx;
      pal.addEventListener('change', () => { s.paletteIdx = +pal.value; panel.renderCustom(); panel.applyShow(true); });
      panel.renderCustom();

      $('btn-export').addEventListener('click', panel.exportSettings);
      $('btn-import').addEventListener('click', () => $('import-file').click());
      $('import-file').addEventListener('change', panel.importSettings);
      $('btn-reset').addEventListener('click', () => {
        if (!confirm('設定（セットリスト含む）を初期状態に戻しますか？')) return;
        panel.replaceSettings(VJ.storage.reset());
      });

      $('btn-show').addEventListener('click', () => panel.startShow());
      $('panel-close').addEventListener('click', () => panel.toggle(false));

      // キー一覧
      const keysHtml = VJ.keys.KEY_HELP.map(([k, d]) => `<kbd>${esc(k)}</kbd><span>${esc(d)}</span>`).join('');
      $('keys-full').innerHTML = keysHtml;
      $('keys-mini').innerHTML = VJ.keys.KEY_HELP.slice(0, 8).map(([k, d]) => `<kbd>${esc(k)}</kbd><span>${esc(d)}</span>`).join('');

      panel._srcChanged();
      panel.renderSetlist();
      panel.renderWarnings();
      panel.refreshDevices();
    },

    _srcChanged() {
      const src = panel.source();
      $('mic-opts').hidden = src !== 'mic';
      $('file-opts').hidden = src !== 'file';
      $('monitor-row').hidden = src === 'mic';
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
      // 保存されたデバイス（ID → 名前の順で探す）
      let pick = devs.find((d) => d.deviceId === s.deviceId);
      if (!pick && s.deviceLabel) pick = devs.find((d) => d.label === s.deviceLabel);
      sel.value = pick ? pick.deviceId : '';
    },

    async startAudio() {
      const app = panel.app, s = app.settings;
      const src = panel.source();
      const opts = { source: src, deviceId: $('device').value || s.deviceId, deviceLabel: s.deviceLabel, channel: s.channel, monitor: s.monitor };
      if (src === 'file') {
        const f = $('file').files[0];
        if (!f) { panel.renderStatus('error', '音声ファイルを選んでください'); return false; }
        opts.fileData = await f.arrayBuffer();
      }
      $('btn-start').disabled = true;
      try {
        await app.startAudio(opts);
        if (src === 'mic') {
          s.deviceId = app.engine.opts.deviceId;
          s.deviceLabel = app.engine.opts.deviceLabel;
          panel.save();
          await panel.refreshDevices();
        }
        $('btn-start').textContent = '↻ 入力を切り替え / 再開始';
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
        const name = e.opts.source === 'mic' ? d.device : e.opts.source === 'demo' ? 'デモ音源' : '音声ファイル';
        el.textContent = `入力中：${name}（${d.sampleRate}Hz / ${d.channels}ch）${msg ? ' — ' + msg : ''}`;
      } else if (st === 'starting') el.textContent = '開始中…（マイクの許可を求められたら「許可」）';
      else if (st === 'error') el.textContent = msg || 'エラー';
      else if (st === 'lost' || st === 'reconnecting') el.textContent = msg || '再接続中…';
      else el.textContent = 'まだ開始していません';
    },

    /** メーター（20Hz） */
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
    },

    applyShow(immediate) {
      clearTimeout(panel._prevT);
      const run = () => {
        panel.app.show.applySettings(panel.app.settings);
        panel.renderSetlist();
        panel.save();
      };
      if (immediate) run(); else panel._prevT = setTimeout(run, 200);
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

    async startShow() {
      const app = panel.app;
      if (!app.engine.running) {
        const ok = await panel.startAudio();
        if (!ok) { app.ui.toast('音声入力を開始できませんでした（パネルの表示を確認）', 'warn'); }
      }
      await VJ.guard.startShow();
      panel.toggle(false);
      app.ui.toast('ショー開始 — H でキー一覧 / M で設定');
    },

    toggle(force) {
      panel.visible = force === undefined ? !panel.visible : !!force;
      $('panel').hidden = !panel.visible;
      if (!panel.visible && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    },

    save() {
      clearTimeout(panel._saveT);
      panel._saveT = setTimeout(() => VJ.storage.save(panel.app.settings), 300);
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

    replaceSettings(ns) {
      const s = panel.app.settings;
      for (const k of Object.keys(ns)) s[k] = ns[k];
      $('band').value = s.bandName;
      $('setlist').value = s.setlistText;
      $('channel').value = s.channel;
      $('monitor').checked = s.monitor;
      $('opt-auto').checked = s.auto;
      $('opt-autoflash').checked = s.autoFlash;
      $('opt-toast').checked = s.toast;
      $('opt-latsq').checked = s.latencySquare;
      $('opt-desync').checked = s.desynchronized;
      for (const [id, key] of [['opt-sens', 'sensitivity'], ['opt-master', 'master'], ['opt-scale', 'maxScale']]) {
        $(id).value = s[key];
        $(id).dispatchEvent(new Event('input'));
      }
      $('opt-palette').value = s.paletteIdx;
      panel.renderCustom();
      panel.applyShow(true);
      VJ.storage.save(s);
    },
  };

  VJ.panel = panel;
})(globalThis.VJ = globalThis.VJ || {});
