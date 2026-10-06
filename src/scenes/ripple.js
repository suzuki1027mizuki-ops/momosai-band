/* 1: 波紋 — キックで中心からネオンのリング、スネアでランダムな位置から細い二重リング。
 * 点の格子がリングの通過で屈折して揺れる。最初の曲向け（「音に反応してる！」が一番伝わる）。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'ripple', key: '1', name: 'Ripple', nameJa: '波紋', aliases: ['波紋', 'はもん'], cost: 1,
    frag: `
void main() {
  vec2 p = uvc();
  float aspect = u_res.x / u_res.y;
  // アクセントで格子全体をゆがませる
  p += 0.02 * u_accent * vec2(sin(p.y * 9.0 + u_time * 3.0), cos(p.x * 9.0 + u_time * 2.0));

  vec3 col = mix(vec3(0.006, 0.007, 0.02), u_pal[2] * 0.09, 0.5 + 0.5 * p.y);
  col += u_pal[0] * 0.03 * exp(-dot(p, p) * 2.0);
  vec3 ringCol = vec3(0.0);
  float ringSum = 0.0;
  vec2 disp = vec2(0.0);
  float speed = 0.75 + 0.35 * u_level;

  // キック：中心から太いリング（ヒットごとに固定の色）
  for (int i = 0; i < 8; i++) {
    vec2 ev = u_kickEv[i];
    float age = ev.x, st = ev.y;
    if (age > 3.0) continue;
    float r = age * speed * (0.8 + 0.3 * st);
    float d = length(p) - r;
    float w = 0.013 + 0.026 * st * exp(-age * 1.5);
    float fade = st * exp(-age * 1.3);
    float ring = exp(-d * d / (w * w)) * fade;
    disp += normalize(p + 1e-5) * exp(-d * d / (16.0 * w * w)) * fade * 0.025;
    ringCol += pal((u_kickN - float(i)) * 0.25) * ring;
    ringSum += ring;
  }
  // スネア：ランダムな位置から細い二重リング
  for (int i = 0; i < 8; i++) {
    vec2 ev = u_snareEv[i];
    float age = ev.x, st = ev.y;
    if (age > 2.0) continue;
    float n = u_snareN - float(i);
    vec2 c0 = (hash22(vec2(n, 7.0)) - 0.5) * vec2(aspect * 0.75, 0.75);
    float r = age * 0.85;
    float d = length(p - c0) - r;
    float w = 0.0055;
    float fade = st * exp(-age * 2.2);
    float ring = (exp(-d * d / (w * w)) + 0.6 * exp(-(d + 0.028) * (d + 0.028) / (w * w))) * fade;
    ringCol += mix(vec3(1.0), pal(n * 0.31 + 0.5), 0.45) * ring * 0.8;
    ringSum += ring;
  }

  // 点の格子（リングの通過で屈折）
  float s = mix(0.072, 0.046, u_intensity);
  vec2 q = (p + disp) / s;
  vec2 cell = fract(q) - 0.5;
  float hot = min(ringSum, 1.0);
  float dotR = 0.09 + 0.06 * u_hat + 0.22 * hot + 0.04 * idle();
  float dotv = smoothstep(dotR, dotR - 0.07, length(cell));
  vec3 dotCol = mix(u_pal[0], u_pal[1], hash12(floor(q)));
  col += dotv * dotCol * (0.3 + 0.55 * hot + 0.12 * u_intensity + 0.08 * idle());
  col += ringCol * 0.95;
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
