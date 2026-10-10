/* 4: オーロラ — 多重に歪ませたノイズが、液体のように大きくうねって流れる。
 * 全体をゆっくり波打たせた上で、流れに沿って模様を何重にも巻き込む（低域でうねりが大きく、中域で流れが速く）。
 * キックでは明るさを変えずに、波紋が広がって模様を押し流す。暗い部分を多めに残す。
 * バラード・イントロ・アウトロ向け。品質（u_quality）で負荷を調整。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'aurora', key: '4', name: 'Aurora', nameJa: 'オーロラ', aliases: ['オーロラ'], cost: 4,
    params: [{ id: 'speed', name: '流れの速さ', min: 0.3, max: 2.5, def: 1 }, { id: 'warp', name: 'うねり', min: 0.3, max: 1.8, def: 1 }],
    init(st) { st.flow = 0; st.low = 0; st.lvl = 0; st.mid = 0; },
    update(st, f, dt, fx) {
      // 光過敏対策：明るさや模様の歪みはビートごとに跳ねないよう、ゆっくり追従させた値を使う
      const k = Math.min(1, dt / 0.4);
      st.low += (f.low - st.low) * k;
      st.lvl += (f.level - st.lvl) * k;
      st.mid += (f.mid - st.mid) * Math.min(1, dt / 0.2);
      st.flow += (0.1 + 0.4 * st.mid + 0.14 * st.lvl) * dt * fx.param[0];
      return { u_flow: st.flow, u_lowS: st.low, u_lvlS: st.lvl };
    },
    frag: `
uniform float u_flow, u_lowS, u_lvlS;
void main() {
  vec2 p0 = uvc();
  float t = u_flow;
  float sway = (0.5 + 0.9 * u_lowS) * u_param.y;
  vec2 p = p0 * 1.3;
  // キック：広がる波紋が模様を押し流す（明るさは変えない）
  float pr = length(p0);
  vec2 pd = p0 / max(pr, 1e-3);
  for (int i = 0; i < 3; i++) {
    vec2 ev = u_kickEv[i];
    if (ev.x > 1.6) continue;
    float w = (pr - ev.x * 0.75) / 0.16;
    // 出だしはなめらかに（押した瞬間に模様が跳ねて、広い範囲の明るさが変わらないように）
    p -= pd * 0.055 * ev.y * exp(-w * w) * exp(-ev.x * 1.6) * (1.0 - exp(-ev.x * 9.0));
  }
  // 全体の大きなうねり（ゆっくり波打つ）
  p += 0.2 * sway * vec2(sin(p.y * 1.4 + t * 1.3) + 0.5 * sin(p.y * 3.1 - t * 2.1), cos(p.x * 1.2 - t * 1.1) + 0.5 * cos(p.x * 2.7 + t * 1.7));
  int oct = 3 + int(u_quality * 2.0 + 0.5);
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.9), oct), fbm(p + vec2(5.2, 1.3) - t * 0.7, oct));
  float warp = (1.9 + 2.6 * u_lowS) * u_param.y;
  vec2 r = vec2(fbm(p + warp * q + vec2(1.7, 9.2) + t * 0.5, oct), fbm(p + warp * q + vec2(8.3, 2.8) - t * 0.4, oct));
  float f = fbm(p + warp * r + vec2(t * 0.3, -t * 0.2), oct);

  vec3 col = mix(u_pal[2] * 0.35, u_pal[0], clamp(f * f * 2.2, 0.0, 1.0));
  col = mix(col, u_pal[1], clamp(length(q) * 0.55, 0.0, 1.0) * 0.55);
  col = mix(col, u_pal[3], clamp(r.x * r.x, 0.0, 1.0) * (0.15 + 0.35 * u_centroid));
  float b = f * f * 2.5;                       // コントラスト（暗部を残す）
  col *= b * (0.45 + 0.15 * u_lvlS + 0.25 * u_intensity + 0.1 * idle());
  // キック：中心付近の小さな脈動（画面全体は明るくしない）
  col *= 1.0 + 0.18 * u_kick * exp(-length(p0) * 4.0);
  // ハイハット：細かい粒
  col += (hash12(gl_FragCoord.xy + floor(u_time * 30.0)) - 0.5) * 0.04 * u_hat;
  outColor = vec4(max(col, 0.0), 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
