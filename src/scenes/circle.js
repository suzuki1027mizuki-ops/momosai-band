/* Shift+7: サークル — 円形のスペクトラム。周波数ごとの棒が円周に並ぶ（DJ・ダンス向け）
 * 棒は左右対称（上が低音 → 下が高音）。棒の長さは速い値、ゆっくり落ちるキャップは遅い値。
 * キックで円が少しふくらむ（明るさではなく大きさ）、内側の輪に波形、音量で回転が速く、
 * 拍で中央の点線の輪が 1 目盛り進む。色は円周に沿ったパレットのグラデーション。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'circle', key: 's7', name: 'Circle', nameJa: 'サークル', aliases: ['円', 'スペクトラム'], cost: 1,
    params: [
      { id: 'size', name: '大きさ', min: 0.6, max: 1.4, def: 1 },
      { id: 'spin', name: '回転', min: 0, max: 2, def: 1 },
      { id: 'bars', name: '棒の数', min: 16, max: 48, def: 32, step: 1 },
    ],
    init(st) { st.rot = 0; st.lvl = 0; st.tick = 0; st.beatN = -1; },
    update(st, f, dt) {
      // 光過敏対策：音量はゆっくり追従させてから使う
      st.lvl += (f.level - st.lvl) * Math.min(1, dt / 0.3);
      st.rot += (0.05 + 0.3 * st.lvl) * dt;
      // 拍ごとに点線の輪を 1 目盛り（なめらかに追いかける）
      if (f.bpm && f.beatN !== st.beatN) { if (st.beatN >= 0) st.tick += 1; st.beatN = f.beatN; }
      return { u_rotC: st.rot % 6283.1853, u_lvlS: st.lvl, u_tick: st.tick % 4096 };
    },
    frag: `
uniform float u_rotC, u_lvlS, u_tick;

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

  // 内側の輪：波形（左右対称にして継ぎ目をなくす）
  float Rw = R0 * 0.7;
  float amp = 0.018 + 0.035 * u_lvlS + 0.01 * idle();
  float w = wave(t * 0.6 + 0.2);
  float dw = abs(r - Rw - amp * w);
  vec3 wc = mix(u_pal[1], u_pal[3], 0.35);
  col += wc * (smoothstep(0.004 + aa, 0.0, dw) * 0.7 + 0.12 * exp(-dw / 0.01));

  // 中央：拍で 1 目盛り進む点線の輪 + ほのかな芯
  float tk = floor(u_tick) + smoothstep(0.0, 0.35, u_beatPhase) * step(0.5, u_bpm);
  float ad = atan(p.y, p.x) / TAU * 24.0 - tk * 0.5;
  float dash = smoothstep(0.32, 0.22, abs(fract(ad) - 0.5));
  col += u_pal[0] * dash * smoothstep(0.003 + aa, 0.0, abs(r - R0 * 0.42)) * 0.45;
  col += mix(u_pal[2], u_pal[0], 0.3) * 0.1 * exp(-r * r / (R0 * R0 * 0.12));

  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
