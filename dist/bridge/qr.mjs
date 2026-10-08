// QR コードの小さなエンコーダ（ISO/IEC 18004、依存パッケージなし・Node の組み込みモジュールも使わない）。
// スマホでブリッジの操作画面を開けるように、URL を QR にして SVG かターミナルの文字で出す。
//   - バイトモード（UTF-8）だけ。バージョン 1〜40 から入る最小のものを自動で選ぶ
//   - 誤り訂正 L / M / Q / H。8 種類のマスクを標準の減点ルールで比べていちばん低いものを使う
//
//   qrMatrix('http://192.168.1.23:8787/') → { size, version, ecc, mask, modules: boolean[][] }（true = 黒）
//   qrSvg(text, { scale: 8 }) → '<svg …>…</svg>'
//   qrTerminal(text) → 半角ブロック文字の QR（暗い背景のターミナル向け）

const MAX_VERSION = 40;
const ECC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT = { L: 1, M: 0, Q: 3, H: 2 }; // 形式情報に入れる 2 ビット

// バージョンごとの「1 ブロックあたりの誤り訂正コード語数」（index 0 は使わない）
const EC_PER_BLOCK = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // H
];
// バージョンごとの誤り訂正ブロック数
const NUM_BLOCKS = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // H
];

// ------------------------------------------------------------------ GF(256)（原始多項式 0x11d）と Reed–Solomon
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

const generators = new Map();
/** 生成多項式 (x - α^0)(x - α^1)…(x - α^(n-1)) の係数（次数の高い順、先頭は 1） */
function rsGenerator(n) {
  if (generators.has(n)) return generators.get(n);
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  generators.set(n, g);
  return g;
}

/** data(x)·x^n を生成多項式で割った余り = 誤り訂正コード語 n 個 */
function rsRemainder(data, n) {
  const g = rsGenerator(n);
  const r = new Array(n).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    if (f) for (let i = 0; i < n; i++) r[i] ^= gfMul(g[i + 1], f);
  }
  return r;
}

// ------------------------------------------------------------------ 容量
/** 位置合わせパターンの中心座標（行・列とも同じ並び） */
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const pos = [6];
  for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
  return pos;
}

/** 機能パターン（ファインダー・タイミング・位置合わせ・形式／型番情報）を除いた、データを置けるモジュール数 */
function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

const totalCodewords = (ver) => rawDataModules(ver) >> 3;
const dataCodewords = (ver, e) => totalCodewords(ver) - EC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];
const countBits = (ver) => (ver < 10 ? 8 : 16);
const fits = (ver, e, len) => 4 + countBits(ver) + len * 8 <= dataCodewords(ver, e) * 8;

// ------------------------------------------------------------------ データ列
/** バイトモードのビット列 → 終端・パディングまで入れたデータコード語 */
function encodeData(bytes, ver, e) {
  const cap = dataCodewords(ver, e) * 8;
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, countBits(ver));
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap - bits.length)); // 終端パターン
  put(0, (8 - (bits.length % 8)) % 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** ブロックに分けて誤り訂正を付け、データ → 誤り訂正の順に交互に並べる */
function interleave(data, ver, e) {
  const nb = NUM_BLOCKS[e][ver];
  const ec = EC_PER_BLOCK[e][ver];
  const total = totalCodewords(ver);
  const shortLen = Math.floor(total / nb) - ec; // 短いブロックのデータ長（後ろのブロックは 1 長い）
  const numShort = nb - (total % nb);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, (k += shortLen + (i < numShort ? 0 : 1)));
    blocks.push({ d, ec: rsRemainder(d, ec) });
  }
  const out = [];
  for (let i = 0; i <= shortLen; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

// ------------------------------------------------------------------ マスクと減点
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 1 行（または 1 列）の減点：同色 5 個以上の連続（ルール 1）と 1:1:3:1:1 のファインダー似（ルール 3） */
function lineScore(line) {
  const s = line.map((v) => (v ? '1' : '0')).join('');
  let score = 0;
  for (const run of s.match(/0{5,}|1{5,}/g) || []) score += run.length - 2;
  score += (s.match(/(?=10111010000|00001011101)/g) || []).length * 40;
  return score;
}

function penalty(m) {
  const n = m.length;
  let score = 0;
  let dark = 0;
  for (let i = 0; i < n; i++) {
    score += lineScore(m[i]) + lineScore(m.map((row) => row[i]));
    for (let j = 0; j < n; j++) {
      if (m[i][j]) dark++;
      // ルール 2：同色の 2×2
      if (i < n - 1 && j < n - 1 && m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j] && m[i][j] === m[i + 1][j + 1]) score += 3;
    }
  }
  // ルール 4：黒の割合が 50% から 5% ずれるごとに 10 点
  return score + Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
}

// ------------------------------------------------------------------ 行列
/**
 * 文字列を QR コードの行列にする（バイトモード・UTF-8）。
 * @param {string} text
 * @param {{ ecc?: 'L'|'M'|'Q'|'H', mask?: number }} [opts] mask は 0〜7 で固定（省略時は自動）
 * @returns {{ size: number, version: number, ecc: string, mask: number, modules: boolean[][] }}
 */
export function qrMatrix(text, { ecc = 'M', mask } = {}) {
  const level = String(ecc).toUpperCase();
  const e = ECC_INDEX[level];
  if (e === undefined) throw new Error(`QR: unknown error-correction level "${ecc}" (use L, M, Q or H)`);
  if (mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) throw new Error(`QR: mask must be 0-7 (got ${mask})`);
  const bytes = new TextEncoder().encode(String(text));
  let ver = 1;
  while (ver <= MAX_VERSION && !fits(ver, e, bytes.length)) ver++;
  if (ver > MAX_VERSION) {
    const max = Math.floor((dataCodewords(MAX_VERSION, e) * 8 - 4 - countBits(MAX_VERSION)) / 8);
    throw new Error(`QR: text too long (${bytes.length} bytes in UTF-8; at most ${max} bytes fit with error-correction level ${level})`);
  }

  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

  // タイミングパターン → ファインダー（分離帯こみ）→ 位置合わせパターン
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = alignmentPositions(ver);
  const last = al.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue; // ファインダーと重なる角
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // 形式情報（誤り訂正レベル + マスク、BCH(15,5)）。左上と、右上・左下に分けて 2 か所
  const drawFormat = (m) => {
    const data = (ECC_FORMAT[level] << 3) | m;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // 常に黒のモジュール
  };
  drawFormat(0); // まず場所を確保

  // 型番情報（バージョン 7 以上、BCH(18,6)）。右上と左下の 6×3
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // データ + 誤り訂正を右下から 2 列ずつジグザグに置く（余りビットは白のまま）
  const codewords = interleave(encodeData(bytes, ver, e), ver, e);
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // 縦のタイミングパターンを飛ばす
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v++) {
      const y = upward ? size - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (isFn[y][x] || k >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
        k++;
      }
    }
  }

  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFn[y][x] && MASKS[m](x, y)) modules[y][x] = !modules[y][x];
  };
  let best = mask;
  if (best === undefined) {
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const s = penalty(modules);
      if (s < bestScore) { bestScore = s; best = m; }
      applyMask(m); // 元に戻す（XOR なのでもう一度かければよい）
    }
  }
  applyMask(best);
  drawFormat(best);
  return { size, version: ver, ecc: level, mask: best, modules };
}

// ------------------------------------------------------------------ 出力
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * 単体で表示できる SVG 文字列。黒モジュールは横に続くものをまとめて 1 本の <path> にする。
 * margin は周りの白い余白（モジュール数、規格では 4）、scale は 1 モジュールの px。
 */
export function qrSvg(text, { ecc = 'M', margin = 4, scale = 8, dark = '#000', light = '#fff' } = {}) {
  const { size, modules } = qrMatrix(text, { ecc });
  const mg = Math.max(0, Math.floor(margin) || 0);
  const w = size + mg * 2;
  let d = '';
  modules.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue;
      let end = x;
      while (end < size && row[end]) end++;
      d += `M${x + mg} ${y + mg}h${end - x}v1h${x - end}z`;
      x = end;
    }
  });
  const px = w * (scale > 0 ? scale : 8);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w}" width="${px}" height="${px}" shape-rendering="crispEdges">`
    + `<rect width="${w}" height="${w}" fill="${attr(light)}"/><path d="${d}" fill="${attr(dark)}"/></svg>`;
}

/**
 * ターミナルに出すための文字列（半角ブロック ▀ ▄ █ と空白、1 文字に上下 2 モジュール）。
 * 暗い背景のターミナルを想定して、白モジュールと余白のほうを塗りつぶす（カメラには白地に黒に見える）。
 * 白い背景のターミナル（macOS のターミナルの標準など）では invert: true で黒モジュールを塗る。
 */
export function qrTerminal(text, { ecc = 'M', margin = 2, invert = false } = {}) {
  const { size, modules } = qrMatrix(text, { ecc });
  const mg = Math.max(0, Math.floor(margin) || 0);
  const w = size + mg * 2;
  // 塗るかどうか。行列の外（余白）は白、最後の行の下半分（w 行目）はターミナルの背景のまま
  const fill = (x, y) => y < w && (invert ? modules[y - mg]?.[x - mg] === true : !modules[y - mg]?.[x - mg]);
  const lines = [];
  for (let y = 0; y < w; y += 2) {
    let s = '';
    for (let x = 0; x < w; x++) s += ' ▄▀█'[(fill(x, y) ? 2 : 0) + (fill(x, y + 1) ? 1 : 0)];
    lines.push(s);
  }
  return lines.join('\n');
}
