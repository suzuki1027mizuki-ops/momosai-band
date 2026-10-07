/* Shift+1: 声の輪 — 声に合わせて光る輪。司会・MC・歌向け。中央にタイトル（イベント名）を置ける。
 * 輪の大きさは音量（ゆっくり追従）、輪の線は波形でゆらぎ（角度で波形を読む）、色は声の高さ。
 * 有声の間は輪の内側がやわらかく光り、音節・キックごとに静かな波紋が外へ広がる。
 * 光過敏対策：明るさは急に変えず、反応は大きさ・形・色・動きで出す。 */
(function (VJ) {
  'use strict';
  VJ.scenes.register({
    id: 'orb', key: 's1', name: 'Voice Orb', nameJa: '声の輪', aliases: ['声', 'こえ', 'ボイス'], cost: 1,
    title: true, // バンド名の文字（u_title）を使う
    params: [
      { id: 'size', name: '大きさ', min: 0.6, max: 1.4, def: 1 },
      { id: 'wobble', name: 'ゆらぎ', min: 0, max: 2, def: 1 },
      { id: 'text', name: '文字', min: 0, max: 1, def: 1 },
    ],
    init(st) { st.lvl = 0; st.hue = 0.5; st.vo = 0; st.spin = 0; },
    update(st, f, dt) {
      st.lvl += (f.level - st.lvl) * Math.min(1, dt / 0.25);
      st.vo += (f.voiced - st.vo) * Math.min(1, dt / 0.35);
      // 色は有声の間だけ音程を追う（無声の間は直前の色のまま）
      if (f.voiced > 0.5) st.hue += (f.pitch - st.hue) * Math.min(1, dt / 0.4);
      st.spin = (st.spin + (0.06 + 0.18 * st.lvl) * dt) % (Math.PI * 200);
      return { u_lvlS: st.lvl, u_hue: st.hue, u_vo: st.vo, u_spin: st.spin };
    },
    frag: `
uniform float u_lvlS, u_hue, u_vo, u_spin;

vec4 txt(vec2 uv) {
  vec2 t = (uv - u_titleRect.xy) / u_titleRect.zw;
  float inside = step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0);
  return texture(u_title, t) * inside;
}
// 角度 a の位置の波形（左右対称に折り返して 0°/360° の継ぎ目を消す）。off で波形の読み始めをずらす。
// 話し声の細かいギザギザ（フォルマントの振動）が出ないよう 5 点の重み付き平均でなめらかにする
float wob(float a, float off) {
  float x = off + abs(fract(a / TAU) * 2.0 - 1.0) * 0.14;
  return 0.3 * wave(x) + 0.2 * (wave(x - 0.018) + wave(x + 0.018)) + 0.15 * (wave(x - 0.036) + wave(x + 0.036));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uvc();
  float r = length(p);
  float a = atan(p.y, p.x);
  float size = u_param.x;
  float R = size * (0.25 + 0.09 * u_lvlS + 0.012 * idle());
  float amp = size * (0.006 + 0.08 * u_lvlS) * u_param.y;
  float px = 1.0 / u_res.y;
  vec3 c = pal(u_hue * 2.0 + 0.05);        // 声の高さの色
  vec3 c2 = pal(u_hue * 2.0 + 0.4);        // となりの色（重なる線・波紋）

  // 背景：暗い紺に、輪の色のごく淡い光
  vec3 col = mix(vec3(0.004, 0.005, 0.014), u_pal[2] * 0.045, smoothstep(1.1, 0.0, r));
  col += c * 0.035 * vnoise(p * 2.5 + vec2(u_time * 0.03, -u_time * 0.02)) * smoothstep(0.9, 0.2, r);

  // 輪：3 本の細い線が少しずつ違う向きに回りながら重なる
  float ringD = 1e3;
  float rMain = R;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float dir = i == 1 ? -1.0 : 1.0;
    float an = a + u_spin * (1.0 + 0.35 * fi) * dir + fi * 2.1;
    float rr = R + (fi - 1.0) * 0.011 * size + amp * wob(an, 0.03 + 0.3 * fi)
      + 0.005 * size * sin(3.0 * an + u_time * (0.5 + 0.2 * fi));
    float d = r - rr;
    float w = max(0.0028 + 0.003 * u_lvlS, 1.1 * px) * (i == 0 ? 1.0 : 0.7);
    float line = exp(-d * d / (w * w));
    vec3 lc = i == 0 ? mix(c, vec3(1.0), 0.45) : mix(c, c2, 0.5 + 0.5 * dir);
    col += lc * line * (i == 0 ? 0.95 : 0.5);
    if (i == 0) { ringD = d; rMain = rr; }
  }
  // 輪のまわりのにじみ
  col += c * exp(-abs(ringD) * 22.0) * (0.12 + 0.1 * u_lvlS + 0.05 * idle());
  col += c2 * exp(-max(ringD, 0.0) * 5.0) * 0.035;

  // 内側：声（有声）の間、球のふちのようにやわらかく光る
  float inside = smoothstep(rMain + 0.01, rMain - 0.04, r);
  float rim = pow(clamp(r / max(rMain, 0.05), 0.0, 1.0), 3.0);
  float swirl = fbm(rot(u_spin * 0.5) * p * 3.2 + vec2(0.0, u_time * 0.05), 2 + int(u_quality + 0.5));
  col += c * inside * (0.02 + u_vo * (0.03 + 0.15 * rim)) * (0.6 + 0.8 * swirl);

  // 音節・キックの波紋（細く、外へ行くほど淡く広がる）
  float rip = 0.0;
  float rw = amp * 0.5 * wob(a - u_spin, 0.45);
  for (int i = 0; i < 8; i++) {
    vec2 ev = u_kickEv[i];
    float age = ev.x;
    if (age > 2.5) continue;
    float rr = R + age * size * (0.16 + 0.08 * ev.y) + rw;
    float d = r - rr;
    float w = 0.004 + 0.012 * age;
    rip += exp(-d * d / (w * w)) * ev.y * exp(-age * 1.5) * smoothstep(0.0, 0.1, age);
  }
  col += mix(c, c2, 0.6) * rip * 0.4;

  // 輪から外へゆっくり漂う光の粒（声が出ている間は少し明るく）。極座標の格子に 1 粒ずつ
  float out0 = r - rMain;
  vec2 gq = vec2(a / TAU * 36.0, out0 * 11.0 - u_time * (0.25 + 0.3 * u_lvlS));
  vec2 gid = floor(gq);
  vec2 go = (hash22(gid + 3.7) - 0.5) * 0.5;
  vec2 gd = (fract(gq) - 0.5 - go) * vec2(r * TAU / 36.0, 1.0 / 11.0);
  float mote = smoothstep(max(0.006, 1.2 * px), 0.0, length(gd)) * step(hash12(gid), 0.3);
  col += mix(c2, vec3(1.0), 0.3) * mote * smoothstep(0.0, 0.04, out0) * exp(-out0 * 3.5) * (0.35 + 0.5 * u_vo);

  // 中央のタイトル（設定パネルの「文字」で薄く・消せる）
  float ts = 0.56 * size;
  vec2 tu = (uv - 0.5) / ts + 0.5;
  vec4 tx = txt(tu);
  vec2 tg = (tu - u_titleRect.xy) / u_titleRect.zw;
  float glow = texture(u_title, tg, 4.0).a;
  col += c * glow * (0.18 + 0.12 * u_lvlS) * u_param.z;
  col = mix(col, tx.rgb * mix(vec3(1.0), c, 0.12), tx.a * u_param.z);
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
