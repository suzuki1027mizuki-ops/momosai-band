/* 6: グリッチ — 黒地に太いストライプ・バーコード・矩形。キック/スネアで構図をカット切替、
 * 高域で RGB ずれとブロックずれ、アクセントで白黒反転（フラッシュ制限を通す）。激しい曲向け。
 * 光過敏対策：カットは 0.3 秒に 1 回まで、明るい部分は画面の 40% 未満。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'glitch', key: '6', name: 'Glitch', nameJa: 'グリッチ', aliases: ['グリッチ'], cost: 1,
    params: [{ id: 'shift', name: 'ずれの量', min: 0, max: 2, def: 1 }, { id: 'scroll', name: '流れる速さ', min: 0, max: 2.5, def: 1 }],
    init(st) { st.seed = 1; st.lastCut = -1; st.invert = 0; st.scroll = 0; },
    update(st, f, dt, fx) {
      if ((f.onsetFlags & 3) && f.time - st.lastCut >= 0.3) {
        st.seed = (st.seed + 1 + ((f.kickN * 7 + f.snareN * 13) % 5)) % 997;
        st.lastCut = f.time;
      }
      st.invert *= Math.exp(-dt / 0.06);
      if ((f.onsetFlags & 8) && fx.requestFlash(0, 'glitch-invert')) st.invert = 1;
      st.scroll += (0.05 + 0.6 * f.level) * dt * fx.param[1];
      return { u_seed: st.seed, u_invert: st.invert, u_scroll: st.scroll };
    },
    frag: `
uniform float u_seed, u_invert, u_scroll;

vec3 layer(vec2 uv) {
  float rows = 3.0 + floor(hash11(u_seed * 1.37) * 5.0);
  float ry = uv.y * rows;
  float row = floor(ry);
  float h = hash12(vec2(row, u_seed));
  // 偶数番目の帯は必ず何か描く（構図がスカスカにならないように）。奇数番目は盛り上がりで空が減る
  float kindF = mod(row, 2.0) < 0.5 ? h * 4.0 : h * mix(8.0, 5.5, u_intensity);
  int kind = int(kindF);
  float x = uv.x + u_scroll * (hash11(row + u_seed * 3.1) - 0.5) * 0.5;
  vec3 c = pal(h * 3.0 + u_seed * 0.07) * 0.9;
  float m = 0.0;
  if (kind == 0) {          // バーコード
    float n = 30.0 + h * 70.0;
    m = step(0.6, hash12(vec2(floor(x * n), row + u_seed)));
  } else if (kind == 1) {   // 太い矩形
    float c0 = hash11(row * 3.3 + u_seed), w = 0.08 + 0.2 * hash11(row + u_seed * 0.3);
    m = step(abs(fract(x) - c0), w);
  } else if (kind == 2) {   // 細いストライプ
    m = step(0.75, fract(x * (12.0 + h * 20.0)));
    c = mix(c, vec3(1.0), 0.3);
  } else if (kind == 3) {   // 市松
    vec2 g = floor(vec2(x * 24.0, fract(ry) * 4.0));
    m = mod(g.x + g.y, 2.0) * 0.8;
  } else {                  // 空
    m = 0.0;
  }
  float fy = fract(ry);
  m *= step(0.07, fy) * step(fy, 0.93);
  return c * m;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  // 高域：ブロック単位のずれ
  vec2 blk = floor(uv * vec2(14.0, 22.0));
  float bh = hash12(blk + floor(u_time * 18.0) + u_seed);
  float sh = bh > 1.0 - 0.3 * u_high ? (hash12(blk * 1.7 + u_seed) - 0.5) * 0.12 * u_high * u_param.x : 0.0;
  vec2 us = uv + vec2(sh, 0.0);
  float ca = (0.0015 + 0.005 * u_high) * u_param.x;
  vec3 col;
  col.r = layer(us + vec2(ca, 0.0)).r;
  col.g = layer(us).g;
  col.b = layer(us - vec2(ca, 0.0)).b;
  col *= 0.75 + 0.25 * u_level + 0.1 * idle();
  col = mix(col, vec3(0.85) - col, u_invert * 0.9);
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
