/* Shift+5: 波 — 重なった波の線。低音で大きくうねり、高音で細かく揺れる
 * （仮の実装） */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'waves', key: 's5', name: 'Waves', nameJa: '波', aliases: ['なみ', '海'], cost: 1,
    frag: `
void main() {
  vec2 p = uvc();
  vec3 col = pal(u_pitch + 0.1 * u_time) * (0.1 + 0.4 * u_level) * smoothstep(0.5, 0.0, length(p));
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
