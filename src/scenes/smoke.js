/* Shift+6: 煙 — 色の煙（インク）が渦を巻いて流れる（前フレーム再利用）。
 * 渦の流れ（カールノイズ）で前のフレームを運び、少しずつ薄める。ゆっくり動く 3 つの出口から
 * 音量に合わせて色が注がれ、キックで小さな色の煙がぽんと出る。声があると音程の高さの位置からも出る。
 * 光過敏対策：注ぐ量は小さく、広い範囲の明るさが拍ごとに跳ねないようにしている。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'smoke', key: 's6', name: 'Smoke', nameJa: '煙', aliases: ['けむり', 'インク'], cost: 1.5, feedback: true,
    params: [
      { id: 'swirl', name: '渦の速さ', min: 0.3, max: 2, def: 1 },
      { id: 'trail', name: '残り方', min: 0.5, max: 1.5, def: 1 },
      { id: 'amount', name: '量', min: 0.3, max: 2, def: 1 },
    ],
    init(st) { st.t = 0; st.lvl = 0; },
    update(st, f, dt, fx) {
      const k = dt * 60;
      st.lvl += (f.level - st.lvl) * Math.min(1, dt / 0.25);
      st.t += (0.06 + 0.25 * st.lvl) * dt * fx.param[0];
      const base = Math.min(0.995, 0.986 + (fx.param[1] - 1) * 0.02);
      return {
        u_flowT: st.t,
        u_decayK: Math.pow(base, k),
        u_adv: 0.0022 * k * (0.6 + 0.8 * st.lvl) * fx.param[0],
        u_lvlS: st.lvl,
        u_inj: k * fx.param[2],
      };
    },
    frag: `
uniform float u_flowT, u_decayK, u_adv, u_lvlS, u_inj;

// 流れ関数のノイズ（2 オクターブ）
float psi(vec2 p) { return vnoise(p * 1.7 + vec2(u_flowT, -u_flowT * 0.7)) + 0.5 * vnoise(p * 3.4 - vec2(u_flowT * 1.3, u_flowT)); }

// ガウスの色だまり
float blob(vec2 p, vec2 c, float r) { vec2 d = p - c; return exp(-dot(d, d) / (r * r)); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float A = u_res.x / u_res.y;
  vec2 p = vec2((uv.x - 0.5) * A, uv.y - 0.5);

  // カール：速度 = (∂ψ/∂y, -∂ψ/∂x)（渦を巻き、湧き出しのない流れ）
  float e = 0.02;
  vec2 v = vec2(psi(p + vec2(0.0, e)) - psi(p - vec2(0.0, e)), -(psi(p + vec2(e, 0.0)) - psi(p - vec2(e, 0.0)))) / (2.0 * e);
  v += vec2(0.0, 0.15); // ゆっくり立ちのぼる
  vec2 back = uv - v * u_adv * vec2(1.0 / A, 1.0);
  // 運んで、少しにじませて、薄める
  vec2 px = 1.0 / u_res;
  vec3 prev = texture(u_prev, back).rgb * 0.6
    + (texture(u_prev, back + vec2(px.x, 0.0)).rgb + texture(u_prev, back - vec2(px.x, 0.0)).rgb
     + texture(u_prev, back + vec2(0.0, px.y)).rgb + texture(u_prev, back - vec2(0.0, px.y)).rgb) * 0.1;
  vec3 col = prev * u_decayK;

  // 出口：画面下のほうをゆっくり動く 3 か所。音量で量が増える
  vec3 inj = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(u_time * (0.11 + 0.03 * fi) + fi * 2.1) * A * 0.38, -0.28 + 0.12 * sin(u_time * 0.17 + fi * 1.3));
    inj += pal(fi * 0.25 + u_time * 0.02) * blob(p, c, 0.07 + 0.04 * u_lvlS) * (0.012 + 0.03 * u_lvlS + 0.008 * idle());
  }
  // キック：決まった場所から小さな煙
  for (int i = 0; i < 4; i++) {
    vec2 ev = u_kickEv[i];
    if (ev.x > 0.35) continue;
    float n = u_kickN - float(i);
    vec2 c = (hash22(vec2(n, 3.7)) - 0.5) * vec2(A * 0.8, 0.7);
    inj += pal(n * 0.37) * blob(p, c, 0.06 + 0.05 * ev.y) * ev.y * exp(-ev.x * 9.0) * 0.05;
  }
  // 声：音程の高さの位置から細く
  inj += pal(u_pitchClass) * blob(p, vec2(0.0, u_pitch - 0.5), 0.05) * u_voiced * 0.015;
  col += inj * u_inj;
  // 真っ暗にならないよう、ごく薄い色のもや
  col = max(col, u_pal[2] * 0.04 * (0.5 + vnoise(p * 2.0 + u_flowT)));

  // 飽和させない：いちばん明るい成分が 0.85 を超えたら色を保ったまま下げる
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) col *= 0.85 / m;
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
