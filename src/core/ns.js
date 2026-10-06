/* MOMOSAI VJ — 名前空間と小さなユーティリティ。
 * すべてのファイルは classic script（file:// で動かすため ES Modules は使わない）。
 * DOM に触れないファイルは Node のテストからも読み込める。 */
(function (VJ) {
  'use strict';

  VJ.version = '__VJ_VERSION__';
  VJ.buildTime = '__VJ_BUILD_TIME__';

  const LN10_20 = Math.LN10 / 20;

  const util = {
    clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; },
    clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; },
    lerp(a, b, t) { return a + (b - a) * t; },
    smoothstep(e0, e1, x) {
      const t = util.clamp01((x - e0) / (e1 - e0));
      return t * t * (3 - 2 * t);
    },
    dbToLin(db) { return Math.exp(db * LN10_20); },
    linToDb(x) { return 20 * Math.log10(x + 1e-12); },
    powToDb(p) { return 10 * Math.log10(p + 1e-12); },
    /** 時定数 tau 秒の 1 次 IIR 係数（dt 秒ごとに更新する場合） */
    coef(tau, dt) { return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau); },
    /** 指数減衰の倍率 */
    decay(tau, dt) { return tau <= 0 ? 0 : Math.exp(-dt / tau); },
    /** 決定的な疑似乱数（シェーダの hash11 と同じ考え方の整数ハッシュ） */
    hash(n) {
      let x = (n | 0) ^ 0x9e3779b9;
      x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
      x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
      x ^= x >>> 16;
      return (x >>> 0) / 4294967296;
    },
    /** シード付き PRNG（mulberry32） */
    rng(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    hexToRgb(hex) {
      const h = String(hex).replace('#', '').trim();
      const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
      if (!isFinite(v)) return [1, 1, 1];
      return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    },
    rgbToHex(rgb) {
      return '#' + rgb.map((c) => Math.round(util.clamp01(c) * 255).toString(16).padStart(2, '0')).join('');
    },
    /** sRGB(0..1) → 相対輝度（WCAG 定義） */
    relLuminance(r, g, b) {
      const f = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    },
    rgbToHsv(r, g, b) {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d > 0) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
        if (h < 0) h += 1;
      }
      return [h, mx === 0 ? 0 : d / mx, mx];
    },
  };

  VJ.util = util;

  /** 起動時の URL パラメータ（file:// でもクエリは取れる。念のため #hash も見る） */
  VJ.params = (function () {
    const out = {};
    if (typeof location === 'undefined') return out;
    const parse = (s) => {
      s.replace(/^[?#]/, '').split('&').forEach((kv) => {
        if (!kv) return;
        const i = kv.indexOf('=');
        const k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
        const v = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1));
        out[k] = v;
      });
    };
    try { parse(location.search || ''); parse(location.hash || ''); } catch (e) { /* noop */ }
    return out;
  })();
})(globalThis.VJ = globalThis.VJ || {});
