/* 0: タイトル — 中央にバンド名（終演時は終わりの文字）。開演前・MC・転換・終演用。
 * キックで文字がわずかに拡大、ハイハットで縁に色収差、音量で光のにじみ。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'title', key: '0', name: 'Title', nameJa: 'タイトル', aliases: ['タイトル', 'バンド名'], cost: 1,
    params: [{ id: 'size', name: '文字の大きさ', min: 0.6, max: 1.3, def: 1 }, { id: 'bg', name: '背景の明るさ', min: 0, max: 2.5, def: 1 }],
    frag: `
vec4 txt(vec2 uv) {
  vec2 t = (uv - u_titleRect.xy) / u_titleRect.zw;
  float inside = step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0);
  return texture(u_title, t) * inside;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uvc();
  float tt = u_time * 0.05;
  float n = vnoise(p * 1.8 + tt);
  vec3 bg = mix(u_pal[2], u_pal[0], 0.5 + 0.5 * sin(p.x * 1.4 + tt * 3.0 + n * 2.5));
  bg *= (0.08 + 0.05 * vnoise(p * 3.0 - tt * 2.0)) * (0.8 + 0.25 * u_level) * u_param.y;

  float s = (1.0 + 0.03 * u_kick + 0.012 * idle()) * u_param.x;
  vec2 tu = (uv - 0.5) / s + 0.5;
  vec4 tx = txt(tu);
  float ca = 0.0035 * u_hat;
  float ar = txt(tu + vec2(ca, 0.0)).a, ab = txt(tu - vec2(ca, 0.0)).a;
  // にじみ（ミップマップの粗い段＝ぼかし）
  vec2 tg = (tu - u_titleRect.xy) / u_titleRect.zw;
  float glow = texture(u_title, tg, 4.5).a;
  vec3 col = bg + pal(0.15 + tt * 0.2) * glow * (0.25 + 0.45 * u_level + 0.2 * idle());
  vec3 tc = tx.rgb * mix(vec3(1.0), pal(tt), 0.12);
  col = mix(col, tc, tx.a);
  col.r = mix(col.r, 1.0, max(ar - tx.a, 0.0) * 0.8);
  col.b = mix(col.b, 1.0, max(ab - tx.a, 0.0) * 0.8);
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
