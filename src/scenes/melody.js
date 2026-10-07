/* Shift+2: メロディ線 — 声や旋律の音程を光の線で描く（カラオケの音程バーのように右から左へ流れる）
 * （仮の実装） */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'melody', key: 's2', name: 'Melody', nameJa: 'メロディ線', aliases: ['メロディ', '音程'], cost: 1,
    frag: `
void main() {
  vec2 p = uvc();
  vec3 col = pal(u_pitch + 0.1 * u_time) * (0.1 + 0.4 * u_level) * smoothstep(0.5, 0.0, length(p));
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
