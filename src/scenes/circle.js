/* Shift+7: サークル — 円形のスペクトラム。周波数ごとの棒が円周に並ぶ（DJ・ダンス向け）
 * （仮の実装） */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'circle', key: 's7', name: 'Circle', nameJa: 'サークル', aliases: ['円', 'スペクトラム'], cost: 1,
    frag: `
void main() {
  vec2 p = uvc();
  vec3 col = pal(u_pitch + 0.1 * u_time) * (0.1 + 0.4 * u_level) * smoothstep(0.5, 0.0, length(p));
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
