/* 8: 星空 — 宇宙を進む星（ワープ）。奥から手前へ加速しながら流れ、速いほど光の筋に伸びる。
 * 音量で進む速さ、キック・キメで一気に加速（明るさではなく速さ）、スネアで流れ星、ハイハットで瞬き、
 * 盛り上がりで星が増える。視点はゆっくり回り、ゆれる。静かな曲・合唱・BGM にも合う。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'stars', key: '8', name: 'Stars', nameJa: '星空', aliases: ['星空', 'スター', 'ワープ'], cost: 2,
    params: [{ id: 'speed', name: '進む速さ', min: 0.2, max: 2.5, def: 1 }, { id: 'amount', name: '星の量', min: 0.4, max: 1.8, def: 1 }],
    init(st) { st.fly = 0; st.boost = 0; st.lvl = 0; st.spd = 0.3; st.roll = 0; },
    update(st, f, dt, fx) {
      const fl = f.onsetFlags | 0;
      // キック・キメで加速（速さに足す → 位置はなめらかに進む）
      if (fl & 1) st.boost = Math.min(1.8, st.boost + 0.75 * (f.kickEv[1] || 0.6));
      if (fl & 8) st.boost = Math.min(1.8, st.boost + 1.0);
      st.boost *= Math.exp(-dt / 0.3);
      st.lvl += (f.level - st.lvl) * Math.min(1, dt / 0.25);
      const speed = (0.2 + 0.8 * st.lvl + 0.25 * f.intensity + st.boost) * fx.param[0];
      st.fly += speed * dt;
      st.spd += (speed - st.spd) * Math.min(1, dt / 0.1);
      st.roll += (0.03 + 0.06 * st.lvl) * dt;
      // u_fly は層の奥行き（fract(… + u_fly * 0.25)）に使うので、4 の倍数で折り返す
      return { u_fly: st.fly % 4096, u_spd: st.spd, u_roll: st.roll % 6283.1853 };
    },
    frag: `
uniform float u_fly, u_spd, u_roll;

// 1 層ぶんの星。dir = 中心から外への向き、streak = その向きに伸ばす量（速いほど光の筋に）
vec3 layer(vec2 p, vec2 dir, float seed, float density, float streak) {
  vec2 id = floor(p), gv = fract(p) - 0.5;
  float h = hash12(id + seed);
  if (h > density) return vec3(0.0);
  vec2 v = gv - (hash22(id + seed * 1.7) - 0.5) * 0.4;
  float size = 0.03 + 0.045 * fract(h * 13.7);
  // 伸ばしてもマスからはみ出さない長さまで
  float k = min(streak, 0.26 / size - 1.0);
  float d = length(vec2(dot(v, dir) / (1.0 + k), dot(v, vec2(-dir.y, dir.x))));
  float tw = 0.6 + 0.4 * sin(u_time * (4.0 + h * 9.0) + h * 40.0);
  tw = mix(1.0, tw, 0.45 + 0.55 * u_hat);
  float core = smoothstep(size, 0.0, d);
  // にじみは伸ばさない（伸ばすとマスの境目で切れて四角く見える）
  float glow = smoothstep(size * 3.2, 0.0, length(v)) * 0.22;
  vec3 c = mix(vec3(1.0), pal(h * 3.0), 0.45);
  // 伸びた分は暗く（面積あたりの明るさを保つ）
  return c * (core + glow) * tw * 1.7 / (1.0 + 0.3 * k);
}

void main() {
  float A = u_res.x / u_res.y;
  // 視点：ゆっくり回り、ゆれる。キックで少し寄る
  vec2 p = rot(u_roll) * (uvc() + 0.035 * vec2(sin(u_time * 0.23), cos(u_time * 0.19))) * (1.0 - 0.05 * u_kick);
  float r = length(p);
  vec2 dir = p / max(r, 1e-4);
  // 星雲（暗め）：進む向きに流れる
  float n = vnoise(p * 2.2 + vec2(u_fly * 0.11, u_time * 0.03)) * vnoise(p * 4.0 - vec2(u_time * 0.05, u_fly * 0.07));
  vec3 col = (u_pal[2] * 0.12 + u_pal[1] * 0.05) * n * (0.7 + 0.25 * u_beat + 0.15 * u_intensity);
  float density = (0.36 + 0.36 * u_intensity) * u_param.y;
  int nl = u_quality > 0.4 ? 6 : 4;
  float fn = float(nl);
  for (int i = 0; i < 6; i++) {
    if (i >= nl) break;
    float fi = float(i);
    float depth = fract(fi / fn + u_fly * 0.25);       // 0 = 奥 → 1 = 手前
    float z = 1.0 - depth;
    float scale = 0.9 + 17.0 * z * z;                    // 近づくほど速く外へ流れる
    float fade = smoothstep(0.0, 0.2, depth) * smoothstep(1.0, 0.82, depth);
    float streak = u_spd * r * (1.2 + 9.0 * depth * depth);
    col += layer(p * scale + fi * 37.1, dir, fi * 11.3, density, streak) * fade;
  }
  // スネア：流れ星（細い光の筋が斜めに走る）
  for (int k = 0; k < 3; k++) {
    vec2 ev = u_snareEv[k];
    if (ev.x > 0.8) continue;
    float sn = u_snareN - float(k);
    vec2 a = (hash22(vec2(sn, 1.7)) - 0.5) * vec2(A * 0.9, 0.8);
    vec2 sd = normalize(hash22(vec2(sn, 9.1)) - 0.5 + vec2(0.013, 0.007));
    vec2 q = uvc() - a - sd * ev.x * 1.3;
    float along = dot(q, sd), across = dot(q, vec2(-sd.y, sd.x));
    float tail = smoothstep(-0.22, 0.0, along) * smoothstep(0.012, 0.0, along);
    col += mix(vec3(1.0), u_pal[0], 0.35) * tail * exp(-across * across * 60000.0) * ev.y * exp(-ev.x * 4.0) * 0.9;
  }
  col *= 0.85 + 0.1 * idle();
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
