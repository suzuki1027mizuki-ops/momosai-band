/* 照明（DMX）。映像と同じパレットの色で照明を光らせる。
 *   出力：USB-DMX（Enttec DMX USB Pro 互換 / FTDI の Open DMX 互換。Web Serial）か Art-Net（ブリッジ経由）
 *   灯体：同じ種類の灯体を count 台、start 番地から順に（1 台の幅は種類で決まる）
 *     rgb（R G B）/ drgb（調光 R G B）/ rgbw（R G B W）/ drgbw（調光 R G B W）/ dim（調光のみ）
 *   動き：音量で明るさ、キックで 1 台ずつ順に強く光る（チェイス）。色はパレットの 4 色を順に。
 *         フラッシュ（光過敏対策の制限を通ったもの）は白を足す。暗転・明るさは映像と同じ。
 * 光過敏対策：キックで強く光るのは 1 秒に 3 回まで。 */
(function (VJ) {
  'use strict';

  const TYPES = { rgb: 3, drgb: 4, rgbw: 4, drgbw: 5, dim: 1 };
  const DEFAULT = { enabled: false, out: 'artnet', host: '255.255.255.255', universe: 0, type: 'drgb', count: 4, start: 1, max: 1, pulse: 0.5, flash: true };
  const PULSE_GAP = 1 / 3;

  const dmx = {
    TYPES,
    DEFAULT,
    data: new Uint8Array(512),
    port: null,
    writer: null,
    serialMode: '',
    busy: false,
    status: 'off',
    error: '',
    sent: 0,
    _t: 0,
    _pulseAt: -1e9,
    _pulse: 0,
    _hot: 0,
    _lastKickN: -1,
    app: null,

    /** 設定（既定値で埋める） */
    config(settings) {
      const c = Object.assign({}, DEFAULT, (settings && settings.dmx) || {});
      c.count = Math.max(1, Math.min(128, c.count | 0));
      c.start = Math.max(1, Math.min(512, c.start | 0));
      if (!TYPES[c.type]) c.type = 'drgb';
      c.max = Math.max(0, Math.min(1, +c.max));
      c.pulse = Math.max(0, Math.min(1, +c.pulse));
      return c;
    },

    /**
     * 今の演出から DMX の値（512 ch）を作る。テストからも呼ぶ。
     * @param show ShowController（state.flash / black / master / sceneId / palFloat）
     * @param f 特徴量
     * @param c config()
     * @param t 時刻（秒）
     */
    compute(show, f, c, t, out) {
      out = out || dmx.data;
      out.fill(0);
      const st = show.state, pal = show.palFloat;
      const gain = c.max * (st.master === undefined ? 1 : st.master) * (1 - (st.black || 0));
      // キックのチェイス（1 秒に 3 回まで）
      if (f.kickN !== dmx._lastKickN) {
        if (dmx._lastKickN >= 0 && t - dmx._pulseAt >= PULSE_GAP) {
          dmx._pulseAt = t;
          dmx._hot = (dmx._hot + 1) % c.count;
        }
        dmx._lastKickN = f.kickN;
      }
      dmx._pulse = Math.exp(-Math.max(0, t - dmx._pulseAt) / 0.18);
      const flash = c.flash ? Math.min(1, st.flash || 0) : 0;
      const test = st.sceneId === 'test';
      const base = f.active ? 0.15 + 0.55 * f.level : 0.08;
      const w = TYPES[c.type];
      for (let i = 0; i < c.count; i++) {
        const a = c.start - 1 + i * w;
        if (a + w > 512) break;
        const k = (i % 4) * 3;
        let r = pal[k], g = pal[k + 1], b = pal[k + 2];
        let br = base + c.pulse * dmx._pulse * (i === dmx._hot ? 0.6 : 0.15);
        if (test) { r = g = b = 1; br = 0.5; }
        br = Math.min(1, br);
        const to = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
        if (c.type === 'dim') { out[a] = to((br + flash) * gain); continue; }
        if (c.type === 'drgb' || c.type === 'drgbw') {
          out[a] = to(Math.min(1, br + flash) * gain);
          const mix = (x) => x * (1 - flash) + flash;
          out[a + 1] = to(mix(r)); out[a + 2] = to(mix(g)); out[a + 3] = to(mix(b));
          if (c.type === 'drgbw') out[a + 4] = to(flash);
        } else {
          out[a] = to((r * br + flash) * gain); out[a + 1] = to((g * br + flash) * gain); out[a + 2] = to((b * br + flash) * gain);
          if (c.type === 'rgbw') out[a + 3] = to(flash * gain);
        }
      }
      return out;
    },

    /** Enttec DMX USB Pro の「DMX 送信」パケット（ラベル 6） */
    enttecPacket(data) {
      const n = data.length + 1;
      const p = new Uint8Array(n + 5);
      p[0] = 0x7e; p[1] = 6; p[2] = n & 0xff; p[3] = n >> 8; p[4] = 0;
      p.set(data, 5);
      p[n + 4] = 0xe7;
      return p;
    },

    /** 設定の反映（出力先が変わったらシリアルを閉じる） */
    apply(app) {
      dmx.app = app;
      const c = dmx.config(app.settings);
      if ((!c.enabled || c.out === 'artnet') && dmx.port) dmx.closeSerial();
      // USB-DMX の種類を変えたら、通信の設定（速さ・ストップビット）を変えて開き直す
      else if (c.enabled && dmx.port && dmx.serialMode !== c.out && !dmx._reopening) {
        dmx._reopening = true;
        dmx.openSerial(dmx.port).finally(() => { dmx._reopening = false; });
      }
      if (!c.enabled) dmx.status = 'off';
      else if (c.out === 'artnet') dmx.status = VJ.net && VJ.net.status === 'on' ? 'on' : 'wait-bridge';
      else dmx.status = dmx.port ? 'on' : 'no-port';
    },

    /** 毎フレーム：約 40Hz で送る */
    tick(app, f, nowMs) {
      const c = dmx.config(app.settings);
      if (!c.enabled || !f || nowMs - dmx._t < 25) return;
      dmx._t = nowMs;
      const data = dmx.compute(app.show, f, c, nowMs / 1000);
      if (c.out === 'artnet') {
        const ok = VJ.net && VJ.net.send({ t: 'dmx', d: Array.from(data.subarray(0, Math.min(512, c.start - 1 + c.count * TYPES[c.type] + 1))) });
        dmx.status = ok ? 'on' : 'wait-bridge';
        if (ok) dmx.sent++;
      } else if (dmx.writer && !dmx.busy) {
        dmx._write(data, c.out);
      }
    },

    async _write(data, mode) {
      dmx.busy = true;
      try {
        if (mode === 'opendmx') {
          // FTDI の Open DMX 互換：ブレーク → スタートコード 0 + 512ch（250kbps・8N2）
          await dmx.port.setSignals({ break: true });
          await new Promise((r) => setTimeout(r, 1));
          await dmx.port.setSignals({ break: false });
          const p = new Uint8Array(513);
          p.set(data, 1);
          await dmx.writer.write(p);
        } else {
          await dmx.writer.write(dmx.enttecPacket(data));
        }
        dmx.sent++;
        dmx.status = 'on';
      } catch (e) {
        dmx.error = e.message;
        dmx.status = 'error';
        dmx.closeSerial();
      } finally {
        dmx.busy = false;
      }
    },

    /** USB-DMX を選ぶ（クリック直後に呼ぶ）。選んだら開く */
    async chooseSerial() {
      if (!navigator.serial) throw new Error(VJ.t('この環境では USB-DMX（Web Serial）を使えません（Chrome / Edge / 単体アプリで使えます）'));
      const port = await navigator.serial.requestPort();
      return port;
    },

    /** 許可済みの USB-DMX を開く（2 画面のときは、操作側で選んだあと出力側でこれを呼ぶ）。
     *  info：操作側で選んだポートの getInfo()（同じ USB の製品番号のポートを選ぶ） */
    async openGranted(info) {
      if (!navigator.serial) return false;
      let ports = await navigator.serial.getPorts();
      if (info && info.usbVendorId !== undefined) {
        const same = ports.filter((p) => { const i = p.getInfo ? p.getInfo() : {}; return i.usbVendorId === info.usbVendorId && i.usbProductId === info.usbProductId; });
        if (same.length) ports = same;
      }
      if (!ports.length) { dmx.status = 'no-port'; return false; }
      return dmx.openSerial(ports[ports.length - 1]);
    },

    async openSerial(port) {
      await dmx.closeSerial();
      const c = dmx.config(dmx.app && dmx.app.settings);
      try {
        await port.open(c.out === 'opendmx' ? { baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none' } : { baudRate: 57600 });
        dmx.port = port;
        dmx.writer = port.writable.getWriter();
        dmx.serialMode = c.out;
        dmx.info = port.getInfo ? port.getInfo() : null;
        dmx.status = 'on';
        dmx.error = '';
        return true;
      } catch (e) {
        dmx.status = 'error';
        dmx.error = e.message;
        return false;
      }
    },

    async closeSerial() {
      const port = dmx.port, w = dmx.writer;
      dmx.port = null; dmx.writer = null;
      try { if (w) { await w.close().catch(() => {}); w.releaseLock(); } } catch (e) { /* noop */ }
      try { if (port) await port.close(); } catch (e) { /* noop */ }
    },

    state() { return { status: dmx.status, error: dmx.error, sent: dmx.sent }; },
  };

  VJ.dmx = dmx;
})(globalThis.VJ = globalThis.VJ || {});
