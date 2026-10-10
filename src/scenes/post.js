/* 仕上げパス：表示の調整（位置・サイズ・回転・反転）→ シーンの拡大（切替中は前のシーンと混ぜる）+ インパクト（色収差＋ズーム）
 * + 激しさ（キックで寄る・スネアで揺れる・色ずれ）
 * + 曲名 + テロップ + ロゴの透かし + フラッシュ + 明るさ + 暗転 + 周辺減光 + ディザ + 遅延計測用の四角。
 * 「論理座標」はシーン・文字の座標（回転後の画面）、「物理座標」は実際のキャンバスの画素。 */
(function (VJ) {
  'use strict';
  VJ.scenes.POST = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_scene;
uniform sampler2D u_scene2;  // クロスフェード中の前のシーン
uniform float u_mix;         // 前のシーンの割合（0 = 今のシーンだけ）
uniform float u_trans;       // 切替の種類 0 フェード / 1 ワイプ / 2 円 / 3 ブラインド / 4 ズーム / 5 スライド / 6 グリッチ / 7 モザイク
uniform float u_tseed;       // 切替ごとの乱数（向き・ずれ方）
uniform sampler2D u_text;
uniform sampler2D u_text2;
uniform sampler2D u_logo;
uniform vec2 u_res;          // 物理（キャンバス）サイズ
uniform vec4 u_area;         // 表示エリア（物理 px）：中心 x, y, 幅, 高さ
uniform float u_rot;         // 0..3（90° 単位、時計回り）
uniform vec2 u_flip;         // 左右・上下反転（物理）
uniform vec2 u_lres;         // 論理サイズ（回転後）
uniform float u_time, u_flash, u_black, u_master, u_impact, u_textAlpha, u_text2Alpha, u_logoAlpha, u_latSq, u_vignette;
uniform float u_punch, u_rgb; // 激しさ：キックで寄る（拡大率）・色ずれ
uniform vec2 u_shake;         // 激しさ：スネアで揺れる（画面の高さに対する割合）
uniform vec3 u_flashColor;
uniform vec4 u_textRect, u_text2Rect, u_logoRect;
// オーバーレイ：重ねるシーン（濃さ・重ね方 0 = スクリーン / 1 = 加算）、画像（重ね方 0 = そのまま / 1 = 加算 / 2 = スクリーン）、隅の文字
uniform sampler2D u_scene3;
uniform sampler2D u_ovImg;
uniform sampler2D u_text3;
uniform float u_ovMix, u_ovMode, u_ovImgAlpha, u_ovImgMode, u_text3Alpha;
uniform vec4 u_ovImgRect, u_text3Rect;
uniform float u_alphaOut;    // 1 = 透過ウィンドウ（単体アプリ）：暗いところを透明にして出す

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// 枠の外は 0（分岐させずに掛け算で消す：ミップマップの微分が乱れないように）
vec4 sampleRect(sampler2D t, vec4 rect, vec2 uv) {
  vec2 q = (uv - rect.xy) / rect.zw;
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  return texture(t, clamp(q, 0.0, 1.0)) * inside;
}

// 切替の途中：今のシーン（u_scene）と前のシーン（u_scene2）を種類ごとに混ぜる。どの種類も、画面のどの場所も
// 前 → 今 へ 1 回だけ変わる（行き来しない＝点滅にならない）
vec3 transAt(vec2 p) {
  float t = clamp(1.0 - u_mix, 0.0, 1.0); // 進み具合 0 → 1
  int k = int(u_trans + 0.5);
  float asp = u_lres.x / u_lres.y;
  // 向き：乱数で左右・上下（ワイプ・スライド・ブラインド）
  float sd = u_tseed * 4.0;
  vec2 ax = sd < 2.0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  float sg = mod(floor(sd), 2.0) < 0.5 ? 1.0 : -1.0;
  float s = sg > 0.0 ? dot(p, ax) : 1.0 - dot(p, ax);
  vec2 pa = p, pb = p; // 今・前のシーンを読む位置
  float w;             // 今のシーンの割合
  if (k == 1) {        // ワイプ（境目をやわらかく）
    float e = mix(1.05, -0.05, t);
    w = smoothstep(e - 0.04, e + 0.04, s);
  } else if (k == 2) { // 円（中央から広がる）
    float d = length((p - 0.5) * vec2(asp, 1.0));
    float R = t * (0.5 * sqrt(asp * asp + 1.0) + 0.08) - 0.04;
    w = 1.0 - smoothstep(R - 0.04, R + 0.02, d);
  } else if (k == 3) { // ブラインド（10 本の帯）
    float f = fract(s * 10.0);
    float e = t * 1.1 - 0.05;
    w = 1.0 - smoothstep(e - 0.05, e + 0.05, f);
  } else if (k == 4) { // ズーム（前のシーンは寄りながら消え、今のシーンは少し寄った所から落ち着く）
    vec2 c = p - 0.5;
    pa = 0.5 + c * (0.85 + 0.15 * t);
    pb = 0.5 + c / (1.0 + 0.6 * t);
    w = t;
  } else if (k == 5) { // スライド（押し出す）
    float e = 1.0 - t;
    pb = p + ax * sg * t;
    pa = p - ax * sg * e;
    w = smoothstep(e - 0.004, e + 0.004, s);
  } else if (k == 6) { // グリッチ（横の帯ごとに、ずれながら 1 回だけ切り替わる）
    float row = floor(p.y * 24.0);
    float at = hash12(vec2(row, u_tseed * 97.0)) * 0.85 + 0.075;
    float g = exp(-pow((t - at) * 12.0, 2.0));
    float dx = (hash12(vec2(row, u_tseed * 31.0 + 7.0)) - 0.5) * 0.14 * g;
    pa = p + vec2(dx, 0.0);
    pb = pa;
    w = step(at, t);
  } else if (k == 7) { // モザイク（粗くなって、ます目ごとに切り替わり、細かく戻る）
    float ps = sin(3.14159 * t) / 22.0;
    vec2 g = p * vec2(asp, 1.0);
    if (ps > 0.003) { pa = (floor(g / ps) + 0.5) * ps / vec2(asp, 1.0); pb = pa; }
    float n = hash12(floor(g * 22.0) + u_tseed * 53.0);
    w = step(0.3 + 0.4 * n, t);
  } else {             // フェード
    w = t;
  }
  return mix(texture(u_scene2, pb).rgb, texture(u_scene, pa).rgb, w);
}

vec3 sceneAt(vec2 p) {
  vec3 a = u_mix > 0.001 ? (u_trans < 0.5 ? mix(texture(u_scene, p).rgb, texture(u_scene2, p).rgb, u_mix) : transAt(p)) : texture(u_scene, p).rgb;
  if (u_ovMix > 0.001) {
    vec3 o = max(texture(u_scene3, p).rgb, 0.0) * u_ovMix;
    a = u_ovMode > 0.5 ? a + o : a + o - min(a, vec3(1.0)) * min(o, vec3(1.0));
  }
  return a;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  // 物理 → 表示エリア内の 0..1
  vec2 q = (px - (u_area.xy - u_area.zw * 0.5)) / u_area.zw;
  vec3 col = vec3(0.0);
  float cov = 0.0;             // 文字・ロゴ・画像が覆っている割合（透過ウィンドウで、暗い色の部分も透けないように）
  if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
    if (u_flip.x > 0.5) q.x = 1.0 - q.x;
    if (u_flip.y > 0.5) q.y = 1.0 - q.y;
    // 回転（論理 uv を求める）
    vec2 uv = q;
    if (u_rot > 0.5 && u_rot < 1.5) uv = vec2(1.0 - q.y, q.x);
    else if (u_rot > 1.5 && u_rot < 2.5) uv = vec2(1.0 - q.x, 1.0 - q.y);
    else if (u_rot > 2.5) uv = vec2(q.y, 1.0 - q.x);

    vec2 c = uv - 0.5;
    // インパクト・激しさ：明るさを変えずに色収差・ズーム・揺れ（フラッシュ制限の対象外で安全）
    // 揺らした分だけ余分に寄せて、画面の端の外（引き伸ばされた画素）が見えないようにする
    vec2 sh = u_shake * vec2(u_lres.y / u_lres.x, 1.0);
    float zoom = 0.03 * u_impact + u_punch + 2.0 * max(abs(sh.x), abs(sh.y));
    vec2 uz = 0.5 + c * (1.0 - zoom) + sh;
    float ca = 0.008 * u_impact + u_rgb;
    col.r = sceneAt(uz + c * ca).r;
    col.g = sceneAt(uz).g;
    col.b = sceneAt(uz - c * ca).b;

    // 周辺減光はシーンにだけ（文字やロゴは隅でも暗くしない）
    float aspect = u_lres.x / u_lres.y;
    float v = smoothstep(1.25, 0.35, length(c * vec2(aspect, 1.0)) * 1.1);
    col *= mix(1.0, v, u_vignette);

    // オーバーレイの画像（枠・イラスト）：シーンの上、ロゴ・文字の下。揺れ・寄りは掛けない
    if (u_ovImgAlpha > 0.001) {
      vec4 t = sampleRect(u_ovImg, u_ovImgRect, uv);
      float k = t.a * u_ovImgAlpha;
      if (u_ovImgMode < 0.5) { col = mix(col, t.rgb, k); cov = max(cov, k); }
      else if (u_ovImgMode < 1.5) col += t.rgb * k;
      else col += t.rgb * k * (1.0 - min(col, vec3(1.0)));
    }
    if (u_logoAlpha > 0.001) { vec4 t = sampleRect(u_logo, u_logoRect, uv); col = mix(col, t.rgb, t.a * u_logoAlpha); cov = max(cov, t.a * u_logoAlpha); }
    if (u_text3Alpha > 0.001) { vec4 t = sampleRect(u_text3, u_text3Rect, uv); col = mix(col, t.rgb, t.a * u_text3Alpha); cov = max(cov, t.a * u_text3Alpha); }
    if (u_textAlpha > 0.001) { vec4 t = sampleRect(u_text, u_textRect, uv); col = mix(col, t.rgb, t.a * u_textAlpha); cov = max(cov, t.a * u_textAlpha); }
    if (u_text2Alpha > 0.001) { vec4 t = sampleRect(u_text2, u_text2Rect, uv); col = mix(col, t.rgb, t.a * u_text2Alpha); cov = max(cov, t.a * u_text2Alpha); }

    col += u_flashColor * u_flash;
    col *= u_master;
    col *= 1.0 - u_black;
    cov *= 1.0 - u_black;
  }

  // 遅延計測用：右下（物理）の小さな四角
  if (u_latSq >= 0.0) {
    float sz = max(24.0, u_res.y * 0.05);
    if (px.x > u_res.x - sz - 8.0 && px.x < u_res.x - 8.0 && px.y > 8.0 && px.y < sz + 8.0) col = vec3(u_latSq);
  }
  // ディザ（グラデーションの段差を防ぐ）
  col += (hash12(px + fract(u_time) * 97.0) - 0.5) / 255.0;
  col = clamp(col, 0.0, 1.0);
  // 透過ウィンドウ：明るさを不透明度にする（黒 = 透明）。色は不透明度を掛けた形（premultiplied）で出す
  float aOut = 1.0;
  if (u_alphaOut > 0.5) {
    aOut = max(clamp(max(col.r, max(col.g, col.b)) * 1.8, 0.0, 1.0), cov);
    col = min(col, vec3(aOut));
  }
  outColor = vec4(col, aOut);
}`;
})(globalThis.VJ = globalThis.VJ || {});
