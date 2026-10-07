/* Shift+3: 花火 — キックやキメで夜空に花火が開く
 * キックごとに 1 発（位置と色はヒットの番号で決まる）、キメ（アクセント）は大きな二重の多色の玉。
 * 火花は抵抗で減速しながら重力で垂れ、尾を引いて消える（終わりぎわは瞬く）。
 * ドラムの無い歌・話し声では、音程の変わり目で小さな花火（間隔を空ける）。
 * 光過敏対策：1 発の面積と明るさは控えめ、開く位置は毎回ずらす（同じ場所で続けて光らない）。
 * 玉ごとの値（位置・広がり・落下・色）は JS 側で計算して渡す（ソフト描画でも軽く）。 */
(function (VJ) {
  'use strict';
  const MAXB = 8;
  const K = 1.9; // 空気抵抗（大きいほど早く止まる）
  // 0..1 の擬似乱数（ヒットの番号から決まる）
  const rnd = (n, s) => { const x = Math.sin(n * 12.9898 + s * 78.233) * 43758.5453; return x - Math.floor(x); };

  VJ.scenes.register({
    id: 'fireworks', key: 's3', name: 'Fireworks', nameJa: '花火', aliases: ['はなび'], cost: 1.5,
    params: [
      { id: 'amount', name: '量', min: 0.5, max: 1.5, def: 1 },
      { id: 'size', name: '大きさ', min: 0.6, max: 1.4, def: 1 },
      { id: 'life', name: '残り時間', min: 0.5, max: 2, def: 1 },
    ],
    init(st) {
      st.b = []; st.n = 0; st.t = 0; st.lastKick = -9; st.lastSpawn = -9;
      st.A = new Float32Array(MAXB * 4); st.B = new Float32Array(MAXB * 4); st.C = new Float32Array(MAXB * 4);
      st.CA = new Float32Array(MAXB * 4); st.CB = new Float32Array(MAXB * 4);
    },
    update(st, f, dt) {
      st.t += dt;
      for (const b of st.b) b.age += dt;
      const fl = f.onsetFlags | 0;
      const spawn = (kind, str) => {
        const n = st.n;
        st.n = (st.n + 1) % 4096;
        str = Math.max(0.3, Math.min(1, str));
        // 横位置は黄金比でずらしていく（続けて同じ場所に開かない）
        const b = { age: 0, n, kind, x: ((n * 0.618034 + 0.31) % 1) * 2 - 1, y: -0.02 + 0.22 * rnd(n, 1), str };
        // 玉の種類：菊（尾が長い）・牡丹（点で開いて瞬く）・柳（金色で長く垂れる）
        const ty = rnd(n, 2);
        b.trail = ty < 0.4 ? 0.22 : ty < 0.75 ? 0.1 : 0.3;     // 尾の長さ（秒）
        b.trailK = ty < 0.4 ? 0.3 : ty < 0.75 ? 0.05 : 0.5;    // 経過とともに尾が伸びる割合
        b.grav = (ty < 0.75 ? 0.18 : 0.42) + 0.08 * rnd(n, 3); // 垂れ方
        b.glit = ty >= 0.4 && ty < 0.75 ? 1 : 0;                 // 終わりぎわに瞬く
        b.gold = ty >= 0.75 ? 1 : 0;
        b.ci = Math.floor(rnd(n, 5) * 4); b.cf = rnd(n, 6) * 0.6;
        b.cj = (b.ci + 2) % 4;
        st.b.unshift(b);
        if (st.b.length > MAXB) st.b.pop();
        st.lastSpawn = st.t;
        return b;
      };
      const big = (b) => { b.kind = 1; b.str = 1; b.glit = 1; b.gold = 0; b.trail = 0.2; b.trailK = 0.25; b.grav = 0.2; };
      const top = st.b[0];
      if (fl & 8) {
        // キメ：直前に開いたばかりのキックの玉は大玉に格上げ（2 発重ねない）。新しく開くときは中央寄り
        if (top && top.kind === 0 && top.age < 0.12) big(top);
        else { const b = spawn(1, 1); big(b); b.x *= 0.5; b.y = 0.06 + 0.1 * rnd(b.n, 1); }
      } else if (fl & 1) {
        spawn(0, f.kickEv[1] || 0.7);
      }
      if (fl & 1) st.lastKick = st.t;
      // ドラムが無いとき：歌・話し声の音程の変わり目で小さな花火（間隔は 0.45 秒以上）
      if (st.t - st.lastKick > 1.5 && st.t - st.lastSpawn > 0.45) {
        if ((fl & 128) && f.voiced > 0.4) spawn(2, 0.5 + 0.5 * f.level);
        else if (f.level > 0.1 && st.t - st.lastSpawn > 1.8) spawn(2, 0.5);
      }
      const { A, B, C, CA, CB } = st;
      for (let i = 0; i < MAXB; i++) {
        const b = st.b[i], o = i * 4;
        if (!b) { A[o + 3] = 99; continue; }
        const age = b.age, t1 = Math.max(age - b.trail - b.trailK * age, 0);
        const E0 = 1 - Math.exp(-K * age), E1 = 1 - Math.exp(-K * t1);
        // 広がる半径（基準）。キメは大きく、声は小さく
        const R = b.kind === 1 ? 0.27 : b.kind === 2 ? 0.1 + 0.04 * b.str : 0.12 + 0.07 * b.str;
        A[o] = b.x; A[o + 1] = b.y; A[o + 2] = R; A[o + 3] = age;
        // 抵抗と重力：全火花で共通なので輪は円のまま垂れる
        B[o] = E0; B[o + 1] = E1; B[o + 2] = -(b.grav / K) * (age - E0 / K); B[o + 3] = -(b.grav / K) * (t1 - E1 / K);
        C[o] = b.n; C[o + 1] = b.kind; C[o + 2] = b.kind === 1 ? 56 : b.kind === 2 ? 24 : 44; C[o + 3] = b.glit + 2 * b.gold;
        // 色：パレット 4 色の重み（隣どうしを混ぜる）。キメは 2 色
        CA.fill(0, o, o + 4); CB.fill(0, o, o + 4);
        CA[o + b.ci] += 1 - b.cf; CA[o + ((b.ci + 1) % 4)] += b.cf;
        if (b.kind === 1) CB[o + b.cj] = 1; else { CB[o + b.ci] += 1 - b.cf; CB[o + ((b.ci + 1) % 4)] += b.cf; }
      }
      return { u_fwA: A, u_fwB: B, u_fwC: C, u_fwCA: CA, u_fwCB: CB };
    },
    frag: `
uniform vec4 u_fwA[8];  // 新しい順：(横 -1..1, 縦, 半径, 経過秒)
uniform vec4 u_fwB[8];  // (広がり 今, 広がり 尾, 落下 今, 落下 尾)
uniform vec4 u_fwC[8];  // (番号, 種類 0 = キック・1 = キメ・2 = 声, 火花の数, 瞬き + 2 × 金色)
uniform vec4 u_fwCA[8]; // 色 A（パレット 4 色の重み）
uniform vec4 u_fwCB[8]; // 色 B

// 火花の色：最大成分を 1 にそろえる（パレットの暗い色でも沈まないように）
vec3 sparkCol(vec4 w) {
  vec3 c = w.x * u_pal[0] + w.y * u_pal[1] + w.z * u_pal[2] + w.w * u_pal[3];
  return c / max(max(c.r, max(c.g, c.b)), 0.25);
}

// 火花の輪 1 つ。画素の角度から近い 2 本の火花だけを調べる（火花の数によらず一定の負荷）。
// ソフト描画では if で処理を飛ばせないので、輪の外の画素は「回数 0 のループ」で飛ばす
vec3 shell(vec2 p, vec2 c, float age, float life, float R, float N, float seed, vec3 cA, vec3 cB, vec4 E, float glit) {
  vec2 D0 = vec2(0.0, E.z), D1 = vec2(0.0, E.w);
  vec2 q = p - c - 0.5 * (D0 + D1);
  float rb = R * E.x + (E.w - E.z) + 0.03;
  vec3 acc = vec3(0.0);
  int cnt = dot(q, q) < rb * rb ? 1 : 0;
  for (int z = 0; z < cnt; z++) {
    float sec = TAU / N;
    float a = atan(q.y, q.x) / sec;
    float j0 = floor(a);
    float side = fract(a) < 0.5 ? -1.0 : 1.0;
    vec2 qn = q / max(length(q), 1e-5);
    float hot = exp(-age * 5.0);
    float w = max(0.0028, 1.2 / u_res.y);
    float late = smoothstep(0.3, 0.75, age / life);
    int M = u_quality > 0.3 ? 2 : 1;
    for (int m = 0; m < 2; m++) {
      if (m >= M) break;
      float jj = j0 + (m == 0 ? 0.0 : side);
      float j = mod(jj, N);
      float h = hash12(vec2(j, seed));
      float hy = fract(h * 13.71), hz = fract(h * 71.37);
      // 火花の向き：画素の向きからの角度差を多項式で回す（cos・sin を省く）
      float x = (jj + 0.5 + (h - 0.5) * 0.6 - a) * sec;
      float x2 = x * x;
      float cs = 1.0 - x2 * (0.5 - x2 / 24.0), sn = x * (1.0 - x2 * (1.0 / 6.0 - x2 / 120.0));
      vec2 dir = vec2(qn.x * cs - qn.y * sn, qn.x * sn + qn.y * cs);
      float sp = R * (0.82 + 0.18 * hy);
      vec2 H = c + dir * sp * E.x + D0;
      vec2 T = c + dir * sp * E.y + D1;
      vec2 pa = p - T, ba = H - T;
      float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
      float d = length(pa - ba * hh);
      vec2 dh = p - H;
      float I = exp(-d * d / (w * w)) * (0.1 + 0.9 * hh * hh) + 0.4 * exp(-dot(dh, dh) / (6.0 * w * w));
      // 終わりぎわの瞬き（細かい火花なので面積は小さい）
      float tw = mix(1.0, step(0.45, fract(u_time * (4.0 + 5.0 * hz) + h * 7.0)), glit * late);
      vec3 cc = mix(cA, cB, step(0.5, hz));
      cc = mix(cc, cc * vec3(1.0, 0.6, 0.4) + vec3(0.08, 0.02, 0.0), 0.35 * late);   // 冷えて赤みがかる
      acc += mix(cc, vec3(1.0), 0.55 * hot) * I * tw * (0.6 + 0.4 * hy);
    }
  }
  return acc * (1.0 - smoothstep(0.4 * life, life, age));
}

void main() {
  vec2 p = uvc();
  float aspect = u_res.x / u_res.y;
  float y01 = p.y + 0.5;

  // 夜空：上は深い紺、地平線はパレットの暗い色でほんのり明るく
  vec3 hor = mix(vec3(0.11, 0.06, 0.17), u_pal[2] * 0.4, 0.5);
  vec3 col = mix(hor, vec3(0.01, 0.014, 0.045), smoothstep(0.0, 0.75, y01));
  // 星（ゆっくり瞬く）
  vec2 sg = p * 60.0;
  vec2 sid = floor(sg);
  float sh = hash12(sid + 17.0);
  vec2 so = hash22(sid) * 0.6 + 0.2;
  float star = smoothstep(0.12, 0.0, length(fract(sg) - so)) * step(sh, 0.09);
  col += vec3(0.7, 0.75, 1.0) * star * (0.12 + 0.12 * sin(u_time * (0.7 + sh * 20.0) + sh * 90.0)) * smoothstep(0.15, 0.5, y01);

  // 花火（新しい順。最長の寿命より古い玉が来たら打ち切り）
  float amt = u_param.x, size = u_param.y, lifeK = u_param.z;
  float hx = max(0.5 * aspect - 0.3, 0.1);
  for (int i = 0; i < 8; i++) {
    vec4 A = u_fwA[i], C = u_fwC[i];
    float age = A.w;
    if (age > 2.8 * lifeK) break;   // キメ（2.8）・柳（2.1 × 1.25）より古い
    float big = step(0.5, C.y) * step(C.y, 1.5), voice = step(1.5, C.y);
    float gold = step(1.5, C.w);
    float life = lifeK * (voice > 0.5 ? 1.5 : (big > 0.5 ? 2.8 : 2.1)) * (1.0 + 0.25 * gold);
    if (age > life) continue;
    vec2 c = vec2(A.x * hx, A.y);
    float R = A.z * size;
    float N = floor(C.z * amt);
    // 柳は金色寄り
    vec3 cA = mix(sparkCol(u_fwCA[i]), vec3(1.0, 0.72, 0.35), 0.6 * gold);
    vec3 cB = mix(sparkCol(u_fwCB[i]), vec3(1.0, 0.72, 0.35), 0.6 * gold);
    vec3 fw = shell(p, c, age, life, R, N, C.x, cA, cB, u_fwB[i], C.w - 2.0 * gold);
    // キメ：内側にもう一重（白い瞬き混じり）
    int nb = big > 0.5 ? 1 : 0;
    for (int z = 0; z < nb; z++) {
      float t1 = max(age - 0.08, 0.0);
      float E0 = 1.0 - exp(-1.9 * age), E1 = 1.0 - exp(-1.9 * t1);
      vec4 E = vec4(E0, E1, -(0.2 / 1.9) * (age - E0 / 1.9), -(0.2 / 1.9) * (t1 - E1 / 1.9));
      fw += shell(p, c, age, life * 0.8, R * 0.5, floor(N * 0.55), C.x + 101.0, mix(cA, cB, 0.5), vec3(1.0), E, 1.0) * 0.8;
    }
    col += fw * (voice > 0.5 ? 0.9 : 1.25);
    // 夜空がほんのり照らされる（ゆっくり立ち上がる・ごく弱い）
    vec2 dc = p - c;
    col += cA * 0.1 * (1.0 - exp(-age * 3.0)) * (1.0 - smoothstep(0.3 * life, life, age)) * exp(-dot(dc, dc) / (R * R * 1.5));
    // 打ち上げの名残：開いた直後だけ下に細い光の筋
    float ly = clamp((c.y - p.y) / 0.22, 0.0, 1.0);
    float lx = p.x - c.x;
    col += mix(cA, vec3(1.0), 0.5) * exp(-lx * lx / 0.000012 - age * 9.0) * (1.0 - ly) * step(p.y, c.y - 0.015) * 0.35;
  }

  // 町のシルエット（遠い層は少し明るく霞む）＋窓の明かり
  float bx1 = floor(p.x * 7.0 + 11.0);
  float far = -0.5 + 0.1 + 0.09 * hash11(bx1 * 1.7) * step(0.25, hash11(bx1 + 0.5));
  float bx2 = floor(p.x * 4.5 + 3.0);
  float near = -0.5 + 0.05 + 0.07 * hash11(bx2 * 2.3) + 0.06 * step(0.85, hash11(bx2 + 9.1));
  col = mix(col, hor * 0.55, step(p.y, far));
  vec2 wg = vec2(p.x * 80.0, p.y * 70.0);
  vec2 wid = floor(wg), wf = fract(wg);
  float win = step(hash12(wid + bx2), 0.13) * step(0.3, wf.x) * step(wf.x, 0.7) * step(0.25, wf.y) * step(wf.y, 0.75) * step(p.y, near - 0.012);
  vec3 nearC = vec3(0.004, 0.004, 0.012) + vec3(1.0, 0.75, 0.45) * win * 0.3 * (0.7 + 0.3 * hash12(wid));
  col = mix(col, nearC, step(p.y, near));

  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
