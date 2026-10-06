/* 色パレット（4 色）。黒背景に映える高彩度を中心に。 */
(function (VJ) {
  'use strict';
  VJ.palettes = [
    { id: 'neon', name: 'ネオン', colors: ['#00F0FF', '#FF00C8', '#7A00FF', '#FFFFFF'] },
    { id: 'sunset', name: 'サンセット', colors: ['#FF6B35', '#FF2E63', '#7B2CBF', '#FFD23F'] },
    { id: 'ocean', name: 'オーシャン', colors: ['#1E96FC', '#00F5D4', '#0A2463', '#E0FBFC'] },
    { id: 'fire', name: 'ファイア', colors: ['#FF4800', '#FF9500', '#8A1C00', '#FFD000'] },
    { id: 'acid', name: 'アシッド', colors: ['#39FF14', '#00FFA3', '#0B3D2E', '#D4FF00'] },
    { id: 'mono', name: 'モノクロ', colors: ['#FFFFFF', '#B8B8B8', '#3A3A3A', '#E8E8E8'] },
    { id: 'sakura', name: 'さくら', colors: ['#FF77A9', '#FFB7C5', '#6A3FA0', '#FFF0F5'] },
    { id: 'custom', name: 'カスタム', colors: null },
  ];

  VJ.paletteColors = function (idx, custom) {
    const p = VJ.palettes[((idx % VJ.palettes.length) + VJ.palettes.length) % VJ.palettes.length];
    return p.colors || custom || VJ.palettes[0].colors;
  };

  VJ.paletteFloat = function (colors, out) {
    out = out || new Float32Array(12);
    for (let i = 0; i < 4; i++) {
      const c = VJ.util.hexToRgb(colors[i]);
      out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
    }
    return out;
  };

  VJ.resolvePalette = function (token) {
    const t = String(token || '').trim().toLowerCase();
    if (!t) return null;
    const n = parseInt(t, 10);
    if (String(n) === t && n >= 1 && n <= VJ.palettes.length) return n - 1;
    const i = VJ.palettes.findIndex((p) => p.id === t || p.name === token.trim());
    return i >= 0 ? i : null;
  };
})(globalThis.VJ = globalThis.VJ || {});
