/* Shift+9: 声紋 — 音の高さごとの強さを時間方向に流して模様にする（声・話し声がよく見える）
 * （仮の実装） */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'voiceprint', key: 's9', name: 'Voiceprint', nameJa: '声紋', aliases: ['スペクトログラム', '声のもよう'], cost: 1,
    frag: `
void main() {
  vec2 p = uvc();
  vec3 col = pal(u_pitch + 0.1 * u_time) * (0.1 + 0.4 * u_level) * smoothstep(0.5, 0.0, length(p));
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
