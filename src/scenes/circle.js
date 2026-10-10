/* Shift+7: サークル — 円形のスペクトラム。周波数ごとの棒が円周に並ぶ（DJ・ダンス向け）
 * 棒は左右対称（上が低音 → 下が高音）。棒の長さは速い値、ゆっくり落ちるキャップは遅い値。
 * キックで円が少しふくらむ（明るさではなく大きさ）、音量で回転が速く、拍で中央の点線の輪が 1 目盛り進む。
 * 円の内側は音の波形：外と内の 2 本の輪が音に合わせて大きく波打ち（音が大きいほど激しく）、キックで外へはじける。
 * 色は円周に沿ったパレットのグラデーション。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'circle', key: 's7', name: 'Circle', nameJa: 'サークル', aliases: ['円', 'スペクトラム'], cost: 1,
    params: [
      { id: 'size', name: '大きさ', min: 0.6, max: 1.4, def: 1 },
      { id: 'spin', name: '回転', min: 0, max: 2, def: 1 },
      { id: 'bars', name: '棒の数', min: 16, max: 48, def: 32, step: 1 },
    ],
    init(st) { st.rot = 0; st.lvl = 0; st.tick = 0; st.beatN = -1; st.wamp = 0; st.pop = 0; st.pv = 0; st.wrot = 0; },
    update(st, f, dt) {
      // 光過敏対策：音量はゆっくり追従させてから使う
      st.lvl += (f.level - st.lvl) * Math.min(1, dt / 0.3);
      st.rot += (0.05 + 0.3 * st.lvl) * dt;
      // 拍ごとに点線の輪を 1 目盛り（なめらかに追いかける）
      if (f.bpm && f.beatN !== st.beatN) { if (st.beatN >= 0) st.tick += 1; st.beatN = f.beatN; }
      // 内側の波：振れ幅は音量にすばやく追従（形だけ）。キックで外へはじけて戻る（ばね）
      st.wamp += (f.level - st.wamp) * Math.min(1, dt / 0.07);
      if ((f.onsetFlags | 0) & 1) st.pv += 3.2 * (f.kickEv[1] || 0.6);
      st.pv += (-90 * st.pop - 11 * st.pv) * dt;
      st.pop += st.pv * dt;
      st.wrot += (0.25 + 1.1 * st.lvl) * dt;
      return { u_rotC: st.rot % 6283.1853, u_lvlS: st.lvl, u_tick: st.tick % 4096, u_wamp: st.wamp, u_pop: st.pop, u_wrot: st.wrot % 6283.1853 };
    },
    frag: `
uniform float u_rotC, u_lvlS, u_tick, u_wamp, u_pop, u_wrot;

// 内側の波：角度の位置 t（0..1）での波の高さ（x）と、t での傾き（y）。
// 音の波形（x0 から幅 k の区間）をゆるく均して大きな山にし、回りながら進むうねり（n 個の山・位相 ph）を足す
// （音が小さいときも止まって見えないように）。大きな山はなだらかに抑える（棒に重ならないように）
vec2 ringWave(float t, float x0, float k, float ph, float n) {
  float x = x0 + k * t, e = 0.006;
  float a = wave(x - e), b = wave(x), c = wave(x + e);
  float g = 0.4 * (0.3 + 0.7 * u_wamp);
  float w = 0.25 * a + 0.5 * b + 0.25 * c + g * sin(t * n + ph);
  float d = (c - a) / (2.0 * e) * k + g * n * cos(t * n + ph);
  float s = 1.0 + 0.45 * abs(w);
  return vec2(w / s, d / (s * s));
}

void main() {
  vec2 p0 = uvc();
  float px = 1.0 / u_res.y;
  float sz = u_param.x;
  float nb = floor(u_param.z + 0.5);                 // 片側の本数（左右で 2 倍）
  vec2 p = rot(u_rotC * u_param.y) * p0 / sz;
  float aa = 1.5 * px / sz;
  float r = length(p);
  float ang = atan(p.x, p.y);                         // 0 = 上
  float t = abs(ang) / PI;                            // 0（上・低音）→ 1（下・高音）、左右対称
  float R0 = 0.2 * (1.0 + 0.08 * u_kick) + 0.006 * idle();

  // 背景：暗い放射グラデーション
  float r0 = length(p0);
  vec3 col = vec3(0.004, 0.004, 0.014) + u_pal[2] * 0.08 * exp(-r0 * r0 * 3.0);

  // 円周の色（パレットのグラデーション）
  vec3 cA = mix(u_pal[0], u_pal[1], smoothstep(0.0, 1.0, t));

  // 外へ流れる粒（対数の極座標のマス。u_travel で進むので大きい音ほど速い）。GPU が苦しいときは省く
  int np = u_quality > 0.3 ? 1 : 0;
  for (int k = 0; k < np; k++) {
    float pa = (atan(p.y, p.x) / TAU + 0.5) * 56.0;
    float pr = log(max(r, 1e-3)) * 9.0 - u_travel * 2.5;
    vec2 pc = vec2(floor(pa), floor(pr));
    float ph = hash12(pc + 3.1);
    vec2 pf = vec2(fract(pa), fract(pr)) - (hash22(pc + 7.7) * 0.5 + 0.25);
    float pon = step(ph, 0.3) * smoothstep(R0 + 0.1, R0 + 0.32, r) * smoothstep(1.3, 0.45, r);
    col += mix(cA, u_pal[3], 0.3) * pon * smoothstep(0.2, 0.04, length(pf)) * (0.25 + 0.2 * fract(ph * 7.3));
  }

  // 棒：角度のマスごとに一定幅の角丸の棒
  float s = t * nb;
  float bi = min(floor(s), nb - 1.0);
  float tc = (bi + 0.5) / nb;
  float da = (s - bi - 0.5) * PI / nb;                // 棒の中心線からの角度
  vec2 lp = r * vec2(cos(da), sin(da));               // x = 中心からの距離、y = 棒の幅方向
  float fx = tc * 0.92 + 0.02;
  float v = spec(fx), vs = specS(fx);
  float L = 0.012 + 0.21 * v;
  float hw = 0.36 * PI / nb * R0;                     // 棒の半幅
  vec2 q = lp - vec2(clamp(lp.x, R0 + hw, R0 + L), 0.0);
  float d = length(q) - hw;
  float body = smoothstep(aa, -aa, d);
  float along = clamp((lp.x - R0) / max(L, 1e-3), 0.0, 1.0);
  vec3 bc = mix(cA, u_pal[3], 0.3 * along * along);
  col += bc * body * (0.42 + 0.6 * along) * (0.8 + 0.2 * u_lvlS);
  // 棒のにじみ（細く短い）
  col += cA * 0.08 * exp(-max(d, 0.0) / (0.012)) * (0.3 + v);

  // ゆっくり落ちるキャップ（遅い値）
  float capR = R0 + 0.028 + 0.21 * vs;
  float dc = length(vec2(lp.x - capR, max(abs(lp.y) - hw, 0.0))) - 0.0035;
  col += mix(cA, vec3(1.0), 0.45) * smoothstep(aa, -aa, dc) * 0.7;

  // 円の内側への短い映り込み
  float Li = 0.035 * vs;
  vec2 qi = lp - vec2(clamp(lp.x, R0 - 0.012 - Li, R0 - 0.012), 0.0);
  float di = length(qi) - hw * 0.6;
  col += cA * smoothstep(aa, -aa, di) * 0.18;

  // 土台の細い輪と、なめらかな光の帯（角度方向に連続）
  float aura = specS(t * 0.92 + 0.02);
  col += cA * 0.05 * smoothstep(0.012, 0.0, abs(r - R0 + 0.004));
  col += cA * 0.09 * aura * smoothstep(R0 + 0.25 * aura + 0.05, R0, r) * step(R0, r);

  // 内側：音の波形で大きく波打つ 2 本の輪（左右対称にして継ぎ目をなくす）。キックで外へはじける
  float pop = 1.0 + 0.5 * clamp(u_pop, -0.25, 0.5);
  float Rw = R0 * 0.5 * pop;
  float amp = (0.02 + 0.075 * u_wamp + 0.008 * idle()) * pop;
  float ri = PI * max(r, 0.03);                          // 円周に沿った傾きに直すための係数
  vec2 wv = ringWave(t, 0.2, 0.28, -u_wrot * 3.0, 9.0);
  float rw = clamp(Rw + amp * wv.x, 0.012, R0 - 0.02);
  float sl = amp * wv.y / ri;
  float dw = abs(r - rw) / sqrt(1.0 + sl * sl);          // 線までの距離（急な斜面でも太さが変わらず、途切れない）
  vec3 wc = mix(u_pal[1], u_pal[3], 0.35);
  col += wc * (smoothstep(0.0045 + aa, 0.0, dw) * 0.8 + 0.14 * exp(-dw / 0.012));
  // 波の内側をうっすら塗る（液体のように見せる）
  col += wc * 0.07 * smoothstep(0.012, -0.03, r - rw) * smoothstep(0.0, 0.05, r);
  // 内側の輪：逆向きに波打つ
  vec2 wv2 = ringWave(t, 0.8, -0.28, u_wrot * 4.0, 6.0);
  float rw2 = clamp(Rw * 0.5 - amp * 0.6 * wv2.x, 0.008, R0 - 0.02);
  float sl2 = amp * 0.6 * wv2.y / ri;
  float dw2 = abs(r - rw2) / sqrt(1.0 + sl2 * sl2);
  col += mix(u_pal[0], u_pal[3], 0.25) * (smoothstep(0.0035 + aa, 0.0, dw2) * 0.6 + 0.1 * exp(-dw2 / 0.009));

  // 土台の輪の上：拍で 1 目盛り進む点線 + 中央のほのかな芯
  float tk = floor(u_tick) + smoothstep(0.0, 0.35, u_beatPhase) * step(0.5, u_bpm);
  float ad = atan(p.y, p.x) / TAU * 24.0 - tk * 0.5;
  float dash = smoothstep(0.32, 0.22, abs(fract(ad) - 0.5));
  col += u_pal[0] * dash * smoothstep(0.003 + aa, 0.0, abs(r - R0 + 0.004)) * 0.45;
  col += mix(u_pal[2], u_pal[0], 0.3) * 0.1 * exp(-r * r / (R0 * R0 * 0.12));

  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
