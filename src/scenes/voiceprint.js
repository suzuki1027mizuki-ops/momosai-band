/* Shift+9: 声紋 — 年輪。音の高さごとの強さを、中心から外へ広がる輪として流す（円形のスペクトログラム。前フレーム再利用）。
 * 中心 = 今、外側ほど昔（約 7 秒ぶん）。角度 = 音の高さ（対数。上が低い音 → 下が高い音、左右対称。約 65Hz〜6.5kHz）。
 * 歌は倍音が同心の弧になり、話し声は音節ごとに輪の模様が変わる。色は音の高さに沿ってパレットを一周し、
 * 外へ広がるにつれて少しずつ色がずれる（輪ごとに色が変わる）。強いところは白く光る。
 * 声の音程は、中心の輪の上の印と、外へ流れる短い軌跡で示す。
 * 履歴（強さ）は、横 = 時間・縦 = 高さの形のまま描画先の a チャンネルに「1 - 強さ」で残し（仕上げパスは rgb しか
 * 使わない。消去時の a = 1 が強さ 0）、輪の形と色は毎フレームそこから作り直す（履歴ににじまない）。
 * 流れる量は 1 画素単位（ぼけない）。端数は毎フレームずらした閾値で丸めて平均の速さを保つ。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'voiceprint', key: 's9', name: 'Voiceprint', nameJa: '声紋', aliases: ['スペクトログラム', '声のもよう', '年輪'], cost: 1, feedback: true,
    params: [
      { id: 'speed', name: '速さ', min: 0.3, max: 3, def: 1 },
      { id: 'contrast', name: 'コントラスト', min: 0.5, max: 2, def: 1 },
      { id: 'marker', name: '音程の印', min: 0, max: 1, def: 1 },
    ],
    update(st, f) {
      // 音程の履歴（1024 サンプルに 1 点 × 128 点）の長さ
      return { u_histSec: (128 * 1024) / (f.sampleRate || 48000) };
    },
    frag: `
uniform float u_histSec;

#define XNOW 0.88   // 履歴の「今」の列（a チャンネルの中での位置）
#define F_LO 0.08   // 履歴の下端・上端に当てるスペクトルの位置（約 65Hz・6.5kHz）
#define F_HI 0.85
#define R0 0.055    // 中心の輪（今）の半径

int gNow, gSh;

float specY(float y) { return spec(mix(F_LO, F_HI, y)); }
// 流したあとの履歴の画素 p の強さ（新しく入る列は今のスペクトル。2 列以上入るときは直前の列からつなぐ）
float histAt(ivec2 p) {
  p.y = clamp(p.y, 0, int(u_res.y) - 1);
  int sh = max(gSh, 1);
  if (p.x > gNow - sh) {
    float s = specY((float(p.y) + 0.5) / u_res.y);
    if (gSh < 2) return s;
    float t = float(p.x - (gNow - gSh)) / float(gSh);
    return mix(1.0 - texelFetch(u_prev, ivec2(gNow, p.y), 0).a, s, t);
  }
  return 1.0 - texelFetch(u_prev, ivec2(max(p.x + gSh, 0), p.y), 0).a;
}
// 履歴の位置 h（画素。端数あり）の強さ：近くの 4 画素をなめらかにつなぐ
float histSmooth(vec2 h) {
  vec2 f = h - 0.5;
  ivec2 i = ivec2(floor(f));
  vec2 w = fract(f);
  return mix(mix(histAt(i), histAt(i + ivec2(1, 0)), w.x), mix(histAt(i + ivec2(0, 1)), histAt(i + ivec2(1, 1)), w.x), w.y);
}
// 音程（0..1 = C2〜C6）→ 高さ（0..1）
float pitchToY(float p) {
  float x = log2(65.406 * exp2(p * 4.0) / 40.0) / log2(400.0);
  return (x - F_LO) / (F_HI - F_LO);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  float A = u_res.x / u_res.y;
  gNow = int(XNOW * u_res.x);
  // このフレームに流す列数：速さ（画面幅の 0.13 倍/秒）× dt。端数は黄金比でずらした閾値で丸める
  float colsF = 0.13 * u_param.x * u_dt * u_res.x;
  gSh = int(floor(colsF + fract(u_time * 60.0 * 0.6180339)));
  // この画素が持つ履歴（a に残す）
  float v = ip.x <= gNow ? histAt(ip) : 0.0;

  // 年輪：中心 = 今、外側ほど昔。角度 = 音の高さ（上 = 低い音、左右対称）
  vec2 p = uvc();
  float r = length(p);
  float fq = abs(atan(p.x, p.y)) / PI;
  float R1 = 0.5 * length(vec2(A, 1.0));            // 画面の隅までの距離
  float tr = clamp((r - R0) / (R1 - R0), 0.0, 1.0); // 0 = 今 → 1 = いちばん昔
  vec2 h = vec2(float(gNow) * (1.0 - tr), fq * u_res.y);
  float a = histSmooth(h);
  // にじみ（強い倍音のまわりをぼんやり光らせる）：高さ方向と時間方向の少し離れたところ
  float k1 = max(1.0, u_res.y / 180.0);
  float glow = (histAt(ivec2(h + vec2(0.0, 3.0 * k1))) + histAt(ivec2(h - vec2(0.0, 3.0 * k1)))
    + histAt(ivec2(h + vec2(4.0 * k1, 0.0))) + histAt(ivec2(h - vec2(4.0 * k1, 0.0)))) * 0.25;

  // 色：音の高さに沿ってパレットを一周。外へ広がるにつれて色がずれていく。強いところは隣の色から白へ
  float c = u_param.y;
  float t0 = clamp(0.02 + 0.16 * c, 0.05, 0.5);
  float g = 0.6 + 0.6 * c;
  float iv = pow(clamp((a - t0) / (0.9 - t0), 0.0, 1.0), g);
  float ig = pow(clamp((glow - t0) / (0.9 - t0), 0.0, 1.0), g);
  float hueT = fq * 0.85 + tr * 0.55 - u_time * 0.015;
  vec3 hue = pal(hueT), hue2 = pal(hueT + 0.25);
  vec3 sg = hue * smoothstep(0.0, 0.5, iv) * (0.3 + 0.7 * iv);
  sg = mix(sg, mix(hue2, vec3(1.0), 0.55), smoothstep(0.55, 0.95, iv) * 0.85);
  sg += mix(hue, hue2, 0.5) * ig * 0.28;
  float ring = step(R0, r);
  vec3 col = vec3(0.004, 0.005, 0.013) + u_pal[2] * 0.035 * exp(-r * r * 3.0);
  col += sg * mix(1.0, 0.35, tr * tr) * ring;

  // オクターブ（C）の目盛り：中心から伸びる細い線
  float oct = (mix(F_LO, F_HI, fq) * log2(400.0)) - log2(65.406 / 40.0);
  float fw = fwidth(oct);
  col += hue * 0.045 * smoothstep(fw * 1.2, 0.0, abs(fract(oct + 0.5) - 0.5)) * ring * (1.0 - tr);

  // 中心：今の輪（細い線）と、音量で光る芯（色は声の音名）
  float px = 1.0 / u_res.y;
  col += hue * exp(-pow((r - R0) / max(0.003, 1.5 * px), 2.0)) * 0.3;
  col += mix(pal(u_pitchClass), vec3(1.0), 0.3) * exp(-r * r / (R0 * R0 * 0.35)) * (0.12 + 0.55 * u_level + 0.1 * idle());

  // 音程の印：中心の輪の上の短い印と、外へ約 1.2 秒流れる細い軌跡（基音の弧の上に重なる）
  float mk = u_param.z;
  float lw = max(1.2, u_res.y * 0.004);            // 線の太さ（画素）
  float arc = PI * max(r, R0) * u_res.y;           // 高さ 1 あたりの弧の長さ（画素）
  float dTick = (fq - pitchToY(u_pitch)) * arc;
  col += mix(vec3(1.0), hue, 0.3) * smoothstep(lw * 1.6, lw * 0.4, abs(dTick)) * step(R0 - 0.02, r) * step(r, R0 + 0.006) * u_voiced * mk;
  float ageS = tr * XNOW / (0.13 * u_param.x);     // この輪の経過秒数
  if (r > R0 && ageS < 1.2 && mk > 0.0) {
    float ph = pitchHist(1.0 - ageS / u_histSec);
    if (ph >= 0.0) col += vec3(1.0) * smoothstep(lw, lw * 0.3, abs(fq - pitchToY(ph)) * arc) * exp(-ageS * 2.5) * 0.45 * mk;
  }
  col *= 1.0 + 0.15 * idle();
  outColor = vec4(col, 1.0 - clamp(v, 0.0, 1.0));
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
