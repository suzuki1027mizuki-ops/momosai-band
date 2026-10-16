/* 設定パネル：① 音声入力・② 音楽のタイプ（入力の選び方・機器の一覧・開始・入力の状態の表示）。
 * panel.js の続き（VJ.panel にメソッドを足す。中身は panel.js から移しただけ）。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);
  const panel = VJ.panel;

  Object.assign(panel, {
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

    renderProfile() {
      const p = VJ.profileById(panel.app.settings.profile);
      $('profile-desc').textContent = VJ.profileDesc(p);
    },

    /** セットリストの表（setlisted.js。入力中は作り直さない） */
    renderSetlist() { VJ.setlistEd.render(); },
  });
})(globalThis.VJ = globalThis.VJ || {});
