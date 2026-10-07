/* ブリッジ（bridge/server.mjs・単体アプリでは組み込み）との接続：スマホ操作・OSC・Art-Net。
 *   ブリッジ → VJ … 操作（スマホ・OSC から）。決まった操作だけを受け付け、引数の型も確かめる
 *   VJ → ブリッジ … 状態（スマホの画面用・5Hz）・特徴量（OSC 送信用・設定の頻度）・照明の値（Art-Net）
 * 音声解析をしているウィンドウ（1 画面ならこの画面、2 画面なら出力ウィンドウ）で動く。
 * 接続するかどうかは設定（settings.net）で決まるので、2 画面のときも操作側のパネルから切り替えられる。 */
(function (VJ) {
  'use strict';

  const net = {
    ws: null,
    status: 'off', // off / connecting / on / error
    info: null, // ブリッジから：{ pin, urls, oscPort, phones }
    url: '',
    app: null,
    _retry: null,
    _statusT: 0,
    _featT: 0,
    _flags: 0,
    _cfgKey: '',

    /** 設定を反映（接続・切断・OSC / Art-Net の設定送信） */
    apply(app) {
      net.app = app;
      const n = app.settings.net || {};
      const want = n.enabled ? String(n.url || '') : '';
      if (want !== net.url) {
        net._close();
        net.url = want;
        if (want) net._connect();
      }
      net._sendConfig();
    },

    _connect() {
      clearTimeout(net._retry);
      if (!net.url) return;
      if (typeof WebSocket === 'undefined') { net.status = 'error'; return; }
      net.status = 'connecting';
      let ws;
      try { ws = new WebSocket(net.url); } catch (e) { net.status = 'error'; net.error = e.message; return; }
      net.ws = ws;
      ws.onopen = () => { net.status = 'on'; net.error = ''; net._cfgKey = ''; net._sendConfig(); };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t === 'info') net.info = { pin: String(m.pin || ''), urls: Array.isArray(m.urls) ? m.urls.map(String) : [], oscPort: m.oscPort | 0, phones: m.phones | 0 };
        else if (m.t === 'cmd') net.exec(m.name, m.args, m.from);
      };
      ws.onerror = () => { net.error = VJ.t('ブリッジにつながりません'); };
      ws.onclose = () => {
        if (net.ws !== ws) return;
        net.ws = null;
        net.status = net.url ? 'error' : 'off';
        net.info = null;
        if (net.url) net._retry = setTimeout(net._connect, 2000);
      };
    },

    _close() {
      clearTimeout(net._retry);
      const ws = net.ws;
      net.ws = null;
      net.info = null;
      net.status = 'off';
      if (ws) { try { ws.close(); } catch (e) { /* noop */ } }
    },

    send(obj) {
      const ws = net.ws;
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    },

    _sendConfig() {
      const s = net.app && net.app.settings;
      if (!s || !net.ws || net.ws.readyState !== 1) return;
      const o = s.osc || {}, d = s.dmx || {};
      const cfg = {
        t: 'config',
        osc: { enabled: !!o.enabled, host: String(o.host || '127.0.0.1'), port: +o.port || 9001 },
        artnet: { enabled: !!d.enabled && d.out === 'artnet', host: String(d.host || '255.255.255.255'), universe: d.universe | 0 },
      };
      const key = JSON.stringify(cfg);
      if (key === net._cfgKey) return;
      net._cfgKey = key;
      net.send(cfg);
    },

    /** スマホ・OSC からの操作。決まった名前と型だけ */
    exec(name, args, from) {
      const app = net.app;
      if (!app || typeof name !== 'string' || !Array.isArray(args)) return false;
      const show = app.show, a0 = args[0];
      const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
      if (show.state.locked && name !== 'blackout') return false;
      switch (name) {
        case 'scene': {
          const id = typeof a0 === 'string' ? VJ.scenes.resolve(a0) : null;
          if (!id) return false;
          show.selectScene(id, { immediate: true });
          break;
        }
        case 'flash': show.flash(0.85, 'remote'); break;
        case 'blackout': if (typeof a0 === 'boolean') show.setBlackout(a0); else show.toggleBlackout(); break;
        case 'next': show.nextSong(); break;
        case 'prev': show.prevSong(); break;
        case 'auto': if (typeof a0 !== 'boolean' || a0 !== show.state.auto) show.toggleAuto(); break;
        case 'palette': if (num(a0, 0, 99) !== null) show.setPalette(Math.round(a0) - 1); else show.cyclePalette(1); break;
        case 'msg': if (num(a0, 0, 2) !== null) show.toggleMessage(Math.round(a0)); else return false; break;
        case 'tap': show.tap(); break;
        case 'master': if (num(a0, 0, 1) !== null) show.setMaster(a0); else return false; break;
        case 'sens': if (num(a0, -5, 5) !== null) show.setSensitivity(a0); else return false; break;
        case 'strobe': show.setStrobe(!!a0); break;
        case 'test': show.toggleTestPattern(); break;
        default: return false;
      }
      if (app.onAction) app.onAction('net:' + (from || ''));
      return true;
    },

    /** 毎フレーム（音声解析をしているウィンドウ）：状態と特徴量を送る */
    frame(app, f, nowMs) {
      if (!net.ws || net.ws.readyState !== 1 || !f) return;
      net._flags |= f.onsetFlags || 0;
      if (nowMs - net._statusT >= 200) {
        net._statusT = nowMs;
        const s = app.show.state, song = app.show.currentSong();
        const sc = VJ.scenes.byId[s.sceneId];
        net.send({
          t: 'status',
          s: {
            scene: s.sceneId, sceneName: sc ? VJ.sceneName(sc) : s.sceneId, pending: !!s.pending,
            song: song ? `M${s.songIdx + 1} ${song.title}` : s.endState ? VJ.t('（終演）') : VJ.t('（開演前）'),
            bpm: f.bpm && f.beatConf > 0.2 ? f.bpm : 0, speech: !!f.speech,
            auto: !!s.auto, blackout: !!s.blackout, master: s.master, sens: s.sens,
            scenes: VJ.scenes.list.filter((d) => !d.hidden).map((d) => ({ id: d.id, key: d.key.replace('s', '⇧'), name: VJ.sceneName(d) })),
            lang: VJ.i18n.lang,
          },
        });
      }
      const o = app.settings.osc;
      if (o && o.enabled && nowMs - net._featT >= 1000 / Math.max(10, Math.min(60, +o.rate || 30))) {
        net._featT = nowMs;
        net.send({
          t: 'feat',
          f: {
            level: f.level, low: f.low, mid: f.mid, high: f.high, kick: f.kick, snare: f.snare, hat: f.hat, accent: f.accent,
            intensity: f.intensity, bpm: f.bpm || 0, pitch: f.pitch, voiced: f.voiced, speech: !!f.speech,
            flash: app.show.state.flash || 0, scene: app.show.state.sceneId, onsets: net._flags,
          },
        });
        net._flags = 0;
      }
    },

    /** パネル表示用 */
    state() { return { status: net.status, info: net.info, error: net.error || '' }; },
  };

  VJ.net = net;
})(globalThis.VJ = globalThis.VJ || {});
