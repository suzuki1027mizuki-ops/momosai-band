/* Shift+4: 光の粒 — ピントの外れた光の玉（ボケ）が 3 層の奥行きで漂う（しっとりした曲・合唱・司会向け）。
 * 玉は 1 つずつふらふら動きながら流れ、層ごとにゆっくり向きを変える。音量で流れが速くなる。
 * 音量で玉が少し大きく・柔らかく、キックでその近くの玉がふくらんで押しのけられる（明るさは面積で割って保つ）。
 * 声の音程で色合いが少しずれ、声が出ている間は暖かい光が差す。高音で奥の小さな玉がきらめく。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'bokeh', key: 's4', name: 'Bokeh', nameJa: '光の粒', aliases: ['ボケ', 'ひかり'], cost: 1.5,
    params: [
      { id: 'amount', name: '量', min: 0.3, max: 1.6, def: 1 },
      { id: 'size', name: '大きさ', min: 0.5, max: 1.6, def: 1 },
      { id: 'blur', name: 'ぼかし', min: 0, max: 1, def: 0.4 },
    ],
    init(st) { st.drift = 0; st.lvl = 0; st.voiced = 0; st.pitch = 0.5; st.high = 0; },
    update(st, f, dt) {
      // 光過敏対策：大きさ・色の変化はゆっくり追従させた値で
      const k = (tau) => Math.min(1, dt / tau);
      st.lvl += (f.level - st.lvl) * k(0.5);
      st.voiced += ((f.voiced || 0) - st.voiced) * k(0.6);
      st.pitch += ((f.pitch === undefined ? 0.5 : f.pitch) - st.pitch) * k(0.8);
      st.high += (f.high - st.high) * k(0.3);
      st.drift += (0.1 + 0.2 * st.lvl) * dt;
      return { u_drift: st.drift, u_lvlS: st.lvl, u_voicedS: st.voiced, u_pitchS: st.pitch, u_highS: st.high };
    },
    frag: `
uniform float u_drift, u_lvlS, u_voicedS, u_pitchS, u_highS;

// 絞りの形：丸と六角形の中間（内接円の半径 = 1）
float apert(vec2 q) {
  q = abs(q);
  float hex = max(q.x * 0.866 + q.y * 0.5, q.y);
  return mix(length(q), hex, 0.55);
}

void main() {
  vec2 p = uvc();
  float A = u_res.x / u_res.y;
  float amount = u_param.x, size = u_param.y, blur = u_param.z;

  // 背景：ほの暗いグラデーション＋声の暖かい光（下から）
  vec3 col = mix(u_pal[2] * 0.06, u_pal[2] * 0.015, smoothstep(-0.5, 0.5, p.y)) + 0.003;
  vec3 warm = mix(vec3(1.0, 0.52, 0.2), u_pal[0], 0.2);
  vec2 wp = p - vec2(0.0, -0.55);
  col += warm * (0.07 * u_voicedS + 0.02 * idle()) * exp(-dot(wp, wp) * 2.5);
  // ゆっくり動く大きな色の霞（真っ黒にしない）
  vec2 f1 = p - vec2(0.45 * sin(u_drift * 0.5), 0.2 * cos(u_drift * 0.4));
  vec2 f2 = p - vec2(-0.5 * cos(u_drift * 0.33), -0.15 + 0.2 * sin(u_drift * 0.6));
  col += u_pal[0] * 0.025 * exp(-dot(f1, f1) * 3.0) + u_pal[1] * 0.025 * exp(-dot(f2, f2) * 3.0);

  // キック：画面のどこか（ヒットごとに固定）を中心に近くの玉がふくらむ。立ち上がりも少しなめらかに
  vec2 kp[3];
  float kw[3];
  for (int k = 0; k < 3; k++) {
    vec2 ev = u_kickEv[k];
    kp[k] = (hash22(vec2(u_kickN - float(k), 5.3)) - 0.5) * vec2(A * 0.8, 0.7);
    kw[k] = ev.x < 2.5 ? ev.y * (1.0 - exp(-ev.x * 14.0)) * exp(-ev.x * 2.2) : 0.0;
  }
  float hueShift = (u_pitchS - 0.5) * 0.3 + u_time * 0.008;
  float soft = clamp(0.05 + 0.3 * blur + 0.1 * u_lvlS, 0.03, 0.6);
  float grow = size * (1.0 + 0.22 * u_lvlS + 0.08 * idle());
  bool anyKick = kw[0] + kw[1] + kw[2] > 0.001;   // キックの影響が無いときは押しのけの計算を省く
  mat2 R = rot(0.3);
  vec3 acc = vec3(0.0);
  int L0 = u_quality > 0.4 ? 0 : 1;                // GPU が苦しいときは奥の小さな玉の層を省く

  for (int L = L0; L < 3; L++) {
    float fl = float(L);
    float cell = 0.1 * pow(1.95, fl);         // 奥 0.1 → 手前 0.38
    float spd = 0.45 + 0.45 * fl;              // 視差：手前ほど速く流れる
    vec2 off = vec2(0.22 * sin(u_drift * 0.9 + fl * 2.1) + u_drift * 0.25 * spd, -u_drift * spd + 0.08 * cos(u_drift * 0.6 + fl * 1.3));
    // 層ごとにゆっくり向きを変える（全体が同じ向きに流れ続けないように）
    vec2 q = (rot(0.16 * sin(u_drift * 0.5 + fl * 1.9)) * p + off) / cell;
    vec2 id0 = floor(q);
    // 近い 2×2 マスだけ調べる（玉の半径をマスの半分までにしてあるので足りる）
    vec2 sg = step(0.5, q - id0) * 2.0 - 1.0;
    float dens = clamp(amount * (0.62 - 0.08 * fl), 0.0, 0.95);
    float ls = soft * (0.5 + 0.7 * fl);        // 手前ほどぼける
    float bright = (1.0 - 0.3 * fl) * (1.0 - 0.35 * ls);
    for (int j = 0; j < 2; j++)
    for (int i = 0; i < 2; i++) {
      vec2 id = id0 + vec2(float(i), float(j)) * sg;
      float h = hash12(id + fl * 37.1);
      // 大きな周期で粗密をつける（一様に散らばらないように）
      vec2 wc = id * cell;
      float cl = 0.45 + 0.75 * (0.5 + 0.5 * sin(wc.x * 3.3 + fl * 1.9) * sin(wc.y * 2.6 + fl * 4.1));
      if (h > dens * cl) continue;
      vec2 h2 = hash22(id + fl * 11.7);
      // 1 つずつふらふら動く（中心のずれは 0.36 マスまで：半径 0.5 マスと合わせて隣の 2×2 マスに収まる）
      vec2 c = id + 0.5 + (h2 - 0.5) * 0.4 + 0.16 * vec2(sin(u_time * (0.5 + 0.7 * h2.x) + h2.x * 40.0), cos(u_time * (0.45 + 0.6 * h2.y) + h2.y * 30.0));
      vec2 cs = c * cell - off;                // 画面上の中心
      float sw = 0.0;
      vec2 push = vec2(0.0);
      for (int k = 0; k < 3; k++) {
        if (!anyKick) break;
        vec2 dk = cs - kp[k];
        float w = kw[k] * exp(-dot(dk, dk) * 7.0);
        sw += w;
        push += dk * w;
      }
      float hs = fract(h * 13.7 + h2.x);
      float r = min(cell * (0.14 + 0.34 * hs * hs) * grow * (1.0 + 0.55 * sw), cell * 0.5);
      vec2 d = R * ((q - c) * cell - push * 0.12 * cell / 0.1);
      float x = apert(d) / r;
      if (x > 1.3) continue;
      // 中は淡く輪郭が明るい（ぼけの縁）＋外側にかすかな光
      float edge = 1.0 - smoothstep(1.0 - ls, 1.0 + ls * 0.25, x);
      float rim = smoothstep(0.5, 1.0, x);
      float a = edge * (0.5 + 0.5 * rim * rim * (1.0 - 0.7 * ls)) + 0.2 * exp(-max(x - 1.0, 0.0) * 8.0) * smoothstep(1.3, 1.0, x);
      // ゆっくり現れて消える
      float life = smoothstep(-0.5, 0.5, sin(u_time * (0.3 + 0.4 * h2.y) + h * 60.0));
      vec3 c0 = pal(h * 2.3 + fl * 0.19 + hueShift);
      c0 = mix(c0, warm, 0.3 * u_voicedS);
      float tw = L == 0 ? 1.0 + 0.45 * u_highS * sin(u_time * 8.0 + h * 80.0) : 1.0;
      // ふくらんだ分は暗く（面積あたりの明るさを保つ）
      float hot = 0.6 + 1.1 * h2.y * h2.y * h2.y;   // ところどころ明るい玉
      acc += c0 * a * life * bright * hot * tw / (1.0 + 0.8 * sw);
    }
  }
  col += acc * 1.3;
  col = 1.0 - exp(-col * 1.5);
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
