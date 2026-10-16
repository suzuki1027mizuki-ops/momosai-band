/* 設定パネル：⑦ 外部連携（ブリッジ・スマホ操作・OSC・照明）と MIDI。
 * panel.js の続き（VJ.panel にメソッドを足す。中身は panel.js から移しただけ）。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (...a) => VJ.t(...a);
  const panel = VJ.panel;

  Object.assign(panel, {
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
      // スマホの許可・断る・外す（2 画面のときは、ブリッジにつないでいる出力ウィンドウへ）
      $('net-phones').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const [name, args] = b.dataset.act === 'forget' ? ['forget', [b.dataset.id]] : ['approve', [b.dataset.id, b.dataset.act === 'approve']];
        if (VJ.link.role === 'control') VJ.link.send({ t: 'cmd', target: 'net', name, args });
        else VJ.net[name](...args);
      });
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
        // 鍵なしでつないでいる（暗証番号・QR を受け取っていない）ときは、ブリッジの /qr のページを開く（この PC からだけ見られる）
        const io = VJ.link.role === 'control' ? (VJ.link.lastStatus && VJ.link.lastStatus.io) || {} : { net: VJ.net.state() };
        const ni = io.net && io.net.info;
        if (!codes.length && ni && !ni.pin && ni.port) { window.open(`http://127.0.0.1:${ni.port | 0}/qr`, '_blank'); return; }
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
        const urlTxt = n.info.urls.length ? n.info.urls.join(' / ') : t('（LAN に接続されていません）');
        el.textContent = (n.info.pin ? t('ブリッジに接続中。スマホで {0} を開き、暗証番号 {1} を入力', urlTxt, n.info.pin)
          : t('ブリッジに接続中。スマホで {0} を開き、ブリッジの画面に出ている暗証番号を入力（下のボタンで QR のページを開けます）', urlTxt))
          + t('（接続中のスマホ {0} 台・OSC 受信 {1} 番）', n.info.phones, n.info.oscPort);
        if ($('osc-in')) $('osc-in').textContent = n.info.oscPort || '—';
        $('btn-qr').hidden = false;
      } else {
        el.className = 'status warn';
        el.textContent = n.status === 'connecting' ? t('接続中…') : t('ブリッジが見つかりません（起動しているか、アドレスを確認）。2 秒ごとに再接続します');
      }
      panel.renderPhones(s.net && s.net.enabled && n.status === 'on' ? n.info : null);
      const m = io.dmx || { status: 'off' };
      const label = { off: t('使っていません'), on: t('送信中（{0} フレーム）', m.sent), 'wait-bridge': t('ブリッジにつながるのを待っています（Art-Net はブリッジ経由）'), 'no-port': t('「USB-DMX を選ぶ」を押してください'), error: t('エラー：') + (m.error || '') };
      $('dmx-status').textContent = d.enabled ? label[m.status] || m.status : t('使っていません');
      $('dmx-status').className = 'status ' + (!d.enabled ? '' : m.status === 'on' ? 'ok' : m.status === 'error' ? 'bad' : 'warn');
    },

    /** スマホの許可待ち・許可したスマホ（ブリッジの info）。変わったときだけ描き直す（押している途中のボタンを消さないように）。
     *  機種の名前はスマホから来る文字なので、必ずエスケープする（html`…`） */
    renderPhones(info) {
      const el = $('net-phones');
      const sig = JSON.stringify(info ? [info.trusted, info.pending, info.devices, VJ.i18n.lang] : null);
      if (sig === panel._phonesSig) return;
      panel._phonesSig = sig;
      const { html, raw } = VJ.dom;
      if (!info) { VJ.dom.set(el, ''); el.hidden = true; return; }
      el.hidden = false;
      let out = '';
      if (!info.trusted) out += html`<div class="hint">${t('鍵つきのアドレス（ブリッジの画面に出ている /vj?k=… ）でつなぐと、新しいスマホを VJ 側で許可できます。いまは暗証番号だけで入れます')}</div>`;
      for (const p of info.pending || []) {
        out += html`<div class="row phone-req"><span>${t('📱 {0}（{1}）がつなごうとしています', p.name, p.addr)}</span>`
          + html`<button data-act="approve" data-id="${p.id}">${t('許可')}</button><button data-act="deny" data-id="${p.id}">${t('断る')}</button></div>`;
      }
      if ((info.devices || []).length) {
        out += html`<div class="row"><span class="hint">${t('許可したスマホ')}</span></div>`;
        for (const d of info.devices) out += html`<div class="row" data-online="${d.online ? 1 : 0}"><span>${d.name}</span><span class="hint">${d.online ? t('つながっています') : t('つながっていません')}</span><button data-act="forget" data-id="${d.id}">${t('外す')}</button></div>`;
      }
      VJ.dom.set(el, raw(out));
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
  });
})(globalThis.VJ = globalThis.VJ || {});
