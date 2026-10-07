/* Shift+9: 声紋 — 音の高さごとの強さを時間方向に流して模様にする（スペクトログラム。前フレーム再利用）。
 * 縦 = 周波数（対数。下が低い音、約 65Hz〜6.5kHz）、横 = 時間（右寄りの縦線が「今」、左へ流れる）。
 * 歌は倍音の縞、話し声は音節ごとのフォルマントの模様になる。強いところほど白く光る。
 * 「今」の線の右には今のスペクトルを横向きの山で、声の音程は線の右の小さな印と短い軌跡で示す。
 * 履歴（強さ）は描画先の a チャンネルに「1 - 強さ」で残し（仕上げパスは rgb しか使わない。
 * 消去時の a = 1 が強さ 0）、色・コントラスト・目盛りは毎フレーム付け直す（履歴ににじまない）。
 * 流れる量は 1 画素単位（ぼけない）。端数は毎フレームずらした閾値で丸めて平均の速さを保つ。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'voiceprint', key: 's9', name: 'Voiceprint', nameJa: '声紋', aliases: ['スペクトログラム', '声のもよう'], cost: 1, feedback: true,
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

#define XNOW 0.88   // 今の列（これより右は今のスペクトルの横向きの山）
#define F_LO 0.08   // 画面の下端・上端に当てるスペクトルの位置（約 65Hz・6.5kHz）
#define F_HI 0.85

int gNow, gSh;

float specY(float y) { return spec(mix(F_LO, F_HI, y)); }
// 流したあとの画素 p の強さ（新しく入る列は今のスペクトル。2 列以上入るときは直前の列からつなぐ）
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
// 音程（0..1 = C2〜C6）→ 画面の高さ
float pitchToY(float p) {
  float x = log2(65.406 * exp2(p * 4.0) / 40.0) / log2(400.0);
  return (x - F_LO) / (F_HI - F_LO);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / u_res;
  float A = u_res.x / u_res.y;
  gNow = int(XNOW * u_res.x);
  // このフレームに流す列数：速さ（画面幅の 0.13 倍/秒）× dt。端数は黄金比でずらした閾値で丸める
  float colsF = 0.13 * u_param.x * u_dt * u_res.x;
  gSh = int(floor(colsF + fract(u_time * 60.0 * 0.6180339)));

  float v = ip.x <= gNow ? histAt(ip) : 0.0;
  // 縦横のにじみ（強い倍音のまわりをぼんやり光らせる）
  int k1 = max(1, int(u_res.y / 180.0));
  float glow = 0.0;
  if (ip.x <= gNow) {
    glow = (histAt(ip + ivec2(0, k1 * 2)) + histAt(ip - ivec2(0, k1 * 2)) + histAt(ip + ivec2(0, k1 * 5)) + histAt(ip - ivec2(0, k1 * 5))
      + histAt(ip + ivec2(k1 * 3, 0)) + histAt(ip - ivec2(k1 * 3, 0))) / 6.0;
  }

  // 色付け（パレットの役割どおり）：暗い → 濃い色（u_pal[2]）→ 主な色（低い音は u_pal[1]、高い音は u_pal[0]）
  // → 明るい色（u_pal[3]）→ 最も強いところは白に近く
  float c = u_param.y;
  float t0 = clamp(0.02 + 0.16 * c, 0.05, 0.5);
  float g = 0.6 + 0.6 * c;
  float iv = pow(clamp((v - t0) / (0.9 - t0), 0.0, 1.0), g);
  float ig = pow(clamp((glow - t0) / (0.9 - t0), 0.0, 1.0), g);
  vec3 base = mix(u_pal[1], u_pal[0], smoothstep(0.1, 0.9, uv.y + 0.15 * sin(u_time * 0.05)));
  vec3 sg = mix(vec3(0.0), u_pal[2] * 0.6, smoothstep(0.0, 0.3, iv));
  sg = mix(sg, base * 0.9, smoothstep(0.2, 0.6, iv));
  sg = mix(sg, u_pal[3], smoothstep(0.6, 0.92, iv) * 0.8);
  sg = mix(sg, vec3(1.0), smoothstep(0.9, 1.0, iv) * 0.6);
  sg += mix(u_pal[2], base, 0.6) * ig * 0.3;
  vec3 col = vec3(0.004, 0.005, 0.013) + u_pal[2] * 0.04 * (1.0 - uv.y);
  float age = smoothstep(-0.05, XNOW * 0.75, uv.x);   // 左（昔）ほど少し暗く
  col += sg * mix(0.35, 1.0, age) * step(uv.x, XNOW + 0.5 / u_res.x);

  // オクターブ（C）の目盛り線
  float oct = (mix(F_LO, F_HI, uv.y) * log2(400.0)) - log2(65.406 / 40.0);
  float fw = fwidth(oct);
  col += base * 0.05 * smoothstep(fw * 1.2, 0.0, abs(fract(oct + 0.5) - 0.5));

  // 今の線と、その右の今のスペクトル（横向きの山）
  float dx = (uv.x - XNOW) * A;
  col += base * exp(-dx * dx * 40000.0) * 0.12;
  float xr = (uv.x - XNOW - 0.012) / (1.0 - XNOW - 0.03);
  if (xr > 0.0) {
    float s = specY(uv.y);
    float m = smoothstep(t0 * 0.8, 1.0, s);
    float fill = smoothstep(m + 0.02, m - 0.02, xr) * step(xr, 1.0);
    float edge = exp(-pow((xr - m) * 40.0, 2.0)) * smoothstep(0.03, 0.12, m);
    col += base * (fill * (0.12 + 0.35 * m) + edge * 0.5);
  }

  // 音程の印：今の線の右の短い横棒と、左へ約 1 秒の細い軌跡（基音の縞の上に重なる）
  float mk = u_param.z;
  float yp = pitchToY(u_pitch);
  float lw = max(1.2, u_res.y * 0.004);          // 線の太さ（画素）
  float dyp = (uv.y - yp) * u_res.y;
  float tick = smoothstep(lw * 1.6, lw * 0.4, abs(dyp)) * step(XNOW, uv.x) * step(uv.x, XNOW + 0.035);
  col += mix(vec3(1.0), base, 0.3) * tick * u_voiced * mk;
  float ageS = (XNOW - uv.x) / (0.13 * u_param.x);  // この列の経過秒数
  if (ageS > 0.0 && ageS < 1.2 && mk > 0.0) {
    float ph = pitchHist(1.0 - ageS / u_histSec);
    if (ph >= 0.0) {
      float d = (uv.y - pitchToY(ph)) * u_res.y;
      col += vec3(1.0) * smoothstep(lw, lw * 0.3, abs(d)) * exp(-ageS * 2.5) * 0.45 * mk;
    }
  }
  col *= 1.0 + 0.15 * idle();
  outColor = vec4(col, 1.0 - clamp(v, 0.0, 1.0));
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
