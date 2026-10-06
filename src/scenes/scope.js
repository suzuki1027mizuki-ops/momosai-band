/* 9: オシロ — 音の波形そのものを光る線で描き、残像が上下に流れる（前フレーム再利用）。
 * 歌・ピアノ・ギターの形がそのまま見えるので、アコースティックや合唱にも合う。
 * キックで線が太く、音量で振れ幅、スネアで色が変わる。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'scope', key: '9', name: 'Scope', nameJa: 'オシロ', aliases: ['オシロ', '波形', 'オシロスコープ'], cost: 1.5, feedback: true,
    init(st) { st.lvl = 0; },
    update(st, f, dt) {
      const k = dt * 60;
      // 光過敏対策：振れ幅はゆっくり追従させた音量で（ドラムのたびに画面の明るさが跳ねないように）
      st.lvl += (f.level - st.lvl) * Math.min(1, dt / 0.3);
      return { u_decayS: Math.pow(0.86 + 0.04 * f.intensity, k), u_drift: 0.0015 * k, u_lvlS: st.lvl };
    },
    frag: `
uniform float u_decayS, u_drift, u_lvlS;

float lineAt(vec2 uv, float amp, float off) {
  float e = 1.5 / u_res.x;
  float w = wave(uv.x);
  float y = 0.5 + off + amp * w;
  float slope = amp * (wave(uv.x + e) - wave(uv.x - e)) / (2.0 * e) * (u_res.y / u_res.x);
  float d = abs(uv.y - y) * u_res.y / sqrt(1.0 + slope * slope);
  float th = 1.5 + 1.5 * u_kick + 0.8 * u_lvlS;
  return smoothstep(th + 1.0, th * 0.4, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  // 残像：中央から上下へ少しずつ流れて消える
  vec2 c = uv - 0.5;
  vec2 puv = vec2(0.5 + c.x * 0.997, 0.5 + c.y * (1.0 - u_drift * 6.0));
  vec3 prev = texture(u_prev, puv).rgb * u_decayS;
  float amp = (0.15 + 0.12 * u_lvlS) * (1.0 - 0.3 * abs(c.x * 2.0));
  vec3 lc = pal(uv.x * 0.4 + u_snareN * 0.21 + u_time * 0.03);
  float l1 = lineAt(uv, amp, 0.0);
  float l2 = lineAt(uv, -amp * 0.6, 0.0) * 0.35;
  vec3 line = lc * (l1 * (0.5 + 0.25 * u_lvlS + 0.2 * idle()) + l2);
  // 新しい線は前フレームと半分ずつ混ぜる（毎フレーム形が変わる波形のちらつきを抑える）
  vec3 col = mix(prev, max(prev, line), 0.55);
  col += lc * smoothstep(0.004, 0.0, abs(uv.y - 0.5)) * 0.08;
  outColor = vec4(min(col, vec3(1.0)), 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
