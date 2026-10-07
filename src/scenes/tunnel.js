/* 2: トンネル — 六角形の輪が奥から手前へ。音量で前進速度、キックで光の波が手前へ、
 * スネアでねじれが切り替わる。疾走系の 8 ビート向け。 */
(function (VJ) {
  'use strict';
  const { hash } = VJ.util;
  VJ.scenes.register({
    id: 'tunnel', key: '2', name: 'Tunnel', nameJa: 'トンネル', aliases: ['トンネル'], cost: 1,
    params: [{ id: 'speed', name: '進む速さ', min: 0.3, max: 2, def: 1 }, { id: 'twist', name: 'ねじれ', min: 0, max: 2, def: 1 }],
    init(st) {
      st.rot = 0; st.dir = 1; st.twist = 0.6; st.twistT = 0.6; st.segs = 6; st.z = 0;
    },
    update(st, f, dt, fx) {
      st.z += (0.15 + 0.85 * f.level) * dt * fx.param[0];
      if (f.onsetFlags & 8) st.dir = -st.dir; // アクセントで回転方向を反転
      if (f.onsetFlags & 2) st.twistT = (f.snareN % 2 ? -1 : 1) * (0.4 + hash(f.snareN) * 1.1);
      if (f.onsetFlags & 1) {
        if (st.segs === 6 && f.intensity > 0.62) st.segs = 12;
        else if (st.segs === 12 && f.intensity < 0.42) st.segs = 6;
      }
      st.twist += (st.twistT - st.twist) * Math.min(1, dt / 0.07);
      st.rot += st.dir * (0.08 + 0.35 * f.level) * dt;
      return { u_rot: st.rot, u_twist: st.twist * fx.param[1], u_segs: st.segs, u_z: st.z };
    },
    frag: `
uniform float u_rot, u_twist, u_segs, u_z;
void main() {
  vec2 p = uvc();
  p *= 1.0 - 0.05 * u_kick;
  p = rot(u_rot) * p;
  float r = length(p) + 1e-4;
  float a = atan(p.y, p.x);
  float N = u_segs;
  float sector = TAU / N;
  float am = mod(a + sector * 0.5, sector) - sector * 0.5;
  float rp = r * cos(am) / cos(PI / N);       // 多角形の「半径」
  float depth = 0.3 / rp;                       // 奥行き
  float z = (depth + u_z * 2.2) * 1.4;
  float tw = a / TAU * N + u_twist * depth * 0.6;

  float rf = fract(z), rd = min(rf, 1.0 - rf);
  float fw = fwidth(z);
  float ringLine = 1.0 - smoothstep(0.0, fw * 1.5 + 0.035, rd);
  float sf = fract(tw), sd = min(sf, 1.0 - sf);
  float spoke = (1.0 - smoothstep(0.0, fwidth(tw) * 1.5 + 0.02, sd)) * 0.55;

  vec3 c = pal(floor(z) * 0.13 + u_z * 0.05);
  float fog = smoothstep(0.02, 0.28, r) * exp(-depth * 0.12);
  vec3 col = c * (ringLine * 0.75 + spoke * 0.45) * fog;

  // キック：奥から手前へ進む光の波
  float glow = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 ev = u_kickEv[i];
    if (ev.x > 1.0) continue;
    float pos = 3.2 - ev.x * 9.0;
    if (pos < 0.15) continue;
    glow += exp(-pow((depth - pos) * 3.0, 2.0)) * ev.y * exp(-ev.x * 1.2);
  }
  col += c * glow * (0.35 + ringLine * 0.8) * fog;

  // ハイハット：輪の縁のきらめき
  float sp = step(0.86, hash12(vec2(floor(z), floor(tw * 3.0))));
  col += vec3(1.0) * sp * ringLine * u_hat * 0.8 * fog * smoothstep(0.12, 0.3, r);
  // 無音時の呼吸
  col += c * ringLine * fog * 0.15 * idle();
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
