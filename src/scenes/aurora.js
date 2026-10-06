/* 4: オーロラ — 多重に歪ませたノイズのゆらめき。低域でうねり、中域で流れの速さ。
 * 暗い部分を多めに残す。バラード・イントロ・アウトロ向け。品質（u_quality）で負荷を調整。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'aurora', key: '4', name: 'Aurora', nameJa: 'オーロラ', aliases: ['オーロラ'], cost: 4,
    init(st) { st.flow = 0; st.low = 0; st.lvl = 0; },
    update(st, f, dt) {
      // 光過敏対策：明るさや模様の歪みはビートごとに跳ねないよう、ゆっくり追従させた値を使う
      const k = Math.min(1, dt / 0.4);
      st.low += (f.low - st.low) * k;
      st.lvl += (f.level - st.lvl) * k;
      st.flow += (0.04 + 0.22 * f.mid + 0.05 * st.lvl) * dt;
      return { u_flow: st.flow, u_lowS: st.low, u_lvlS: st.lvl };
    },
    frag: `
uniform float u_flow, u_lowS, u_lvlS;
void main() {
  vec2 p0 = uvc();
  vec2 p = p0 * 1.5;
  int oct = 3 + int(u_quality * 2.0 + 0.5);
  float t = u_flow;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.6), oct), fbm(p + vec2(5.2, 1.3) - t * 0.4, oct));
  float warp = 1.6 + 2.2 * u_lowS;
  vec2 r = vec2(fbm(p + warp * q + vec2(1.7, 9.2) + t * 0.3, oct), fbm(p + warp * q + vec2(8.3, 2.8) - t * 0.2, oct));
  float f = fbm(p + warp * r, oct);

  vec3 col = mix(u_pal[2] * 0.35, u_pal[0], clamp(f * f * 2.2, 0.0, 1.0));
  col = mix(col, u_pal[1], clamp(length(q) * 0.55, 0.0, 1.0) * 0.55);
  col = mix(col, u_pal[3], clamp(r.x * r.x, 0.0, 1.0) * (0.15 + 0.35 * u_centroid));
  float b = f * f * 2.3;                       // コントラスト（暗部を残す）
  col *= b * (0.45 + 0.15 * u_lvlS + 0.25 * u_intensity + 0.1 * idle());
  // キック：中心付近の小さな脈動（画面全体は明るくしない）
  col *= 1.0 + 0.18 * u_kick * exp(-length(p0) * 4.0);
  // ハイハット：細かい粒
  col += (hash12(gl_FragCoord.xy + floor(u_time * 30.0)) - 0.5) * 0.04 * u_hat;
  outColor = vec4(max(col, 0.0), 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
