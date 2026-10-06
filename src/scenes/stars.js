/* 8: 星空 — 宇宙を進む星（ワープ）。音量で進む速さ、キックで少しズーム、ハイハットで瞬き、
 * 盛り上がりで星が増える、拍で星雲がゆっくり呼吸する。静かな曲・合唱・BGM にも合う。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'stars', key: '8', name: 'Stars', nameJa: '星空', aliases: ['星空', 'スター', 'ワープ'], cost: 1.5,
    init(st) { st.fly = 0; },
    update(st, f, dt) {
      st.fly += (0.05 + 0.45 * f.level + 0.1 * f.intensity) * dt;
      return { u_fly: st.fly };
    },
    frag: `
uniform float u_fly;

vec3 layer(vec2 p, float seed, float density) {
  vec2 id = floor(p), gv = fract(p) - 0.5;
  float h = hash12(id + seed);
  if (h > density) return vec3(0.0);
  vec2 off = (hash22(id + seed * 1.7) - 0.5) * 0.7;
  float d = length(gv - off);
  float tw = 0.7 + 0.3 * sin(u_time * (3.0 + h * 7.0) + h * 40.0);
  tw = mix(1.0, tw, 0.3 + 0.7 * u_hat);
  float size = 0.035 + 0.05 * fract(h * 13.7);
  float core = smoothstep(size, 0.0, d);
  float glow = smoothstep(size * 4.0, 0.0, d) * 0.25;
  vec3 c = mix(vec3(1.0), pal(h * 3.0), 0.45);
  return c * (core + glow) * tw;
}

void main() {
  vec2 p = uvc() * (1.0 - 0.04 * u_kick);
  float r = length(p);
  // 星雲（暗め）
  float n = vnoise(p * 2.2 + vec2(u_fly * 0.05, 0.0)) * vnoise(p * 4.0 - u_time * 0.02);
  vec3 col = (u_pal[2] * 0.12 + u_pal[1] * 0.05) * n * (0.7 + 0.25 * u_beat + 0.15 * u_intensity);
  float density = 0.25 + 0.35 * u_intensity;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float depth = fract(fi / 4.0 + u_fly * 0.25);
    float scale = mix(16.0, 0.8, depth);
    float fade = smoothstep(0.0, 0.25, depth) * smoothstep(1.0, 0.85, depth);
    col += layer(p * scale + fi * 37.1, fi * 11.3, density) * fade;
  }
  col *= 0.85 + 0.1 * idle();
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
