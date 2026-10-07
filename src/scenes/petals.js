/* Shift+8: 花びら — 花びらが舞う。キックで風が吹く
 * 奥・中・手前の 3 層の桜の花びら（先に小さな切れ込みのある丸い花びら）が、回りながら
 * ひらひら裏返り、左右に揺れて落ちる。音量で落ちる速さ（u_travel）、キックで横に突風
 * （動きだけで明るさは変えない）、突風の間は回転も速く。背景はやわらかいグラデーションと玉ボケ。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'petals', key: 's8', name: 'Petals', nameJa: '花びら', aliases: ['桜', 'さくら', '桜吹雪'], cost: 1.5,
    params: [
      { id: 'amount', name: '量', min: 0.2, max: 1, def: 0.5 },
      { id: 'wind', name: '風', min: 0, max: 1.5, def: 1 },
      { id: 'size', name: '大きさ', min: 0.6, max: 1.4, def: 1 },
    ],
    init(st) { st.fall = 0; st.gx = 0; st.gv = 0; st.spin = 0; },
    update(st, f, dt) {
      const fl = f.onsetFlags | 0;
      // キック・キメで横向きの突風（速度に足す → 位置はなめらかに動く）
      if (fl & 1) st.gv += 0.2 * (f.kickEv[1] || 0.6);
      if (fl & 8) st.gv += 0.25;
      st.gv = Math.min(st.gv * Math.exp(-dt / 0.5), 0.8);
      st.fall += 0.04 * dt;
      st.gx += (0.015 + st.gv) * dt;
      st.spin += 1.6 * st.gv * dt;
      return { u_fall: st.fall % 1000, u_gust: st.gx % 1000, u_spin: st.spin % 1000 };
    },
    frag: `
uniform float u_fall, u_gust, u_spin;

// 花びらの形（符号付き距離・花びらの単位）。y = -1 が根元、+1 が先。先が広く、先端に V 字の切れ込み
float petalD(vec2 lp) {
  float w = 0.5 + 0.22 * lp.y;
  float d = length(vec2(lp.x / w, lp.y)) - 1.0;
  float notch = (0.7 + 1.5 * abs(lp.x) - lp.y) * 0.55;
  return max(d * 0.6, -notch);
}

// 1 層ぶん。rgb とアルファ（不透明度）を返す
vec4 layer(vec2 p, float scale, float par, float seed, float dens, float sz, float blur, float dim) {
  float wind = u_param.y;
  // 風向きの傾き（落ちる道筋を斜めに）＋ 揺れ。どちらも有界なので「風」を動かしても飛ばない
  float a1 = p.y * 5.0 + p.x * 1.7 + u_time * 1.1 + seed, a2 = p.y * 11.0 - u_time * 1.7 + seed * 2.0;
  vec2 g = vec2(p.x + 0.35 * wind * p.y + wind * (0.045 * sin(a1) + 0.02 * sin(a2)), p.y);
  // この変形の傾き（花びらの形はゆがめずに画面の座標で描くため）
  float jx = 1.0 + wind * 0.0765 * cos(a1);
  float jy = wind * (0.35 + 0.225 * cos(a1) + 0.22 * cos(a2));
  g += vec2(-u_gust, u_fall + u_travel * 0.1) * par;
  vec2 gc = g * scale;
  // 列ごとに落ちる速さを少し変える（格子の並びを崩す）
  float colI = floor(gc.x);
  gc.y += (u_fall + u_travel * 0.1) * par * scale * 0.35 * hash11(colI * 1.37 + seed);
  vec2 id = floor(gc);
  vec2 f = fract(gc) - 0.5;
  float h = hash12(id + seed);
  vec2 h2 = hash22(id * 1.31 + seed);
  float on = smoothstep(dens, dens - 0.06, fract(h * 7.31));       // 量（なめらかに増減）
  vec2 o = (h2 - 0.5) * 0.3;
  float s = sz * (0.17 + 0.07 * h);                                   // 花びらの長さ（マスの単位・半分）
  // 回転とひらひら（裏返り）。突風の間は速く
  float ang = h * TAU + (u_time * (0.25 + 0.5 * h2.x) + u_spin) * (h2.y < 0.5 ? -1.0 : 1.0);
  float flip = cos(u_time * (1.2 + 1.8 * h2.y) + h * 20.0 + u_spin * 1.5);
  float fw = 0.22 + 0.78 * abs(flip);
  vec2 dg = f - o;
  vec2 lp = rot(ang) * vec2((dg.x - jy * dg.y) / jx, dg.y) / s;
  lp.x /= fw;
  float pxl = scale / u_res.y / (s * fw);                              // 1 画素（花びらの単位）
  float d = petalD(lp);
  float a = smoothstep(pxl * 1.2 + blur, -pxl * 0.5 - blur, d) * on;
  // 色：根元は濃く、先は淡く。裏返った面は少し暗い
  vec3 base = u_pal[0];
  vec3 tip = mix(u_pal[1], u_pal[3], 0.45);
  vec3 c = mix(base, tip, smoothstep(-1.0, 0.7, lp.y));
  c *= (0.62 + 0.38 * abs(flip)) * (0.85 + 0.15 * (1.0 - abs(lp.x)));
  c += u_pal[3] * 0.12 * smoothstep(0.2, 0.0, abs(lp.x)) * smoothstep(-0.9, 0.2, lp.y) * step(0.0, flip);  // 筋
  return vec4(c * dim, a);
}

void main() {
  vec2 p = uvc();
  float y01 = p.y + 0.5;
  float aspect = u_res.x / u_res.y;
  // 背景：上は深い色、下はパレットの色の霞
  vec3 col = mix(u_pal[2] * 0.2 + vec3(0.012, 0.008, 0.02), vec3(0.008, 0.006, 0.018), smoothstep(0.0, 1.0, y01));
  col += u_pal[0] * 0.09 * exp(-y01 * 2.5);
  col += mix(u_pal[1], u_pal[3], 0.5) * 0.05 * exp(-dot(p - vec2(0.45 * aspect, 0.55), p - vec2(0.45 * aspect, 0.55)) * 2.5);
  // 玉ボケ（大きくやわらかい円がゆっくり漂う）
  int nbk = u_quality > 0.4 ? 6 : 3;                 // GPU が苦しいときは減らす
  for (int i = 0; i < 6; i++) {
    if (i >= nbk) break;
    float fi = float(i);
    vec2 bc = vec2((hash11(fi * 3.1) - 0.5) * aspect + 0.12 * sin(u_time * 0.07 + fi * 2.0), hash11(fi * 7.7) - 0.5 + 0.08 * sin(u_time * 0.05 + fi));
    bc.x = mod(bc.x + u_gust * 0.06 + 0.5 * aspect + 0.3, aspect + 0.6) - 0.5 * aspect - 0.3;
    float br = 0.07 + 0.08 * hash11(fi * 1.9);
    float bd = length(p - bc);
    float disk = smoothstep(br, br * 0.8, bd) * 0.6 + exp(-bd * bd / (br * br * 1.2)) * 0.4;
    col += mix(u_pal[0], u_pal[3], hash11(fi * 5.3) * 0.6) * disk * 0.06;
  }

  float dens = u_param.x, sz = u_param.z;
  // 奥 → 手前（奥は小さく霞んで遅い、手前は大きくぼけて速い）
  int nf = u_quality > 0.4 ? 1 : 0;                  // GPU が苦しいときは奥の層を省く
  for (int k = 0; k < nf; k++) {
    vec4 F = layer(p, 13.0, 0.5, 11.0, dens * 0.9, sz, 0.0, 0.45);
    col = mix(col, F.rgb + col * 0.3, F.a * 0.8);
  }
  vec4 L = layer(p, 7.0, 0.85, 37.0, dens * 0.75, sz, 0.0, 0.8);
  col = mix(col, L.rgb, L.a * 0.92);
  L = layer(p, 3.6, 1.35, 73.0, dens * 0.5, sz, 0.06, 1.0);
  col = mix(col, L.rgb, L.a * 0.85);
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
