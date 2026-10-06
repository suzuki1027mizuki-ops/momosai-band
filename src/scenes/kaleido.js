/* 5: 万華鏡 — 前フレームを回転・ズーム・N 分割の鏡映で重ね、中央に波形の輪と
 * キックの多角形を描き足す。サビ・ソロ・クライマックス向け。 */
(function (VJ) {
  'use strict';
  const FOLDS = [4, 6, 8, 12];
  VJ.scenes.register({
    id: 'kaleido', key: '5', name: 'Kaleido', nameJa: '万華鏡', aliases: ['万華鏡', 'カレイド'], cost: 2, feedback: true,
    init(st) { st.rot = 0; st.folds = 6; st.fresh = 0; st.dir = 1; },
    update(st, f, dt, fx) {
      const k = dt * 60;
      if (f.onsetFlags & 2) st.folds = FOLDS[f.snareN % FOLDS.length];
      st.fresh = 0;
      // アクセントで残像をリセット（画面の明るさが大きく変わるのでフラッシュ制限を通す）
      if (f.onsetFlags & 8) {
        if (fx.requestFlash(0, 'kaleido-reset')) { st.fresh = 0.85; st.dir = -st.dir; }
      }
      st.rot += st.dir * (0.05 + 0.45 * f.level) * dt;
      return {
        u_rotK: st.rot,
        u_spin: st.dir * (0.004 + 0.03 * f.level) * k,
        u_zoom: 1 + (0.006 + 0.045 * f.kick) * k,
        u_folds: st.folds,
        u_decay: Math.pow(0.86 + 0.1 * f.intensity, k),
        u_fresh: st.fresh,
      };
    },
    frag: `
uniform float u_rotK, u_spin, u_zoom, u_folds, u_decay, u_fresh;
void main() {
  vec2 p = uvc();
  float aspect = u_res.x / u_res.y;
  // 前フレーム：回転・ズーム（外へ流れる）＋鏡映の折り返し
  vec2 pp = rot(u_spin) * p / u_zoom;
  float a = atan(pp.y, pp.x), r = length(pp);
  float seg = TAU / u_folds;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 kp = r * vec2(cos(a), sin(a));
  vec2 puv = vec2(kp.x / aspect, kp.y) + 0.5;
  vec3 prev = texture(u_prev, puv).rgb;
  float inside = step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0);
  prev *= u_decay * inside * (1.0 - u_fresh);

  // 新しく描く：波形の輪（左右対称にして継ぎ目をなくす）
  vec2 pr = rot(u_rotK) * p;
  float ang = atan(pr.y, pr.x) / TAU + 0.5;
  float w = wave(abs(ang * 2.0 - 1.0));
  float R0 = 0.11 + 0.05 * u_level + 0.02 * idle();
  float d = abs(length(p) - (R0 + w * 0.07));
  vec3 newc = pal(u_time * 0.05 + ang) * smoothstep(0.012, 0.0, d) * (0.35 + 0.75 * u_level + 0.3 * idle());
  // キック：多角形の輪郭
  float N = u_folds;
  float pa = atan(pr.y, pr.x);
  float sec = TAU / N;
  float am = mod(pa + sec * 0.5, sec) - sec * 0.5;
  float pd = length(pr) * cos(am) / cos(PI / N);
  float size = 0.05 + 0.24 * u_kick;
  newc += pal(u_kickN * 0.25 + 0.5) * smoothstep(0.01, 0.0, abs(pd - size)) * u_kick;
  vec3 col = min(prev + newc, vec3(1.0));
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
