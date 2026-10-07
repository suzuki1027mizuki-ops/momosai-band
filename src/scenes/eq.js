/* 7: イコライザー — 中央から左右対称に伸びる LED 風のスペクトラムバー（上下にも鏡映）。
 * 低音が中央、高音が外側。本体はゆっくり下がる値（ちらつき防止）、細いキャップは速い値。
 * キックでバー全体がわずかに弾む。拍で中央線が光る。EDM・ダンス・DJ・何にでも。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'eq', key: '7', name: 'Equalizer', nameJa: 'イコライザー', aliases: ['イコライザー', 'スペクトラム', 'eq'], cost: 1,
    params: [{ id: 'bars', name: 'バーの本数', min: 0.5, max: 1.5, def: 1 }, { id: 'height', name: '高さ', min: 0.5, max: 1.15, def: 1 }],
    frag: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float A = u_res.x / u_res.y;
  float nb = floor(clamp(A * 18.0, 16.0, 40.0) * u_param.x);   // 片側のバーの本数（画面の縦横比に合わせる）
  float x = abs(uv.x - 0.5) * 2.0;                  // 0 = 中央（低音）→ 1 = 端（高音）
  float bi = floor(x * nb);
  float fx = fract(x * nb);
  float t = (bi + 0.5) / nb;
  float y = abs(uv.y - 0.5) * 2.0;                  // 中央線からの距離 0..1
  float body = specS(t * 0.92) * (0.88 + 0.08 * u_kick);
  float cap = spec(t * 0.92);
  float H = body * 0.86 * u_param.y + 0.02;
  float gap = step(0.14, fx) * step(fx, 0.86);
  float seg = step(0.3, fract(y * 26.0));            // LED のすき間
  vec3 c = pal(t * 0.75 + 0.1);
  vec3 col = vec3(0.004, 0.004, 0.012) + u_pal[2] * 0.04 * (1.0 - y);
  float on = gap * seg * step(y, H);
  col += c * on * (0.35 + 0.55 * (y / max(H, 0.05)));
  // キャップ（速い値の位置に細い線）
  float capY = cap * 0.86 * u_param.y + 0.03;
  float capLine = gap * smoothstep(0.012, 0.0, abs(y - capY));
  col += mix(c, vec3(1.0), 0.5) * capLine * 0.8;
  // 中央線（拍で少し光る）
  col += c * smoothstep(0.012, 0.0, y) * (0.25 + 0.35 * u_beat + 0.1 * idle());
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
