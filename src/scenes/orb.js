/* Shift+1: 声の輪 — 声に合わせて光る輪。輪の大きさは音量、色は声の高さ、音節ごとに波紋。中央にタイトル（司会・MC 向け）
 * （仮の実装） */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'orb', key: 's1', name: 'Voice Orb', nameJa: '声の輪', aliases: ['声', 'こえ', 'ボイス'], cost: 1,
    frag: `
void main() {
  vec2 p = uvc();
  vec3 col = pal(u_pitch + 0.1 * u_time) * (0.1 + 0.4 * u_level) * smoothstep(0.5, 0.0, length(p));
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
