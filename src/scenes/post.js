/* 仕上げパス：シーンの拡大 + インパクト（色収差＋ズーム）+ 曲名 + フラッシュ + 明るさ + 暗転
 * + 周辺減光 + ディザ + 遅延計測用の四角。 */
(function (VJ) {
  'use strict';
  VJ.scenes.POST = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_scene;
uniform sampler2D u_text;
uniform vec2 u_res;
uniform float u_time, u_flash, u_black, u_master, u_impact, u_textAlpha, u_latSq, u_vignette;
uniform vec3 u_flashColor;
uniform vec4 u_textRect;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 c = uv - 0.5;
  // インパクト：明るさを変えずに色収差とズーム（フラッシュ制限の対象外で安全）
  vec2 uz = 0.5 + c * (1.0 - 0.03 * u_impact);
  float ca = 0.008 * u_impact;
  vec3 col;
  col.r = texture(u_scene, uz + c * ca).r;
  col.g = texture(u_scene, uz).g;
  col.b = texture(u_scene, uz - c * ca).b;

  // 曲名
  if (u_textAlpha > 0.001) {
    vec2 t = (uv - u_textRect.xy) / u_textRect.zw;
    if (t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0) {
      vec4 tx = texture(u_text, t);
      col = mix(col, tx.rgb, tx.a * u_textAlpha);
    }
  }

  col += u_flashColor * u_flash;
  col *= u_master;
  float aspect = u_res.x / u_res.y;
  float v = smoothstep(1.25, 0.35, length(c * vec2(aspect, 1.0)) * 1.1);
  col *= mix(1.0, v, u_vignette);
  col *= 1.0 - u_black;

  // 遅延計測用：右下の小さな四角
  if (u_latSq >= 0.0) {
    vec2 px = gl_FragCoord.xy;
    float sz = max(24.0, u_res.y * 0.05);
    if (px.x > u_res.x - sz - 8.0 && px.x < u_res.x - 8.0 && px.y > 8.0 && px.y < sz + 8.0) col = vec3(u_latSq);
  }
  // ディザ（グラデーションの段差を防ぐ）
  col += (hash12(gl_FragCoord.xy + fract(u_time) * 97.0) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
})(globalThis.VJ = globalThis.VJ || {});
