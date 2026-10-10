/* Shift+3: 花火 — 線香花火。こよりの先で揺れる火球から、枝分かれする火花（松葉）が四方に散る。
 * 音量で火花が増えて長くなり（静かなときは小さな火花がぽつぽつ）、キックで一斉に散り、キメでは大きく長い火花が
 * はじける。スネアでも少し散る。ドラムの無い歌・話し声では、音程の変わり目で散る。
 * 火花は細い線なので光る面積が小さく、キックごとに散っても広い範囲の明るさは変わらない（光過敏対策）。
 * 火花ごとの値（向き・経過秒・長さ・乱数）は JS 側で持って渡し、シェーダは火球から見て火花の近くにある画素だけ計算する。 */
(function (VJ) {
  'use strict';
  const MAXS = 56; // 同時に出せる火花の数
  const TAU = Math.PI * 2;

  VJ.scenes.register({
    id: 'fireworks', key: 's3', name: 'Fireworks', nameJa: '花火', aliases: ['はなび', '線香花火'], cost: 1.5,
    params: [
      { id: 'amount', name: '量', min: 0.5, max: 1.5, def: 1 },
      { id: 'size', name: '大きさ', min: 0.6, max: 1.4, def: 1 },
      { id: 'life', name: '残り時間', min: 0.5, max: 2, def: 1 },
    ],
    init(st) {
      st.sp = new Float32Array(MAXS * 4);
      for (let i = 0; i < MAXS; i++) st.sp[i * 4 + 1] = 99;
      st.next = 0; st.acc = 0; st.heat = 0; st.t = 0; st.n = 0; st.lastKick = -9;
    },
    update(st, f, dt, fx) {
      st.t += dt;
      const sp = st.sp;
      for (let i = 0; i < MAXS; i++) sp[i * 4 + 1] += dt;
      st.heat += (f.level - st.heat) * Math.min(1, dt / 0.35);
      const amt = fx.param[0], size = fx.param[1];
      // 0..1 の擬似乱数（出した順で決まる。テストで再現できるように Math.random は使わない）
      const rnd = () => { st.n = (st.n + 1) % 65536; const x = Math.sin(st.n * 12.9898) * 43758.5453; return x - Math.floor(x); };
      // 火花を k 本出す。経過秒を少し負にして、同じフレームに全部は現れないようにする
      const emit = (k, lenK) => {
        for (let j = 0; j < k; j++) {
          const o = st.next * 4;
          st.next = (st.next + 1) % MAXS;
          sp[o] = rnd() * TAU;
          sp[o + 1] = -rnd() * 0.04;
          sp[o + 2] = (0.09 + 0.2 * rnd()) * lenK * size;
          sp[o + 3] = rnd();
        }
      };
      // ふだんの火花：音量で増える・長くなる（無音でも少しだけ）
      st.acc += (2 + 44 * st.heat * st.heat) * amt * dt * (f.active ? 1 : 0.5);
      const k = Math.min(6, Math.floor(st.acc));
      st.acc -= Math.floor(st.acc);
      if (k) emit(k, 0.55 + 0.6 * st.heat);
      const fl = f.onsetFlags | 0;
      if (fl & 8) emit(Math.round(16 * amt), 1.7); // キメ：大きく長い火花
      else if (fl & 1) emit(Math.round((4 + 8 * (f.kickEv[1] || 0.6)) * amt), 1.25);
      else if (fl & 2) emit(Math.round(4 * amt), 1.0);
      // ドラムが無いとき：歌・話し声の音程の変わり目で
      if ((fl & 128) && f.voiced > 0.4 && st.t - st.lastKick > 1.5) emit(Math.round(5 * amt), 1.0);
      if (fl & 1) st.lastKick = st.t;
      return { u_sp: sp, u_heat: st.heat };
    },
    frag: `
uniform vec4 u_sp[${MAXS}];  // 火花：(向き, 経過秒（負 = まだ出ていない）, 長さ, 乱数)
uniform float u_heat;        // 音量（ゆっくり追従）

float segD(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0));
}

void main() {
  vec2 p = uvc();
  float life = 0.3 * u_param.z;
  vec3 gold = vec3(1.0, 0.72, 0.36);
  // 火球：こよりの先でゆっくり揺れる
  float sw = 0.035 * sin(u_time * 1.1) + 0.012 * sin(u_time * 2.7);
  vec2 top = vec2(0.0, 0.62);
  vec2 c = vec2(sw, 0.07 - 0.5 * sw * sw);
  vec2 dc = p - c;
  float rc = length(dc);

  // 夜の暗がり：下ほどわずかに明るい＋火球のまわりの暖かい光（広く・弱く）
  vec3 col = mix(vec3(0.012, 0.012, 0.03), vec3(0.002, 0.002, 0.008), smoothstep(-0.5, 0.5, p.y)) + u_pal[2] * 0.02;
  col += gold * ((0.03 + 0.05 * u_heat) * exp(-rc * rc * 9.0) + 0.012 * exp(-rc * 2.0)) * (0.9 + 0.1 * idle());
  // こより
  col += vec3(0.2, 0.14, 0.08) * smoothstep(0.004, 0.0015, segD(p, top, c + vec2(0.0, 0.012))) * (0.5 + 0.5 * smoothstep(0.6, 0.1, p.y));

  // 火花
  float w = max(0.002, 1.2 / u_res.y);
  float g = 0.35;                                  // 重力で少し垂れる
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAXS}; i++) {
    vec4 s = u_sp[i];
    float age = s.y, len = s.z;
    if (age < 0.0 || age > life) continue;
    vec2 d = vec2(cos(s.x), sin(s.x));
    float al = dot(dc, d), ac = dot(dc, vec2(-d.y, d.x));
    // 火球から見てこの火花（と枝）の近くにある画素だけ
    if (al < -0.02 || al > len * 1.5 + 0.03 || abs(ac) > len * 0.6 + 0.05) continue;
    float k = age / life;
    float head = len * (1.0 - exp(-age * 45.0));    // すぐ伸びきる
    float tail = len * 0.9 * smoothstep(0.15, 1.0, k); // 根元から消えていく
    float fade = 1.0 - smoothstep(0.55, 1.0, k);
    float u = clamp(al, tail, head);
    float I = exp(-dot(vec2(al - u, ac + g * u * u * d.x), vec2(al - u, ac + g * u * u * d.x)) / (w * w)) * (0.35 + 0.65 * u / max(len, 1e-4));
    // 松葉：先のほうで 3 本に枝分かれ
    float ub = len * (0.5 + 0.3 * fract(s.w * 7.13));
    vec2 pb = c + d * ub - vec2(0.0, g * ub * ub);
    float tb = clamp((age - 0.03) * 30.0, 0.0, 1.0) * step(ub, head + 1e-4);
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      float ang = s.x + (fj - 1.0) * (0.5 + 0.35 * fract(s.w * 31.7 + fj * 0.37)) + (fract(s.w * 53.1 + fj * 0.19) - 0.5) * 0.3;
      float bl = len * (0.28 + 0.2 * fract(s.w * 17.3 + fj * 0.61)) * tb;
      vec2 bd = vec2(cos(ang), sin(ang));
      float db = segD(p, pb + bd * bl * 0.8 * smoothstep(0.3, 1.0, k), pb + bd * bl);
      I += exp(-db * db / (w * w)) * 0.8 * tb;
    }
    // 色：出た瞬間は白に近く、冷えると金色（パレットの色をわずかに混ぜる）
    vec3 sc = mix(gold, pal(s.w * 3.0), 0.22);
    acc += mix(sc, vec3(1.0, 0.95, 0.85), 0.5 * (1.0 - k)) * I * fade;
  }
  col += acc * 1.4;

  // 火球（ふつふつと煮える）
  float rb = (0.011 + 0.007 * u_heat) * u_param.y * (1.0 + 0.06 * sin(u_time * 31.0) + 0.05 * sin(u_time * 47.0));
  float boil = 0.8 + 0.2 * vnoise(dc * 300.0 + u_time * 6.0);
  col += vec3(1.0, 0.55, 0.2) * smoothstep(rb, rb * 0.5, rc) * boil * (0.7 + 0.3 * u_heat);
  col += vec3(1.0, 0.9, 0.7) * smoothstep(rb * 0.6, 0.0, rc) * 0.6;
  col += vec3(1.0, 0.5, 0.2) * exp(-rc * rc / (rb * rb * 6.0)) * 0.35;
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
