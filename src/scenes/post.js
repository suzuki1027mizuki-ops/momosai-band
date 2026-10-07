/* 仕上げパス：表示の調整（位置・サイズ・回転・反転）→ シーンの拡大（切替中は前のシーンと混ぜる）+ インパクト（色収差＋ズーム）
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
uniform sampler2D u_text;
uniform sampler2D u_text2;
uniform sampler2D u_logo;
uniform vec2 u_res;          // 物理（キャンバス）サイズ
uniform vec4 u_area;         // 表示エリア（物理 px）：中心 x, y, 幅, 高さ
uniform float u_rot;         // 0..3（90° 単位、時計回り）
uniform vec2 u_flip;         // 左右・上下反転（物理）
uniform vec2 u_lres;         // 論理サイズ（回転後）
uniform float u_time, u_flash, u_black, u_master, u_impact, u_textAlpha, u_text2Alpha, u_logoAlpha, u_latSq, u_vignette;
uniform vec3 u_flashColor;
uniform vec4 u_textRect, u_text2Rect, u_logoRect;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// 枠の外は 0（分岐させずに掛け算で消す：ミップマップの微分が乱れないように）
vec4 sampleRect(sampler2D t, vec4 rect, vec2 uv) {
  vec2 q = (uv - rect.xy) / rect.zw;
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  return texture(t, clamp(q, 0.0, 1.0)) * inside;
}

vec3 sceneAt(vec2 p) {
  vec3 a = texture(u_scene, p).rgb;
  if (u_mix > 0.001) a = mix(a, texture(u_scene2, p).rgb, u_mix);
  return a;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  // 物理 → 表示エリア内の 0..1
  vec2 q = (px - (u_area.xy - u_area.zw * 0.5)) / u_area.zw;
  vec3 col = vec3(0.0);
  if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
    if (u_flip.x > 0.5) q.x = 1.0 - q.x;
    if (u_flip.y > 0.5) q.y = 1.0 - q.y;
    // 回転（論理 uv を求める）
    vec2 uv = q;
    if (u_rot > 0.5 && u_rot < 1.5) uv = vec2(1.0 - q.y, q.x);
    else if (u_rot > 1.5 && u_rot < 2.5) uv = vec2(1.0 - q.x, 1.0 - q.y);
    else if (u_rot > 2.5) uv = vec2(q.y, 1.0 - q.x);

    vec2 c = uv - 0.5;
    // インパクト：明るさを変えずに色収差とズーム（フラッシュ制限の対象外で安全）
    vec2 uz = 0.5 + c * (1.0 - 0.03 * u_impact);
    float ca = 0.008 * u_impact;
    col.r = sceneAt(uz + c * ca).r;
    col.g = sceneAt(uz).g;
    col.b = sceneAt(uz - c * ca).b;

    // 周辺減光はシーンにだけ（文字やロゴは隅でも暗くしない）
    float aspect = u_lres.x / u_lres.y;
    float v = smoothstep(1.25, 0.35, length(c * vec2(aspect, 1.0)) * 1.1);
    col *= mix(1.0, v, u_vignette);

    if (u_logoAlpha > 0.001) { vec4 t = sampleRect(u_logo, u_logoRect, uv); col = mix(col, t.rgb, t.a * u_logoAlpha); }
    if (u_textAlpha > 0.001) { vec4 t = sampleRect(u_text, u_textRect, uv); col = mix(col, t.rgb, t.a * u_textAlpha); }
    if (u_text2Alpha > 0.001) { vec4 t = sampleRect(u_text2, u_text2Rect, uv); col = mix(col, t.rgb, t.a * u_text2Alpha); }

    col += u_flashColor * u_flash;
    col *= u_master;
    col *= 1.0 - u_black;
  }

  // 遅延計測用：右下（物理）の小さな四角
  if (u_latSq >= 0.0) {
    float sz = max(24.0, u_res.y * 0.05);
    if (px.x > u_res.x - sz - 8.0 && px.x < u_res.x - 8.0 && px.y > 8.0 && px.y < sz + 8.0) col = vec3(u_latSq);
  }
  // ディザ（グラデーションの段差を防ぐ）
  col += (hash12(px + fract(u_time) * 97.0) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
})(globalThis.VJ = globalThis.VJ || {});
