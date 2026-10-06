/* テストパターン（G キー）— プロジェクターの位置・台形・明るさを合わせるための図形。
 * 格子・中心の十字・正円（縦横比の確認）・外枠・四隅の印・明るさの段階。音には反応しない。
 * オートやセットリストでは使わない（hidden）。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'test', key: 'g', name: 'Test pattern', nameJa: 'テストパターン', aliases: ['テストパターン', 'test'], cost: 1, hidden: true,
    frag: `
float lineAA(float d, float w) { return 1.0 - smoothstep(w, w + 1.0, d); }
void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / u_res;
  vec2 p = uvc();
  vec3 col = vec3(0.02);
  // 格子（高さの 1/8 ごと）
  float cell = u_res.y / 8.0;
  vec2 g = abs(mod(px - u_res * 0.5 + cell * 0.5, cell) - cell * 0.5);
  col = mix(col, vec3(0.35), lineAA(min(g.x, g.y), 0.5));
  // 外枠と中心の十字
  vec2 e = min(px, u_res - px);
  col = mix(col, u_pal[0], lineAA(min(e.x, e.y), 2.0));
  vec2 cc = abs(px - u_res * 0.5);
  col = mix(col, vec3(1.0), lineAA(min(cc.x, cc.y), 1.0) * step(max(cc.x, cc.y), u_res.y * 0.08));
  // 正円（つぶれて見えたら縦横比がずれている）
  col = mix(col, u_pal[1], lineAA(abs(length(p) - 0.4) * u_res.y, 1.5));
  // 四隅の L 字
  vec2 k = min(px, u_res - px);
  float corner = step(k.x, u_res.y * 0.08) * step(k.y, u_res.y * 0.08) * step(min(k.x, k.y), 6.0);
  col = mix(col, vec3(1.0, 0.85, 0.2), corner);
  // 明るさの段階（下部）：10 段
  if (uv.y > 0.08 && uv.y < 0.14 && uv.x > 0.2 && uv.x < 0.8) col = vec3(floor((uv.x - 0.2) / 0.6 * 10.0) / 9.0);
  // パレット（上部）
  if (uv.y > 0.86 && uv.y < 0.92 && uv.x > 0.3 && uv.x < 0.7) col = u_pal[int(clamp(floor((uv.x - 0.3) / 0.1), 0.0, 3.0))];
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
