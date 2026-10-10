/* Shift+5: 波 — 奥から手前へ重なる光る波の線（夜の海・音の波）。線の下は淡いグラデーションで塗り、手前の波が奥を隠す。
 * 手前の波は低音で大きくうねり、真ん中は中音、奥は高音で細かく揺れる。手前の波には音の波形そのものも重ねる
 * （音が大きいほど荒れる）。音量で流れが速く（u_travel）、キックで海面ごと持ち上がり、こぶが波に沿って左から右へ走る。
 * 声の音程で色合いが傾く。明るさは変えずに、形と動きで反応する。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'waves', key: 's5', name: 'Waves', nameJa: '波', aliases: ['なみ', '海'], cost: 1.5,
    params: [
      { id: 'height', name: '波の高さ', min: 0.3, max: 2, def: 1 },
      { id: 'count', name: '本数', min: 3, max: 12, def: 7, step: 1 },
      { id: 'width', name: '線の太さ', min: 0.5, max: 2.5, def: 1 },
    ],
    init(st) { st.low = 0; st.mid = 0; st.high = 0; st.pitch = 0.5; st.lvl = 0; st.heave = 0; st.hv = 0; },
    update(st, f, dt) {
      const k = (tau) => Math.min(1, dt / tau);
      // 波の高さは音にすばやく追従（形だけが変わる）。色・明るさに使う音量はゆっくり（光過敏対策）
      st.low += (f.low - st.low) * k(0.1);
      st.mid += (f.mid - st.mid) * k(0.08);
      st.high += (f.high - st.high) * k(0.06);
      st.lvl += (f.level - st.lvl) * k(0.5);
      st.pitch += ((f.pitch === undefined ? 0.5 : f.pitch) - st.pitch) * k(0.8);
      // キックで海面が持ち上がって戻る（ばね）
      if ((f.onsetFlags | 0) & 1) st.hv += 2.6 * (f.kickEv[1] || 0.6);
      st.hv += (-60 * st.heave - 9 * st.hv) * dt;
      st.heave += st.hv * dt;
      return { u_lowS: st.low, u_midS: st.mid, u_highS: st.high, u_lvlS: st.lvl, u_pitchS: st.pitch, u_heave: st.heave };
    },
    frag: `
uniform float u_lowS, u_midS, u_highS, u_lvlS, u_pitchS, u_heave;

void main() {
  vec2 p = uvc();
  float A = u_res.x / u_res.y;
  float xn = p.x / A + 0.5;                   // 0..1（左→右）
  float hScale = u_param.x;
  int n = int(clamp(u_param.y, 3.0, 12.0) + 0.5);
  float fn = float(n);
  float lw = u_param.z;
  float hue = (u_pitchS - 0.5) * 0.45 + u_time * 0.01;

  // 空：暗いグラデーション＋水平線のかすかな光
  vec3 col = mix(u_pal[2] * 0.09, u_pal[2] * 0.012, smoothstep(0.05, 0.5, p.y));
  col += pal(hue + 0.5) * 0.05 * exp(-abs(p.y - 0.17) * 9.0) * (0.7 + 0.3 * u_lvlS + 0.2 * idle());

  // キック：左端から右へ走るこぶ（高さとその傾き）
  float bump = 0.0, bumpD = 0.0;
  for (int k = 0; k < 6; k++) {
    vec2 ev = u_kickEv[k];
    if (ev.x > 2.0) continue;
    float xc = -0.5 * A - 0.15 + ev.x * 1.35;
    float u = (p.x - xc) / 0.13;
    float g = ev.y * exp(-u * u) * exp(-ev.x * 0.7) * (1.0 - exp(-ev.x * 12.0));
    bump += g;
    bumpD += g * (-2.0 * u / 0.13);
  }

  // 音の波形（手前の波に重ねる）。傾きは差分で
  float wx = xn * 0.42 + 0.29;
  float wv = wave(wx), wvD = (wave(wx + 0.004) - wave(wx - 0.004)) / 0.008 * (0.42 / A);

  for (int i = 0; i < 12; i++) {
    if (i >= n) break;
    float t = float(i) / (fn - 1.0);          // 0 = 奥, 1 = 手前
    float yb = 0.16 - 0.52 * pow(t, 1.25) + 0.4 * t * u_heave;   // 奥ほど詰まる（遠近）。キックで手前ほど持ち上がる
    // 受け持つ音域：奥 = 高音、真ん中 = 中音、手前 = 低音
    float band = mix(mix(u_highS, u_midS, smoothstep(0.0, 0.5, t)), u_lowS, smoothstep(0.5, 1.0, t));
    float fb = mix(0.75, 0.05, t);
    float env = 0.65 + 0.7 * specS(fb + 0.15 * xn);  // 横方向の起伏はその音域のスペクトルで
    float amp = hScale * mix(0.014, 0.085, t) * (0.3 + 1.9 * band + 0.15 * idle()) * env;
    float kx = mix(15.0, 3.0, t);             // 奥ほど細かい波
    float ph = u_travel * mix(2.0, 3.4, t) + float(i) * 1.7;
    float a1 = kx * p.x - ph, a2 = 1.71 * kx * p.x + ph * 0.63 + 1.3, a3 = 3.1 * kx * p.x - ph * 1.9, a4 = 5.3 * kx * p.x + ph * 2.7;
    float rip = 0.25 + 0.9 * u_highS;         // 高音で細かいさざ波
    float chop = 0.5 * u_midS;                // 中音で波頭が荒れる
    float h = amp * (0.62 * sin(a1) + 0.3 * sin(a2) + 0.12 * rip * sin(a3) + 0.07 * chop * sin(a4));
    float hd = amp * kx * (0.62 * cos(a1) + 0.3 * 1.71 * cos(a2) + 0.12 * rip * 3.1 * cos(a3) + 0.07 * chop * 5.3 * cos(a4));
    // 波形：手前の波ほど強く
    float wa = hScale * 0.085 * t * t * (0.25 + 0.75 * u_lvlS);
    h += wa * wv;
    hd += wa * wvD;
    float bAmp = mix(0.02, 0.13, t) * hScale;
    h += bump * bAmp;
    hd += bumpD * bAmp;
    float f = p.y - (yb + h);                // 線より上が正
    vec3 lc = pal(hue + t * 0.55 + xn * 0.12);
    // 線の下：手前の波が奥を隠す。線から離れるほど暗く
    if (f < 0.0) {
      vec3 fill = lc * (0.16 * exp(f * 7.0) + 0.02) + u_pal[2] * 0.02;
      col = mix(col, fill, 0.88);
    }
    // 光る線（太さは画素で一定）＋にじみ。明るさはゆっくりした音量で（波の高さほど速く変えない）
    float dpx = abs(f) / sqrt(1.0 + hd * hd) * u_res.y;
    float w = max(0.8, (0.6 + 1.2 * t) * lw * u_res.y / 400.0);
    float core = smoothstep(w + 1.0, w * 0.3, dpx);
    float glow = exp(-abs(f) / (0.006 + 0.012 * t * lw));
    float bright = mix(0.45, 1.0, t) * (0.8 + 0.2 * u_lvlS);
    col += lc * (core * 0.9 + glow * 0.28) * bright;
  }
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
