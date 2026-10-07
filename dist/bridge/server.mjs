// MOMOSAI VJ ブリッジ：ブラウザだけではできない「ネットワーク」の部分を受け持つ小さなサーバー（依存パッケージなし）。
//   - スマホから操作：http://<この PC の IP>:8787 を開くと操作画面（remote.html）。暗証番号（PIN）が必要
//   - OSC 受信（UDP 9000）：/vj/scene 3 などで操作（照明卓・TouchDesigner・Max・QLC+ など）
//   - OSC 送信：音の特徴量（音量・キック・BPM・音程…）を指定の宛先へ 30〜60Hz で送る
//   - Art-Net 送信：照明（DMX）の値を LAN の照明機器へ送る
// VJ 本体（ブラウザで開いた momosai-vj.html、または単体アプリ）は ws://127.0.0.1:8787/vj につなぐ。
// 単体アプリ（app/）には組み込み済み。ブラウザ版で使うときは `node bridge/server.mjs`（Node.js 18 以上）。
import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 1 << 20;

// ------------------------------------------------------------------ OSC（1.0 の基本の型だけ）
const pad4 = (n) => (n + 3) & ~3;
function oscString(s) {
  const b = Buffer.from(String(s), 'utf8');
  const out = Buffer.alloc(pad4(b.length + 1));
  b.copy(out);
  return out;
}

/** OSC メッセージを作る。args は数値（小数 → f、整数 → i）・文字列・真偽値 */
export function oscMessage(address, args = []) {
  let tags = ',';
  const parts = [];
  for (const a of args) {
    if (typeof a === 'string') { tags += 's'; parts.push(oscString(a)); }
    else if (typeof a === 'boolean') tags += a ? 'T' : 'F';
    else if (Number.isInteger(a) && Math.abs(a) < 2 ** 31) { tags += 'i'; const b = Buffer.alloc(4); b.writeInt32BE(a); parts.push(b); }
    else { tags += 'f'; const b = Buffer.alloc(4); b.writeFloatBE(+a || 0); parts.push(b); }
  }
  return Buffer.concat([oscString(address), oscString(tags), ...parts]);
}

/** 複数のメッセージを 1 つのバンドル（即時実行）にまとめる */
export function oscBundle(messages) {
  const head = Buffer.concat([oscString('#bundle'), Buffer.from([0, 0, 0, 0, 0, 0, 0, 1])]);
  const parts = [head];
  for (const m of messages) { const n = Buffer.alloc(4); n.writeInt32BE(m.length); parts.push(n, m); }
  return Buffer.concat(parts);
}

function readOscString(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) throw new Error('bad OSC string');
  return [buf.toString('utf8', off, end), pad4(end + 1)];
}

/** OSC パケット → [{ address, args }]（バンドルは展開） */
export function oscDecode(buf, out = [], depth = 0) {
  if (depth > 4) throw new Error('OSC bundle too deep');
  if (buf.length >= 16 && buf.toString('ascii', 0, 8) === '#bundle\0') {
    let off = 16;
    while (off + 4 <= buf.length) {
      const n = buf.readInt32BE(off);
      off += 4;
      if (n <= 0 || off + n > buf.length) throw new Error('bad OSC bundle');
      oscDecode(buf.subarray(off, off + n), out, depth + 1);
      off += n;
    }
    return out;
  }
  let [address, off] = readOscString(buf, 0);
  if (address[0] !== '/') throw new Error('bad OSC address');
  let tags = ',';
  if (off < buf.length) [tags, off] = readOscString(buf, off);
  const args = [];
  for (const t of tags.slice(1)) {
    if (t === 'i') { args.push(buf.readInt32BE(off)); off += 4; }
    else if (t === 'f') { args.push(buf.readFloatBE(off)); off += 4; }
    else if (t === 'd') { args.push(buf.readDoubleBE(off)); off += 8; }
    else if (t === 'h') { args.push(Number(buf.readBigInt64BE(off))); off += 8; }
    else if (t === 's' || t === 'S') { const [s, o] = readOscString(buf, off); args.push(s); off = o; }
    else if (t === 'T') args.push(true);
    else if (t === 'F') args.push(false);
    else if (t === 'N' || t === 'I') args.push(null);
    else if (t === 'b') { const n = buf.readInt32BE(off); off += 4 + pad4(n); args.push(null); }
    else throw new Error('unsupported OSC type ' + t);
  }
  out.push({ address, args });
  return out;
}

/** OSC の受信 → VJ への操作（ページ側でもう一度型を確かめる） */
export function oscToCommand(msg) {
  const a = msg.address.replace(/\/+$/, '').toLowerCase(), v = msg.args[0];
  const num = (x) => (typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : NaN);
  // ボタンとして送られた 0（離した）は無視する
  const pressed = msg.args.length === 0 || num(v) !== 0;
  switch (a) {
    case '/vj/scene': return v === undefined ? null : { name: 'scene', args: [typeof v === 'number' ? String(Math.round(v)) : String(v)] };
    case '/vj/flash': return pressed ? { name: 'flash', args: [] } : null;
    case '/vj/blackout': return { name: 'blackout', args: msg.args.length ? [num(v) !== 0] : [] };
    case '/vj/next': return pressed ? { name: 'next', args: [] } : null;
    case '/vj/prev': return pressed ? { name: 'prev', args: [] } : null;
    case '/vj/auto': return { name: 'auto', args: msg.args.length ? [num(v) !== 0] : [] };
    case '/vj/palette': return { name: 'palette', args: msg.args.length ? [Math.round(num(v))] : [] };
    case '/vj/msg': return { name: 'msg', args: [Math.round(num(v)) || 0] };
    case '/vj/tap': return pressed ? { name: 'tap', args: [] } : null;
    case '/vj/master': return isFinite(num(v)) ? { name: 'master', args: [num(v)] } : null;
    case '/vj/sens': return isFinite(num(v)) ? { name: 'sens', args: [num(v)] } : null;
    case '/vj/strobe': return { name: 'strobe', args: [num(v) !== 0] };
    case '/vj/test': return pressed ? { name: 'test', args: [] } : null;
    default: return null;
  }
}

/** 特徴量 → OSC バンドル */
export function featuresToOsc(f) {
  const m = [];
  for (const k of ['level', 'low', 'mid', 'high', 'kick', 'snare', 'hat', 'accent', 'intensity', 'bpm', 'pitch', 'voiced', 'flash']) {
    if (typeof f[k] === 'number' && isFinite(f[k])) m.push(oscMessage('/vj/' + k, [toFloat(f[k])]));
  }
  if (typeof f.speech === 'boolean') m.push(oscMessage('/vj/speech', [f.speech ? 1 : 0]));
  if (typeof f.scene === 'string') m.push(oscMessage('/vj/scene/now', [f.scene]));
  const ev = f.onsets | 0;
  if (ev & 1) m.push(oscMessage('/vj/onset/kick', [1]));
  if (ev & 2) m.push(oscMessage('/vj/onset/snare', [1]));
  if (ev & 4) m.push(oscMessage('/vj/onset/hat', [1]));
  if (ev & 8) m.push(oscMessage('/vj/onset/accent', [1]));
  if (ev & 32) m.push(oscMessage('/vj/beat', [1]));
  if (ev & 64) m.push(oscMessage('/vj/downbeat', [1]));
  if (ev & 128) m.push(oscMessage('/vj/onset/note', [1]));
  return m.length ? oscBundle(m) : null;
}
// 整数に見える値でも「小数（f）」で送る（受け側の型を固定するため）
function toFloat(x) { return Number.isInteger(x) ? x + 1e-7 : x; }

// ------------------------------------------------------------------ Art-Net
let artSeq = 0;
/** ArtDmx パケット（universe は 0〜32767 の通し番号） */
export function artDmx(universe, data) {
  const len = Math.max(2, Math.min(512, data.length + (data.length & 1)));
  const b = Buffer.alloc(18 + len);
  b.write('Art-Net\0', 0, 'ascii');
  b.writeUInt16LE(0x5000, 8);
  b.writeUInt16BE(14, 10);
  artSeq = (artSeq % 255) + 1;
  b[12] = artSeq;
  b[13] = 0;
  b[14] = universe & 0xff; // SubUni
  b[15] = (universe >> 8) & 0x7f; // Net
  b.writeUInt16BE(len, 16);
  for (let i = 0; i < Math.min(len, data.length); i++) b[18 + i] = data[i] & 0xff;
  return b;
}

// ------------------------------------------------------------------ WebSocket（RFC 6455 の最小限）
class WsConn {
  constructor(socket, kind, remote) {
    this.socket = socket;
    this.kind = kind;
    this.remote = remote;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.onmessage = null;
    this.onclose = null;
    this.open = true;
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    if (this.onclose) this.onclose();
  }

  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) return this.close(1009); len = Number(big); off = 10; }
      if (len > MAX_MSG) return this.close(1009);
      if (!masked) return this.close(1002); // クライアントからは必ずマスクされる
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) { this._send(0xa, payload); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2) this.frag = { op, parts: [payload] };
      else if (op === 0x0 && this.frag) this.frag.parts.push(payload);
      else continue;
      if (this.frag && this.frag.parts.reduce((a, p) => a + p.length, 0) > MAX_MSG) return this.close(1009);
      if (fin && this.frag) {
        const msg = Buffer.concat(this.frag.parts);
        const text = this.frag.op === 0x1;
        this.frag = null;
        if (text && this.onmessage) {
          let obj = null;
          try { obj = JSON.parse(msg.toString('utf8')); } catch (e) { obj = null; }
          if (obj && typeof obj === 'object') this.onmessage(obj);
        }
      }
    }
  }

  _send(op, payload) {
    if (!this.open) return;
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 0xff]) : Buffer.alloc(10);
    if (n >= 65536) { head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch (e) { this._closed(); }
  }

  send(obj) { this._send(0x1, Buffer.from(JSON.stringify(obj), 'utf8')); }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code);
    this._send(0x8, p);
    try { this.socket.end(); } catch (e) { /* noop */ }
    this._closed();
  }
}

const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

/** この PC の LAN の IPv4 アドレス */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

/**
 * ブリッジを起動する。
 * @param {{port?: number, oscPort?: number|false, host?: string, oscHost?: string, pin?: string, log?: (msg: string) => void}} opts
 *   oscHost：OSC を受ける相手。既定 127.0.0.1（この PC のソフトからだけ）。LAN の照明卓から受けるときは '0.0.0.0'
 *   port / oscPort に 0 を渡すと空いている番号を使う（テスト用）。oscPort: false で OSC 受信なし
 * @returns Promise<{ port, oscPort, pin, urls, close(), stats }>
 */
export async function startBridge(opts = {}) {
  const port = opts.port ?? 8787;
  const oscPort = opts.oscPort ?? 9000;
  const host = opts.host ?? '0.0.0.0';
  const oscHost = opts.oscHost ?? '127.0.0.1';
  const pin = String(opts.pin ?? crypto.randomInt(0, 10000)).padStart(4, '0');
  const log = opts.log || (() => {});
  const remoteHtml = fs.readFileSync(path.join(HERE, 'remote.html'));
  const vjs = new Set(), phones = new Set();
  const stats = { oscIn: 0, oscOut: 0, artnet: 0, cmds: 0, authFail: 0 };
  let lastStatus = null;
  let boundPort = port, boundOsc = oscPort;
  let oscOut = null; // { host, port }
  let art = null; // { host, universe }
  const fails = new Map(); // IP → 失敗回数（総当たり対策）

  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('error', (e) => log('UDP エラー: ' + e.message));
  udp.on('message', (buf) => {
    let msgs;
    try { msgs = oscDecode(buf); } catch (e) { return; }
    for (const m of msgs) {
      const cmd = oscToCommand(m);
      if (!cmd) continue;
      stats.oscIn++;
      for (const v of vjs) v.send({ t: 'cmd', from: 'osc', name: cmd.name, args: cmd.args });
    }
  });
  const out = dgram.createSocket('udp4');
  out.on('error', (e) => log('送信エラー: ' + e.message));
  await new Promise((res) => out.bind(0, () => { try { out.setBroadcast(true); } catch (e) { /* noop */ } res(); }));
  const cleanup = () => { try { udp.close(); } catch (e) { /* noop */ } try { out.close(); } catch (e) { /* noop */ } };
  if (oscPort !== false) {
    try {
      await new Promise((res, rej) => { udp.once('error', rej); udp.bind(oscPort, oscHost, () => { udp.off('error', rej); res(); }); });
    } catch (e) {
      cleanup();
      throw new Error(`OSC の受信ポート ${oscPort} を使えません（ほかのソフトが使っている？）: ${e.message}`);
    }
    boundOsc = udp.address().port;
  }

  const info = () => ({ t: 'info', pin, port: boundPort, oscPort: boundOsc, oscLan: oscHost !== '127.0.0.1', urls: lanAddresses().map((a) => `http://${a}:${boundPort}/`), phones: phones.size });
  const broadcastInfo = () => { for (const v of vjs) v.send(info()); };

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && (url === '/' || url === '/remote.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(remoteHtml);
    } else if (req.method === 'GET' && url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, app: 'momosai-vj-bridge', vj: vjs.size, phones: phones.size }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });

  server.on('upgrade', (req, socket) => {
    const url = (req.url || '').split('?')[0];
    const addr = socket.remoteAddress || '';
    const key = req.headers['sec-websocket-key'];
    const kind = url === '/vj' ? 'vj' : url === '/phone' ? 'phone' : null;
    // VJ 本体は同じ PC からだけ
    if (!kind || !key || (kind === 'vj' && !isLoopback(addr))) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    const ws = new WsConn(socket, kind, addr);
    if (kind === 'vj') {
      vjs.add(ws);
      ws.send(info());
      log('VJ 本体が接続しました');
      ws.onmessage = (m) => {
        if (m.t === 'status' && m.s && typeof m.s === 'object') {
          lastStatus = m.s;
          for (const p of phones) if (p.authed) p.send({ t: 'status', s: m.s });
        } else if (m.t === 'feat' && m.f && oscOut) {
          const b = featuresToOsc(m.f);
          if (b) { out.send(b, oscOut.port, oscOut.host); stats.oscOut++; }
        } else if (m.t === 'dmx' && art && Array.isArray(m.d)) {
          out.send(artDmx(art.universe, m.d), 6454, art.host);
          stats.artnet++;
        } else if (m.t === 'config') {
          const o = m.osc;
          oscOut = o && o.enabled && typeof o.host === 'string' && o.port > 0 && o.port < 65536 ? { host: o.host, port: o.port | 0 } : null;
          const a = m.artnet;
          art = a && a.enabled && typeof a.host === 'string' ? { host: a.host, universe: Math.max(0, Math.min(32767, a.universe | 0)) } : null;
        }
      };
      ws.onclose = () => { vjs.delete(ws); log('VJ 本体が切断しました'); };
    } else {
      phones.add(ws);
      ws.authed = false;
      ws.onmessage = (m) => {
        if (!ws.authed) {
          if (m.t !== 'auth') return;
          if ((fails.get(addr) || 0) >= 10) { ws.send({ t: 'auth', ok: false, locked: true }); ws.close(1008); return; }
          if (String(m.pin) === pin) {
            ws.authed = true;
            ws.send({ t: 'auth', ok: true });
            if (lastStatus) ws.send({ t: 'status', s: lastStatus });
            log(`スマホが接続しました（${addr}）`);
            broadcastInfo();
          } else {
            fails.set(addr, (fails.get(addr) || 0) + 1);
            stats.authFail++;
            ws.send({ t: 'auth', ok: false });
          }
          return;
        }
        if (m.t === 'cmd' && typeof m.name === 'string' && Array.isArray(m.args) && m.args.length <= 4) {
          stats.cmds++;
          if (m.name === 'strobe') ws.strobe = !!m.args[0];
          for (const v of vjs) v.send({ t: 'cmd', from: 'phone', name: m.name, args: m.args });
        }
      };
      ws.onclose = () => {
        phones.delete(ws);
        // 押している途中で切れたら、ストロボを止める
        if (ws.strobe) for (const v of vjs) v.send({ t: 'cmd', from: 'phone', name: 'strobe', args: [false] });
        broadcastInfo();
      };
    }
  });

  try {
    await new Promise((res, rej) => { server.once('error', rej); server.listen(port, host, () => { server.off('error', rej); res(); }); });
  } catch (e) {
    cleanup();
    throw new Error(`ポート ${port} を使えません（ブリッジが二重に起動している？）: ${e.message}`);
  }
  boundPort = server.address().port;
  return {
    port: boundPort, oscPort: boundOsc, pin, stats,
    get urls() { return info().urls; },
    close() {
      for (const c of [...vjs, ...phones]) c.close(1001);
      server.close();
      try { udp.close(); } catch (e) { /* noop */ }
      try { out.close(); } catch (e) { /* noop */ }
    },
  };
}

// 直接実行されたとき：node bridge/server.mjs [--port 8787] [--osc 9000] [--pin 1234] [--osc-lan]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
  const oscLan = process.argv.includes('--osc-lan');
  const b = await startBridge({ port: +arg('--port', 8787), oscPort: +arg('--osc', 9000), pin: arg('--pin'), oscHost: oscLan ? '0.0.0.0' : '127.0.0.1', log: (m) => console.log(m) });
  console.log('MOMOSAI VJ ブリッジを起動しました');
  console.log(`  VJ 本体の設定パネル ⑦ で「ブリッジにつなぐ」を押してください（ws://127.0.0.1:${b.port}/vj）`);
  console.log(`  スマホで開く: ${b.urls.join('  ') || '(LAN に接続されていません)'}   暗証番号: ${b.pin}`);
  console.log(`  OSC 受信ポート: ${b.oscPort}（例: /vj/scene 3, /vj/flash, /vj/blackout 1）${oscLan ? '  LAN から受け付けます' : '  この PC からだけ（LAN の照明卓から受けるときは --osc-lan を付けて起動）'}`);
  console.log('  終了するにはこのウィンドウを閉じるか Ctrl+C');
}
