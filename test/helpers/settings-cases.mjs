// 設定の読み込み（storage.js）を書き換えても、結果が変わらないことを確かめるための入力。
// いろいろな設定（壊れた値・境界の値・古い版・手で書き換えたファイル）を、決まった乱数で作る（毎回同じものができる）。

/** 決まった乱数（mulberry32） */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 型・範囲・選択肢の外れ値と、選択肢の正しい値をまぜたもの
const WEIRD = [
  null, true, false, 0, -1, 1, 0.5, 0.29, 0.31, 1.01, 2, 3, 4, 5, 6, 10, 29, 30, 31, -5, -6, 90, 45, 180, 270, 1e9, -1e9, 65535, 65536,
  '', ' ', 'x', '１２', '<script>', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://example.com/a.png',
  'ws://127.0.0.1:8787/vj', ' wss://h:1/vj ', 'http://x', 'auto', 'ja', 'en', 'fr', 'mix', 'left', 'right', 'up',
  'title', 'corner', 'both', 'off', 'tl', 'tr', 'bl', 'br', 'cc', 'band', 'sing', 'speech', 'mic', 'display', 'demo', 'file', 'line',
  'image', 'video', 'capture', 'camera', 'lib', 'web', 'contain', 'cover', 'stretch', 'fill', 'normal', 'add', 'screen', 'multiply',
  'artnet', 'enttec', 'opendmx', 'sacn', 'rgb', 'drgb', 'rgbw', 'drgbw', 'dim', 'rgba', 'fade', 'wipe', 'random', 'glitch', 'spin',
  'edm', 'acoustic', 'rock', 'L1', 'a b', 'k-1', 'x'.repeat(70), 'y'.repeat(300), '#00ff00', '#00FF00', '#zzz', '00ff00',
  [], [1, 2], ['a', 'b', 'c'], [1, 'x', null], {}, { a: 1 },
];

const pickOf = (r, list) => list[Math.floor(r() * list.length)];

/** 設定のうち、値を差し替える場所（入れ子は 'overlay.imageFit' のように） */
function paths(D) {
  const out = [];
  for (const k of Object.keys(D)) {
    const v = D[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && ['output', 'net', 'osc', 'dmx', 'overlay'].includes(k)) {
      for (const kk of Object.keys(v)) out.push([k, kk]);
      out.push([k]);
    } else out.push([k]);
  }
  return out;
}

function setPath(o, p, v) {
  if (p.length === 1) { o[p[0]] = v; return; }
  if (!o[p[0]] || typeof o[p[0]] !== 'object' || Array.isArray(o[p[0]])) o[p[0]] = {};
  o[p[0]][p[1]] = v;
}

/** 正しい型で、範囲の境目あたりの値 */
function nearValid(r, dv) {
  if (typeof dv === 'number') return pickOf(r, [dv, dv + 0.5, dv - 0.5, dv * 2, -dv, dv + 100, Math.round(dv) + 1, 0.2, 0.4, 1.5, -70, -81, -19, 0, 30]);
  if (typeof dv === 'boolean') return !dv;
  if (typeof dv === 'string') return pickOf(r, [dv, dv + ' ', '', 'x', dv.toUpperCase()]);
  return dv;
}

/** 形の自由なもの（一覧・表）の中身 */
function listValue(r, k) {
  const n = Math.floor(r() * 5);
  const arr = (f) => Array.from({ length: n }, f);
  switch (k) {
    case 'bands': return arr(() => (r() < 0.2 ? pickOf(r, WEIRD) : { bandName: pickOf(r, ['A', 'B', 3, '']), setlistText: pickOf(r, ['1. x', null, 'a | 1 | neon']), logo: pickOf(r, ['', 'data:image/png;base64,AA', 'http://x/y.png', 5]), bandPalette: pickOf(r, [-1, 0, 2.6, -9, 'x']), messages: pickOf(r, [['a'], ['a', 2, 'c', 'd'], 'x']), profile: pickOf(r, ['edm', 'auto', 7]) }));
    case 'mediaLib': return arr(() => (r() < 0.2 ? pickOf(r, WEIRD) : { id: pickOf(r, ['L1', 'L2', 'L1', 'a b', '', 'x'.repeat(50)]), name: pickOf(r, ['MV', '', 5, 'ｍｖ']), kind: pickOf(r, ['image', 'video', 'camera', 'web', 'lib']), key: pickOf(r, ['k1', '../x', '', undefined]), cameraId: pickOf(r, ['', 'cam', 5]), mirror: pickOf(r, [true, 0, 'y']), url: 'https://youtu.be/x' }));
    case 'cues': return arr(() => (r() < 0.2 ? pickOf(r, WEIRD) : { name: pickOf(r, ['A', '', 5]), scene: pickOf(r, ['', 'ripple', 'test', 'nope', 3]), palette: pickOf(r, [-1, 0, 2, 99, 1.5]), media: pickOf(r, ['', 'on', 'off', 'L1', 'a b']), ovScene: pickOf(r, ['', 'off', 'orb', 'title', 'nope']) }));
    case 'sceneParams': return Object.fromEntries(arr((_, i) => [pickOf(r, ['orb', 'ripple', 'waves', 'nope']) + i, pickOf(r, [[0.5], [1, 2, 3, 4], [1, 2, 3, 4, 5], [1, 'x'], 'no', []])]));
    case 'midiMap': return Object.fromEntries(arr(() => [pickOf(r, ['n36', 'c7', 'x1', 'n1000', 'c']), pickOf(r, ['flash', 'scene:orb', 5, ''])]));
    case 'autoScenes': return Object.fromEntries(arr(() => [pickOf(r, ['orb', 'ripple', 'x']), pickOf(r, [true, false, 1, 'no'])]));
    case 'panelFold': return Object.fromEntries(arr(() => [pickOf(r, ['1', '3', '7', '0', '10', 'a']), pickOf(r, [true, false, 1])]));
    case 'messages': return arr(() => pickOf(r, ['a', '', 3, null]));
    case 'customPalette': return Array.from({ length: pickOf(r, [4, 4, 3, 5]) }, () => pickOf(r, ['#00ff00', '#zzz', 5, '#ABCDEF']));
    default: return pickOf(r, WEIRD);
  }
}

/** n 通りの設定（JSON にできるオブジェクト）を作る。VJ.defaultSettings を元にする */
export function settingsCases(VJ, n = 200, seed = 20261015) {
  const D = VJ.defaultSettings, r = rng(seed), P = paths(D);
  const LISTS = ['bands', 'mediaLib', 'cues', 'sceneParams', 'midiMap', 'autoScenes', 'panelFold', 'messages', 'customPalette'];
  const out = [{}, JSON.parse(JSON.stringify(D)), { v: 1 }];
  // 古い版：オーバーレイの ON/OFF が 1 つだったころ・YouTube の埋め込みを使っていたころ
  out.push({ overlayOn: false }, { overlayOn: true, ovSceneOn: false });
  out.push({ overlay: { mediaKind: 'web', webUrl: 'https://youtu.be/x' } }, { mediaLib: [{ id: 'Lyt', name: 'MV', kind: 'web', url: 'https://youtu.be/x' }] });
  while (out.length < n) {
    const o = {};
    const m = 1 + Math.floor(r() * 8);
    for (let j = 0; j < m; j++) {
      const roll = r();
      if (roll < 0.25) { const k = pickOf(r, LISTS); o[k] = listValue(r, k); continue; }
      const p = pickOf(r, P);
      const dv = p.length === 1 ? D[p[0]] : D[p[0]][p[1]];
      setPath(o, p, roll < 0.6 ? pickOf(r, WEIRD) : nearValid(r, dv));
    }
    out.push(o);
  }
  return out;
}

/** 既定値と違うところだけを取り出す（入れ子のオブジェクトは項目ごと。配列は丸ごと） */
export function diffFrom(base, v) {
  const out = {};
  for (const k of Object.keys(v)) {
    const b = base[k], x = v[k];
    if (x && typeof x === 'object' && !Array.isArray(x) && b && typeof b === 'object' && !Array.isArray(b)) {
      const d = diffFrom(b, x);
      if (Object.keys(d).length) out[k] = d;
    } else if (JSON.stringify(b) !== JSON.stringify(x)) out[k] = x;
  }
  for (const k of Object.keys(base)) if (!(k in v)) out[k] = '<missing>';
  return out;
}
