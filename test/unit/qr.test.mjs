// QR コードエンコーダ（bridge/qr.mjs）：作った QR を jsQR で読み取って、元の文字列に戻るかを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { qrMatrix, qrSvg, qrTerminal } from '../../bridge/qr.mjs';

// 行列を RGBA 画像にして（周りに quiet 個の白い余白、1 モジュール px ピクセル）jsQR で読む。白地に黒だけを試す
function decode(modules, { quiet = 4, px = 4 } = {}) {
  const n = modules.length;
  const w = (n + quiet * 2) * px;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules[y][x]) continue;
      for (let dy = 0; dy < px; dy++) {
        for (let dx = 0; dx < px; dx++) {
          const i = (((y + quiet) * px + dy) * w + (x + quiet) * px + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, w, w, { inversionAttempts: 'dontInvert' });
}

function roundTrip(text, opts) {
  const q = qrMatrix(text, opts);
  assert.equal(q.modules.length, q.size);
  assert.ok(q.modules.every((row) => row.length === q.size && row.every((v) => typeof v === 'boolean')));
  const r = decode(q.modules);
  assert.ok(r, `decode failed: v${q.version} ${q.ecc} mask ${q.mask} "${text.slice(0, 40)}"`);
  assert.equal(r.data, text);
  assert.equal(r.version, q.version);
  return q;
}

// バイトモードで入る最大バイト数（ISO/IEC 18004 の表、バージョン 1〜10）
const CAPACITY = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
};
// 決まった種から作る、いろいろなビットが出る ASCII 文字列
function filler(len, seed = 1) {
  let s = '';
  let x = seed;
  for (let i = 0; i < len; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    s += String.fromCharCode(32 + ((x >>> 16) % 95));
  }
  return s;
}

test('QR：短い文字列と URL が読み取れる', () => {
  const q = roundTrip('hello');
  assert.equal(q.version, 1);
  assert.equal(q.size, 21);
  assert.equal(q.ecc, 'M');
  assert.ok(q.mask >= 0 && q.mask <= 7);
  for (const url of ['http://192.168.1.23:8787/#p=0762', 'http://10.0.0.5:8787/', 'http://[fe80::1]:8787/#p=1234']) roundTrip(url);
  assert.equal(qrMatrix('http://192.168.1.23:8787/#p=0762').version, 3);
  roundTrip('');
});

test('QR：UTF-8 の日本語', () => {
  const text = 'スマホで操作 http://x/';
  const q = qrMatrix(text);
  const r = decode(q.modules);
  assert.equal(r.data, text);
  assert.deepEqual(Uint8Array.from(r.binaryData), new TextEncoder().encode(text));
  roundTrip('文化祭バンドステージ 🎸 VJ', { ecc: 'H' });
});

test('QR：バージョン 1〜10 × 誤り訂正 L/M/Q/H（容量ちょうどで読める・1 バイト増えると次のバージョン）', () => {
  for (const ecc of ['L', 'M', 'Q', 'H']) {
    CAPACITY[ecc].forEach((cap, i) => {
      const v = i + 1;
      const q = roundTrip(filler(cap, v * 7 + cap), { ecc });
      assert.equal(q.version, v, `${ecc} ${cap} bytes`);
      assert.equal(q.size, v * 4 + 17);
      assert.equal(q.ecc, ecc);
      assert.equal(qrMatrix(filler(cap + 1), { ecc }).version, v + 1, `${ecc} ${cap + 1} bytes`);
    });
  }
  // 小文字の指定も受け付ける
  assert.equal(qrMatrix('x', { ecc: 'q' }).ecc, 'Q');
});

test('QR：大きいバージョン（型番情報あり）も読める', () => {
  // 容量ちょうど（ISO の表）。jsQR 1.4.0 はバージョン 23 の位置合わせ座標を 78 でなく 74 と持っているので 23 は使わない
  for (const [len, ecc, v] of [[331, 'M', 13], [458, 'L', 14], [482, 'Q', 20], [625, 'H', 27], [1538, 'M', 32], [1273, 'H', 40], [2953, 'L', 40]]) {
    const q = roundTrip(filler(len, len), { ecc });
    assert.equal(q.version, v, `${len} bytes ${ecc}`);
  }
});

test('QR：位置合わせパターンの位置（ISO/IEC 18004 附属書 E の表）', () => {
  const table = { 2: [6, 18], 7: [6, 22, 38], 14: [6, 26, 46, 66], 23: [6, 30, 54, 78, 102], 32: [6, 34, 60, 86, 112, 138], 40: [6, 30, 58, 86, 114, 142, 170] };
  for (const [v, pos] of Object.entries(table)) {
    const cap = CAPACITY.H[v - 1] ?? { 14: 194, 23: 461, 32: 842, 40: 1273 }[v];
    const { version, size, modules: m } = qrMatrix('a'.repeat(cap), { ecc: 'H' });
    assert.equal(version, +v);
    for (const cy of pos) {
      for (const cx of pos) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) assert.equal(m[cy + dy][cx + dx], Math.max(Math.abs(dx), Math.abs(dy)) !== 1, `v${v} (${cx},${cy})`);
        }
      }
    }
  }
});

test('QR：8 種類どのマスクでも読める（mask を指定して固定）', () => {
  const text = 'http://192.168.1.23:8787/#p=0762';
  for (let mask = 0; mask < 8; mask++) assert.equal(roundTrip(text, { mask, ecc: 'Q' }).mask, mask);
  for (let mask = 0; mask < 8; mask++) assert.equal(roundTrip(filler(200), { mask }).mask, mask); // バージョン 9（型番情報あり）
  assert.throws(() => qrMatrix('x', { mask: 8 }), /mask/);
});

test('QR：機能パターン（ファインダー・タイミング・常に黒のモジュール）', () => {
  const { size, modules: m } = qrMatrix('http://10.0.0.5:8787/');
  const finder = (x0, y0) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(m[y0 + y][x0 + x], d !== 2, `finder (${x0 + x},${y0 + y})`);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 0; i < 8; i++) {
    assert.equal(m[7][i], false, 'separator');
    assert.equal(m[i][7], false, 'separator');
  }
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, 'timing row');
    assert.equal(m[i][6], i % 2 === 0, 'timing col');
  }
  assert.equal(m[size - 8][8], true, 'dark module');
});

test('QR：長すぎる文字列・不正な誤り訂正レベルはエラー', () => {
  assert.equal(qrMatrix('a'.repeat(2331)).version, 40);
  assert.throws(() => qrMatrix('a'.repeat(2332)), /too long.*2332 bytes.*2331/);
  assert.throws(() => qrMatrix('a'.repeat(2954), { ecc: 'L' }), /too long/);
  assert.throws(() => qrMatrix('あ'.repeat(500), { ecc: 'H' }), /too long \(1500 bytes/);
  assert.throws(() => qrMatrix('x', { ecc: 'X' }), /error-correction level/);
});

test('QR：SVG（形が正しく、path を戻すと読める）', () => {
  const text = 'http://192.168.1.23:8787/#p=0762';
  const { size, modules } = qrMatrix(text);
  const svg = qrSvg(text);
  const w = size + 8;
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes(`viewBox="0 0 ${w} ${w}"`));
  assert.ok(svg.includes(`width="${w * 8}" height="${w * 8}"`));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.equal(svg.match(/<svg\b/g).length, 1);
  assert.equal(svg.match(/<\/svg>/g).length, 1);
  assert.equal(svg.match(/<(rect|path)\b[^>]*\/>/g).length, 2, 'background rect + one path');
  // path を行列に戻して、元の行列と同じで読めること
  const d = svg.match(/<path d="([^"]*)"/)[1];
  const back = Array.from({ length: size }, () => new Array(size).fill(false));
  for (const [, x, y, len] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < +len; i++) back[y - 4][x - 4 + i] = true;
  }
  assert.deepEqual(back, modules);
  assert.equal(decode(back).data, text);
  // 色・余白・拡大率の指定
  const custom = qrSvg('x', { margin: 2, scale: 3, dark: '#123', light: 'rgb(1,2,3)' });
  assert.ok(custom.includes('viewBox="0 0 25 25"') && custom.includes('width="75"'));
  assert.ok(custom.includes('fill="#123"') && custom.includes('fill="rgb(1,2,3)"'));
  assert.ok(!qrSvg('x', { dark: '"><script>' }).includes('<script>'));
});

test('QR：ターミナル表示（半角ブロック、白い部分を塗る）を戻すと読める', () => {
  const text = 'http://192.168.1.23:8787/#p=0762';
  const { size, modules } = qrMatrix(text);
  for (const margin of [2, 1, 4]) {
    const out = qrTerminal(text, { margin });
    const w = size + margin * 2;
    const lines = out.split('\n');
    assert.equal(lines.length, Math.ceil(w / 2));
    for (const line of lines) {
      assert.equal([...line].length, w);
      assert.match(line, /^[ ▀▄█]+$/);
    }
    // 塗られた半分 = 白。暗い背景のターミナルに出したときの見た目に戻す
    const img = [];
    for (const line of lines) {
      img.push([...line].map((c) => !'▀█'.includes(c)));
      img.push([...line].map((c) => !'▄█'.includes(c)));
    }
    img.length = w; // 奇数行のとき最後の下半分はターミナルの背景
    assert.ok(img.every((row, y) => row.every((dark, x) => {
      const inQr = x >= margin && y >= margin && x < margin + size && y < margin + size;
      return inQr ? dark === modules[y - margin][x - margin] : !dark;
    })));
    assert.equal(decode(img, { quiet: 2 }).data, text);
  }
  assert.ok(qrTerminal('x').split('\n')[0].startsWith('█'.repeat(25)), '余白は白（塗りつぶし）');
  // 白い背景のターミナル向け：黒モジュールのほうを塗る
  const inv = qrTerminal(text, { invert: true }).split('\n');
  assert.equal(inv[0].trim(), '', '余白は塗らない');
  const img = inv.flatMap((line) => [[...line].map((c) => '▀█'.includes(c)), [...line].map((c) => '▄█'.includes(c))]).slice(0, size + 4);
  assert.equal(decode(img, { quiet: 2 }).data, text);
});
