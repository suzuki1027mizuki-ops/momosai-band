/* Shift+4: 光の粒 — ぼけた光の玉がゆっくり漂う。音量で明るさ・大きさ（しっとりした曲・司会向け）
 * （仮の実装） */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'bokeh', key: 's4', name: 'Bokeh', nameJa: '光の粒', aliases: ['ボケ', 'ひかり'], cost: 1,
    frag: `
void main() {
  vec2 p = uvc();
  vec3 col = pal(u_pitch + 0.1 * u_time) * (0.1 + 0.4 * u_level) * smoothstep(0.5, 0.0, length(p));
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
