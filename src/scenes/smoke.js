/* Shift+6: 煙 — 色の煙（インク）が渦を巻いて大きく流れる（前フレーム再利用）。
 * 大きな渦・中くらいの渦・細かい渦を重ねた流れ（湧き出しのないカールノイズ）で前のフレームを運ぶので、
 * 煙が引き伸ばされて筋になり、巻き込まれていく。音量で流れが速く、低音で大きな渦が強くなる。
 * キックのたびに、その場所に渦（右回り・左回りを交互に）ができて周りを巻き込み、色の煙がぽんと出る。
 * ゆっくり動く 4 つの出口から音量に合わせて色が注がれ、声があると音程の高さの位置からも出る。
 * 光過敏対策：注ぐ量は小さく、広い範囲の明るさが拍ごとに跳ねないようにしている（反応は動きで）。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'smoke', key: 's6', name: 'Smoke', nameJa: '煙', aliases: ['けむり', 'インク'], cost: 2, feedback: true,
    params: [
      { id: 'swirl', name: '渦の速さ', min: 0.3, max: 2, def: 1 },
      { id: 'trail', name: '残り方', min: 0.5, max: 1.5, def: 1 },
      { id: 'amount', name: '量', min: 0.3, max: 2, def: 1 },
    ],
    init(st) { st.t = 0; st.lvl = 0; st.low = 0; },
    update(st, f, dt, fx) {
      const k = dt * 60;
      st.lvl += (f.level - st.lvl) * Math.min(1, dt / 0.25);
      st.low += (f.low - st.low) * Math.min(1, dt / 0.3);
      st.t += (0.1 + 0.4 * st.lvl) * dt * fx.param[0];
      const base = Math.min(0.996, 0.99 + (fx.param[1] - 1) * 0.012);
      return {
        u_flowT: st.t,
        u_decayK: Math.pow(base, k),
        u_adv: 0.0042 * k * (0.55 + 1.0 * st.lvl) * fx.param[0],
        u_lvlS: st.lvl,
        u_lowS: st.low,
        u_inj: k * fx.param[2],
      };
    },
    frag: `
uniform float u_flowT, u_decayK, u_adv, u_lvlS, u_lowS, u_inj;

// 流れ関数（この傾きを 90° 回したものが速度）：大きな渦 + 中くらい + 細かい渦。大きな渦で細かい渦の位置も流す
float psi(vec2 p) {
  float t = u_flowT;
  float big = vnoise(p * 0.9 + vec2(t * 0.6, -t * 0.45));
  vec2 q = p + 0.35 * vec2(sin(p.y * 2.1 + t * 1.3), cos(p.x * 1.7 - t * 1.1));
  float mid = vnoise(q * 2.1 + vec2(-t, t * 0.8));
  float fine = vnoise(q * 4.7 + vec2(t * 1.9, t * 1.4));
  return (1.3 + 1.4 * u_lowS) * big + 0.55 * mid + 0.2 * fine;
}

// ガウスの色だまり
float blob(vec2 p, vec2 c, float r) { vec2 d = p - c; return exp(-dot(d, d) / (r * r)); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float A = u_res.x / u_res.y;
  vec2 p = vec2((uv.x - 0.5) * A, uv.y - 0.5);

  // カール：速度 = (∂ψ/∂y, -∂ψ/∂x)（渦を巻き、湧き出しのない流れ）
  float e = 0.025;
  vec2 v = vec2(psi(p + vec2(0.0, e)) - psi(p - vec2(0.0, e)), -(psi(p + vec2(e, 0.0)) - psi(p - vec2(e, 0.0)))) / (2.0 * e);
  v += vec2(0.25 * sin(u_flowT * 0.9 + p.y * 2.0), 0.3); // 立ちのぼりながら左右にゆれる
  // キック：その場所に渦（交互に右回り・左回り）＋ 出た瞬間は外へ押す
  for (int i = 0; i < 4; i++) {
    vec2 ev = u_kickEv[i];
    if (ev.x > 1.4) continue;
    float n = u_kickN - float(i);
    vec2 c = (hash22(vec2(n, 3.7)) - 0.5) * vec2(A * 0.8, 0.7);
    vec2 d = p - c;
    float g = exp(-dot(d, d) / 0.055);
    float sgn = mod(n, 2.0) < 1.0 ? 1.0 : -1.0;
    v += vec2(-d.y, d.x) * sgn * g * ev.y * 26.0 * exp(-ev.x * 2.2);
    v += d * g * ev.y * 30.0 * exp(-ev.x * 9.0);
  }
  vec2 back = uv - v * u_adv * vec2(1.0 / A, 1.0);
  // 運んで、ほんの少しだけにじませて（筋を残す）、薄める
  vec2 px = 1.0 / u_res;
  vec3 prev = texture(u_prev, back).rgb * 0.84
    + (texture(u_prev, back + vec2(px.x, 0.0)).rgb + texture(u_prev, back - vec2(px.x, 0.0)).rgb
     + texture(u_prev, back + vec2(0.0, px.y)).rgb + texture(u_prev, back - vec2(0.0, px.y)).rgb) * 0.04;
  vec3 col = prev * u_decayK;

  // 出口：画面の下寄りを動き回る 4 か所。音量で量が増える
  vec3 inj = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(u_time * (0.23 + 0.07 * fi) + fi * 2.1) * A * 0.4, -0.12 + 0.3 * sin(u_time * (0.31 + 0.05 * fi) + fi * 1.3));
    inj += pal(fi * 0.25 + u_time * 0.03) * blob(p, c, 0.055 + 0.035 * u_lvlS) * (0.013 + 0.034 * u_lvlS + 0.009 * idle());
  }
  // キック：決まった場所から色の煙
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
