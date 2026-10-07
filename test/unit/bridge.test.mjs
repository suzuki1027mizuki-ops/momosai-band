// ブリッジ（スマホ操作・OSC・Art-Net）と、VJ 側の受け口（net.js）・照明（dmx.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { startBridge, oscMessage, oscBundle, oscDecode, oscToCommand, artDmx, featuresToOsc, lanAddresses } from '../../bridge/server.mjs';
import { loadVJ } from '../helpers/load-src.mjs';

const VJ = loadVJ([...['src/core/', 'src/dsp/', 'src/audio/synth.js', 'src/audio/voicesynth.js', 'src/show/', 'src/scenes/', 'src/ui/midi.js', 'src/ui/keys.js'], 'src/io/']);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// 受け取ったメッセージは接続した瞬間からためておく（開いた直後に届く info を取りこぼさないように）
function nextMessage(ws, pred = () => true, ms = 3000) {
  return new Promise((resolve, reject) => {
    const take = () => {
      const i = ws.q.findIndex(pred);
      if (i < 0) return false;
      const [m] = ws.q.splice(i, 1);
      clearTimeout(t);
      ws.waiters.delete(take);
      resolve(m);
      return true;
    };
    const t = setTimeout(() => { ws.waiters.delete(take); reject(new Error('timeout')); }, ms);
    if (!take()) ws.waiters.add(take);
  });
}
const open = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.q = [];
  ws.waiters = new Set();
  ws.addEventListener('message', (e) => { ws.q.push(JSON.parse(e.data)); for (const w of [...ws.waiters]) if (w()) break; });
  ws.onopen = () => resolve(ws);
  ws.onerror = () => reject(new Error('ws error ' + url));
});

test('OSC：メッセージ・バンドルの作成と読み取り、操作への変換', () => {
  const m = oscMessage('/vj/scene', [3]);
  assert.equal(m.length % 4, 0);
  assert.deepEqual(oscDecode(m), [{ address: '/vj/scene', args: [3] }]);
  const b = oscBundle([oscMessage('/vj/master', [0.5]), oscMessage('/vj/scene', ['orb']), oscMessage('/vj/flash')]);
  const d = oscDecode(b);
  assert.equal(d.length, 3);
  assert.equal(d[0].args[0], 0.5);
  assert.equal(d[1].args[0], 'orb');
  assert.deepEqual(oscToCommand(d[1]), { name: 'scene', args: ['orb'] });
  assert.deepEqual(oscToCommand({ address: '/vj/scene', args: [3] }), { name: 'scene', args: ['3'] });
  assert.deepEqual(oscToCommand({ address: '/vj/flash', args: [] }), { name: 'flash', args: [] });
  assert.equal(oscToCommand({ address: '/vj/flash', args: [0] }), null, 'ボタンを離した 0 は無視');
  assert.deepEqual(oscToCommand({ address: '/VJ/Blackout/', args: [1] }), { name: 'blackout', args: [true] });
  assert.deepEqual(oscToCommand({ address: '/vj/master', args: [0.7] }), { name: 'master', args: [0.7] });
  assert.equal(oscToCommand({ address: '/other', args: [] }), null);
  assert.throws(() => oscDecode(Buffer.from('garbage')));
  // 特徴量 → バンドル
  const f = oscDecode(featuresToOsc({ level: 0.5, kick: 1, bpm: 120, speech: true, scene: 'orb', onsets: 1 | 32 }));
  const addr = f.map((x) => x.address);
  for (const a of ['/vj/level', '/vj/kick', '/vj/bpm', '/vj/speech', '/vj/scene/now', '/vj/onset/kick', '/vj/beat']) assert.ok(addr.includes(a), a);
  assert.ok(Math.abs(f.find((x) => x.address === '/vj/bpm').args[0] - 120) < 1e-3);
});

test('Art-Net：ArtDmx パケットの形', () => {
  const data = new Uint8Array(7).map((_, i) => i + 1);
  const p = artDmx(258, data);
  assert.equal(p.toString('ascii', 0, 8), 'Art-Net\0');
  assert.equal(p.readUInt16LE(8), 0x5000);
  assert.equal(p.readUInt16BE(10), 14);
  assert.equal(p[14], 2); // SubUni（下位 8 ビット）
  assert.equal(p[15], 1); // Net
  assert.equal(p.readUInt16BE(16), 8); // 長さは偶数
  assert.deepEqual([...p.subarray(18, 25)], [1, 2, 3, 4, 5, 6, 7]);
});

test('ブリッジ：スマホは暗証番号でつながり、操作が VJ に届き、状態がスマホに届く。OSC 受信・送信と Art-Net も', async () => {
  const b = await startBridge({ port: 0, oscPort: 0, pin: '4321', host: '0.0.0.0' });
  try {
    // 操作画面の HTML
    const html = await (await fetch(`http://127.0.0.1:${b.port}/`)).text();
    assert.match(html, /MOMOSAI VJ リモコン/);
    assert.equal((await fetch(`http://127.0.0.1:${b.port}/../../etc/passwd`)).status, 404);

    const vjInfo = open(`ws://127.0.0.1:${b.port}/vj`).then(async (vj) => ({ vj, info: await nextMessage(vj, (m) => m.t === 'info') }));
    const { vj, info } = await vjInfo;
    assert.equal(info.pin, '4321');
    assert.equal(info.oscPort, b.oscPort);

    // 間違った暗証番号 → 操作できない
    const ph = await open(`ws://127.0.0.1:${b.port}/phone`);
    ph.send(JSON.stringify({ t: 'auth', pin: '0000' }));
    assert.equal((await nextMessage(ph, (m) => m.t === 'auth')).ok, false);
    ph.send(JSON.stringify({ t: 'cmd', name: 'flash', args: [] }));
    await assert.rejects(nextMessage(vj, (m) => m.t === 'cmd', 300));
    // 正しい暗証番号
    ph.send(JSON.stringify({ t: 'auth', pin: '4321' }));
    assert.equal((await nextMessage(ph, (m) => m.t === 'auth')).ok, true);
    const got = nextMessage(vj, (m) => m.t === 'cmd');
    ph.send(JSON.stringify({ t: 'cmd', name: 'scene', args: ['orb'] }));
    assert.deepEqual(await got, { t: 'cmd', from: 'phone', name: 'scene', args: ['orb'] });
    const st = nextMessage(ph, (m) => m.t === 'status');
    vj.send(JSON.stringify({ t: 'status', s: { scene: 'orb', auto: true } }));
    assert.equal((await st).s.scene, 'orb');

    // OSC 受信
    const udp = dgram.createSocket('udp4');
    const oscCmd = nextMessage(vj, (m) => m.t === 'cmd' && m.from === 'osc');
    udp.send(oscMessage('/vj/blackout', [1]), b.oscPort, '127.0.0.1');
    assert.deepEqual((await oscCmd).args, [true]);

    // OSC 送信（特徴量）と Art-Net（照明）
    const rx = dgram.createSocket('udp4');
    await new Promise((r) => rx.bind(0, '127.0.0.1', r));
    const art = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let artOk = true;
    await new Promise((r) => { art.once('error', () => { artOk = false; r(); }); art.bind(6454, '127.0.0.1', r); });
    vj.send(JSON.stringify({ t: 'config', osc: { enabled: true, host: '127.0.0.1', port: rx.address().port }, artnet: { enabled: artOk, host: '127.0.0.1', universe: 1 } }));
    await wait(100);
    const oscGot = new Promise((r) => rx.once('message', (m) => r(oscDecode(m))));
    vj.send(JSON.stringify({ t: 'feat', f: { level: 0.25, kick: 0.9, onsets: 1 } }));
    const msgs = await oscGot;
    assert.ok(msgs.find((m) => m.address === '/vj/level' && Math.abs(m.args[0] - 0.25) < 1e-3));
    assert.ok(msgs.find((m) => m.address === '/vj/onset/kick'));
    if (artOk) {
      const artGot = new Promise((r) => art.once('message', r));
      vj.send(JSON.stringify({ t: 'dmx', d: [10, 20, 30] }));
      const p = await artGot;
      assert.equal(p.toString('ascii', 0, 8), 'Art-Net\0');
      assert.equal(p[14], 1);
      assert.deepEqual([...p.subarray(18, 21)], [10, 20, 30]);
    }
    udp.close(); rx.close(); art.close();

    // VJ 本体の口は、同じ PC（127.0.0.1）からだけ
    const lan = lanAddresses()[0];
    if (lan) {
      await assert.rejects(open(`ws://${lan}:${b.port}/vj`));
    }
    // 総当たり：同じ IP から 10 回失敗すると、正しい番号でもつながらない（上で 1 回失敗済み）
    const ph2 = await open(`ws://127.0.0.1:${b.port}/phone`);
    let tries = 0, res;
    do {
      ph2.send(JSON.stringify({ t: 'auth', pin: String(1000 + tries) }));
      res = await nextMessage(ph2, (m) => m.t === 'auth');
      tries++;
    } while (!res.locked && tries < 20);
    assert.equal(tries, 10);
    const ph3 = await open(`ws://127.0.0.1:${b.port}/phone`);
    ph3.send(JSON.stringify({ t: 'auth', pin: '4321' }));
    const locked = await nextMessage(ph3, (m) => m.t === 'auth');
    assert.equal(locked.ok, false);
    assert.equal(locked.locked, true);
    vj.close(); ph.close();
  } finally {
    b.close();
  }
});

test('VJ 側：スマホ・OSC の操作は決まったものだけ・型を確かめて実行する', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, setlistText: 'A | 2\nB | 3' });
  const show = new VJ.ShowController(s);
  show.update({ active: true, silenceSec: 0, onsetFlags: 0, kick: 0, snare: 0, hat: 0, accent: 0, level: 0.5, intensity: 0.5, kickN: 0, snareN: 0, kickEv: new Float32Array(16), snareEv: new Float32Array(16), accentEv: new Float32Array(16) }, 1 / 60, 1);
  const app = { show, settings: s, ui: { toast() {} } };
  VJ.net.app = app;
  assert.equal(VJ.net.exec('scene', ['s1']), true);
  assert.equal(show.state.sceneId, 'orb');
  assert.equal(VJ.net.exec('scene', ['3']), true);
  assert.equal(show.state.sceneId, 'horizon');
  assert.equal(VJ.net.exec('scene', ['nope']), false);
  assert.equal(VJ.net.exec('scene', [{ evil: 1 }]), false);
  VJ.net.exec('next', []);
  assert.equal(show.currentSong().title, 'A');
  VJ.net.exec('blackout', [true]);
  assert.equal(show.state.blackout, true);
  VJ.net.exec('blackout', []);
  assert.equal(show.state.blackout, false);
  VJ.net.exec('master', [0.5]);
  assert.equal(show.state.master, 0.5);
  assert.equal(VJ.net.exec('master', ['x']), false);
  VJ.net.exec('auto', [true]);
  assert.equal(show.state.auto, true);
  VJ.net.exec('auto', [true]);
  assert.equal(show.state.auto, true, 'ON を送っても OFF にならない');
  VJ.net.exec('palette', [3]);
  assert.equal(show.state.paletteIdx, 2, 'OSC のパレット番号は 1 から');
  assert.equal(VJ.net.exec('restoreSession', [{}]), false, '一覧にない操作は実行しない');
  assert.equal(VJ.net.exec('__proto__', []), false);
  show.lock();
  assert.equal(VJ.net.exec('scene', ['1']), false, 'ロック中は暗転だけ');
  assert.equal(VJ.net.exec('blackout', []), true);
});

test('照明（DMX）：パレットの色・音量・キックのチェイス・暗転・フラッシュ、Enttec のパケット', () => {
  const s = Object.assign({}, VJ.defaultSettings, { paletteIdx: 0 });
  const show = new VJ.ShowController(s);
  const c = VJ.dmx.config({ dmx: { enabled: true, type: 'drgb', count: 4, start: 10, max: 1, pulse: 0.5, flash: true } });
  const f = { active: true, level: 0.5, kickN: 0, onsetFlags: 0 };
  const out = new Uint8Array(512);
  VJ.dmx.compute(show, f, c, 0, out);
  assert.equal(out[8], 0, '先頭の番地より前は 0');
  assert.ok(out[9] > 0, '調光');
  const pal = show.palFloat;
  assert.equal(out[10], Math.round(pal[0] * 255));
  assert.equal(out[14], Math.round(pal[3] * 255), '2 台目はパレットの 2 色目');
  assert.equal(out[9 + 16], 0, '4 台のあとは 0');
  // キックで 1 台が強く光る。1 秒に 3 回まで
  const dims = () => [0, 1, 2, 3].map((i) => out[9 + i * 4]);
  const base = dims();
  let n = 0;
  for (let k = 1; k <= 10; k++) {
    VJ.dmx.compute(show, Object.assign({}, f, { kickN: k, onsetFlags: 1 }), c, k * 0.1, out);
    if (Math.max(...dims()) > Math.max(...base) + 20) n++;
  }
  assert.ok(VJ.dmx._pulseAt <= 1.0 && VJ.dmx._pulseAt >= 0.6, 'last pulse ' + VJ.dmx._pulseAt);
  // 暗転
  show.state.black = 1;
  VJ.dmx.compute(show, f, c, 5, out);
  assert.ok(out.every((v, i) => i % 4 !== 1 || i < 9 || i > 24 || v === 0) && out[9] === 0 && out[13] === 0);
  show.state.black = 0;
  // フラッシュで白
  show.state.flash = 1;
  const rgb = VJ.dmx.config({ dmx: { type: 'rgb', count: 1, start: 1, flash: true } });
  VJ.dmx.compute(show, f, rgb, 6, out);
  assert.deepEqual([out[0], out[1], out[2]], [255, 255, 255]);
  // Enttec DMX USB Pro
  const p = VJ.dmx.enttecPacket(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...p], [0x7e, 6, 4, 0, 0, 1, 2, 3, 0xe7]);
  // 512 ch を超える灯体は出さない
  const big = VJ.dmx.config({ dmx: { type: 'drgbw', count: 128, start: 500 } });
  VJ.dmx.compute(show, f, big, 7, out);
  assert.equal(out.length, 512);
});
