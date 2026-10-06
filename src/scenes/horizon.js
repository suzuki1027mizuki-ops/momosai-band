/* 3: 地平線 — 80 年代シンセウェーブ。遠近グリッドの床、縞の太陽、スペクトルの山脈。
 * キックで床を光の帯が手前へ、スネアでグリッドの色が切り替わる。ポップ・ダンスロック向け。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'horizon', key: '3', name: 'Horizon', nameJa: '地平線', aliases: ['地平線', 'シンセウェーブ'], cost: 1.5,
    frag: `
void main() {
  float A = u_res.x / u_res.y;
  vec2 uv = gl_FragCoord.xy / u_res.y;        // x: 0..A, y: 0..1
  float hz = 0.40;                             // 地平線の高さ
  float cx = A * 0.5;
  vec3 col;
  vec3 lineC = mix(u_pal[0], u_pal[1], mod(u_snareN, 2.0));

  if (uv.y >= hz) {
    float t = (uv.y - hz) / (1.0 - hz);
    col = mix(u_pal[1] * 0.42, u_pal[2] * 0.08, pow(t, 0.55));
    // 星
    vec2 sg = floor(uv * 90.0);
    float star = step(0.986, hash12(sg));
    float tw = 0.5 + 0.5 * sin(u_time * 3.0 + hash12(sg + 3.0) * 40.0);
    col += star * t * (0.18 + 0.55 * u_hat * tw);
    // 太陽
    vec2 sc = vec2(cx, hz + 0.19);
    float R = 0.19 * (1.0 + 0.035 * u_kick + 0.015 * idle());
    float d = length(uv - sc);
    float sy = clamp((uv.y - (sc.y - R)) / (2.0 * R), 0.0, 1.0);
    vec3 sunC = mix(u_pal[1], u_pal[3], sy);
    float cut = sin((uv.y - sc.y) * 70.0 + u_time * 1.4) * 0.5 + 0.5;
    float stripes = sy > 0.55 ? 1.0 : step(cut, 0.35 + sy * 1.1);
    float disc = smoothstep(R, R - 0.004, d) * stripes;
    col = mix(col, sunC, disc);
    col += u_pal[1] * 0.22 * exp(-max(d - R, 0.0) * 9.0) * (0.55 + 0.45 * u_level);
    // スペクトルの山脈（中央が低音、外側へ高音）
    float x = abs(uv.x - cx) / cx;
    float m = specS(0.04 + x * 0.75);
    float mh = hz + 0.015 + m * 0.17 * (0.45 + 0.75 * x) + 0.01 * sin(x * 40.0) * m;
    if (uv.y < mh) {
      col = u_pal[2] * 0.06 + vec3(0.01);
      col += lineC * smoothstep(0.006, 0.0, mh - uv.y) * (0.6 + 0.6 * m);
    }
  } else {
    float dy = hz - uv.y;
    float z = 0.075 / dy;                      // 奥行き（画面下 ≈ 0.19、地平線で ∞）
    float x = (uv.x - cx) * z * 28.0;
    float zz = (z + u_travel * 0.9) * 4.0;
    float fx = fract(x), fz = fract(zz);
    float lx = 1.0 - smoothstep(0.0, fwidth(x) * 1.6, min(fx, 1.0 - fx));
    float lz = 1.0 - smoothstep(0.0, fwidth(zz) * 1.6, min(fz, 1.0 - fz));
    // 地平線付近で線が細かくなりすぎる部分は薄める（モアレ・ちらつき防止）
    lx *= clamp(1.2 - fwidth(x) * 2.5, 0.0, 1.0);
    lz *= clamp(1.2 - fwidth(zz) * 2.5, 0.0, 1.0);
    float grid = max(lx, lz);
    col = u_pal[2] * 0.035 + lineC * grid * 0.85;
    // キック：光の帯が奥から手前へ（遠近に合わせて幅も変える）
    float glow = 0.0;
    for (int i = 0; i < 8; i++) {
      vec2 ev = u_kickEv[i];
      if (ev.x > 1.0) continue;
      float pos = 6.0 * exp(-ev.x * 5.0);
      if (pos < 0.2) continue;
      float dz = (z - pos) / (0.18 * pos);
      glow += exp(-dz * dz) * ev.y * exp(-ev.x * 1.5);
    }
    col += lineC * glow * (0.12 + 0.88 * grid);
    // 地平線付近のもや
    col = mix(col, u_pal[1] * 0.5, exp(-dy * 30.0) * 0.8);
  }
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
