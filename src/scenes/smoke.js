/* Shift+6: 煙 — 色の煙（インク）が渦を巻いて流れる。発音のたびに色が注がれる
 * （仮の実装） */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'smoke', key: 's6', name: 'Smoke', nameJa: '煙', aliases: ['けむり', 'インク'], cost: 1,
    frag: `
void main() {
  vec2 p = uvc();
  vec3 col = pal(u_pitch + 0.1 * u_time) * (0.1 + 0.4 * u_level) * smoothstep(0.5, 0.0, length(p));
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
