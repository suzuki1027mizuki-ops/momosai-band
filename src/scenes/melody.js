/* Shift+2: メロディ線 — 声や旋律の音程を光の線で描く（カラオケの音程バーのように右から左へ流れる）。
 * 横 = 時間（右寄りの縦線が「今」、左ほど昔・約 2.7 秒）、縦 = 音程（半音ごとの段。C の段は少し明るい）。
 * 線の太さはその時の音量、色は音程。無声のところで線が切れる。今の位置に光る点、音の変わり目に小さなきらめき。
 * キックは縦の小節線のように左へ流れる。和音の多いバンド演奏（音程が取れない）では線が薄くなり、
 * 代わりにスペクトルで段が淡く光る背景が主役になる。表示する音域は最近の音程に合わせてゆっくり移動。 */
(function (VJ) {
  'use strict';
  const NB = 32; // 太さの履歴の区間数（音程の履歴と同じ約 2.7 秒）
  const NN = 6; // きらめきの数
  const JUMP = 2.5 / 48; // これ以上の音程の跳びでは線をつながない（半音 2.5 個）
  VJ.scenes.register({
    id: 'melody', key: 's2', name: 'Melody', nameJa: 'メロディ線', aliases: ['メロディ', '音程'], cost: 1,
    params: [
      { id: 'range', name: '音域（オクターブ）', min: 1, max: 4, def: 2, step: 0.1 },
      { id: 'width', name: '線の太さ', min: 0.4, max: 2, def: 1 },
      { id: 'back', name: '背景の光', min: 0, max: 1, def: 0.6 },
    ],
    init(st) {
      st.lv = new Float32Array(NB);
      st.acc = 0; st.binT = 0; st.lvl = 0;
      st.center = 0.6; st.target = 0.6;
      st.qual = 0; st.vo = 0;
      st.notes = new Float32Array(NN * 3);
      for (let i = 0; i < NN; i++) st.notes[i * 3] = 99;
      st.noteN = -1; st.kickN = -1; st.sinceNote = 1;
    },
    update(st, f, dt) {
      const sr = f.sampleRate || 48000;
      // 音程の履歴は 1024 サンプルに 1 点 × 128 点。太さの履歴は 4 点で 1 区間
      const histSec = (128 * 1024) / sr, binSec = (4 * 1024) / sr;
      st.lvl += (f.level - st.lvl) * Math.min(1, dt / 0.08);
      st.vo += (f.voiced - st.vo) * Math.min(1, dt / 0.3);
      st.acc += st.lvl * dt; st.binT += dt;
      for (let g = 0; st.binT >= binSec && g < NB; g++) {
        st.lv.copyWithin(0, 1);
        st.lv[NB - 1] = st.acc / st.binT;
        st.acc = 0; st.binT -= binSec;
      }
      if (st.binT >= binSec) st.binT = 0;

      // 表示の中心：履歴の有声部分の平均。中心から離れたときだけ動かし、ゆっくり追う
      const ph = f.pitchHist;
      let sum = 0, n = 0, good = 0;
      for (let i = 0; i < ph.length; i++) {
        const v = ph[i];
        if (v < 0) continue;
        sum += v; n++;
        if (i >= ph.length - 64 && i > 0 && ph[i - 1] >= 0 && Math.abs(v - ph[i - 1]) < JUMP) good++;
      }
      if (n >= 12) {
        const m = sum / n;
        if (Math.abs(m - st.target) > 0.06) st.target = m;
      }
      st.center += (st.target - st.center) * Math.min(1, dt / 1.2);
      // 線のつながり具合（歌 = 高い、話し声 = 中くらい、和音の多い演奏 = 低い）
      st.qual += (Math.min(1, good / 40) - st.qual) * Math.min(1, dt / 0.8);

      // きらめき：音程の変わり目・音の出だし（有声のときだけ。間隔 0.12 秒以上）
      for (let i = 0; i < NN; i++) st.notes[i * 3] += dt;
      st.sinceNote += dt;
      const changed = (st.noteN >= 0 && f.noteN !== st.noteN) || (st.kickN >= 0 && f.kickN !== st.kickN);
      if (changed && f.voiced > 0.5 && st.sinceNote >= 0.12) {
        st.notes.copyWithin(3, 0, (NN - 1) * 3);
        st.notes[0] = 0; st.notes[1] = f.pitch; st.notes[2] = 0.6 + 0.4 * f.voiced;
        st.sinceNote = 0;
      }
      st.noteN = f.noteN; st.kickN = f.kickN;
      return { u_lv: st.lv, u_lvlNow: st.lvl, u_center: st.center, u_qual: st.qual, u_histSec: histSec, u_notes: st.notes, u_voS: st.vo };
    },
    frag: `
uniform float u_lv[${NB}];
uniform vec3 u_notes[${NN}];
uniform float u_lvlNow, u_center, u_qual, u_histSec, u_voS;

#define XNOW 0.84
#define JUMP ${JUMP.toFixed(5)}

float gC; // 表示の中心の音程（C2〜C6 の外が画面の 1 割より内側に入らないように制限）
// 音程（0..1）⇔ 画面の高さ（0..1）。音域 u_param.x オクターブが画面の 8 割
float pitchY(float p) { return 0.5 + (p - gC) / (u_param.x * 0.25) * 0.8; }
float yPitch(float y) { return gC + (y - 0.5) / 0.8 * u_param.x * 0.25; }
// 履歴の位置 hx（0 = 昔、1 = 今）の音量
float lvAt(float hx) {
  float b = clamp(hx * ${NB}.0 - 0.5, 0.0, ${NB - 1}.0);
  int i0 = int(floor(b));
  int i1 = min(i0 + 1, ${NB - 1});
  float v = mix(u_lv[i0], u_lv[i1], fract(b));
  return mix(v, u_lvlNow, smoothstep(1.0 - 1.5 / ${NB}.0, 1.0, hx));
}
float segDist(vec2 p, vec2 a, vec2 b, out float t) {
  vec2 ab = b - a;
  t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  return length(p - a - ab * t);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float A = u_res.x / u_res.y;
  float hr0 = min(u_param.x * 0.125, 0.5);
  gC = clamp(u_center, hr0, 1.0 - hr0);
  vec2 q = vec2(uv.x * A, uv.y);              // 縦 1 の座標（距離はこれで測る）
  float scroll = XNOW / u_histSec;             // 線が左へ流れる速さ（画面幅/秒）
  float pRow = yPitch(uv.y);
  float semi = pRow * 48.0;                    // 半音単位（0 = C2）
  float spp = fwidth(semi);                    // 1 画素あたりの半音
  float drift = u_time * 0.01;

  // 背景：ピアノロール風の段（黒鍵の段は暗め）、半音ごとの細い線、C の線は色付き
  float key = mod(floor(semi + 0.5), 12.0);
  float blackKey = (key == 1.0 || key == 3.0 || key == 6.0 || key == 8.0 || key == 10.0) ? 1.0 : 0.0;
  vec3 col = mix(vec3(0.005, 0.006, 0.018), u_pal[2] * 0.06, 0.25 + 0.3 * uv.y) * (1.0 - 0.45 * blackKey);
  float rowLine = smoothstep(spp * 1.5, 0.0, abs(fract(semi + 0.5) - 0.5));
  float isC = key == 0.0 ? 1.0 : 0.0;
  col += mix(vec3(0.04), pal(pRow * 2.0 + drift) * 0.2, isC) * rowLine * (0.6 + 0.4 * smoothstep(0.0, XNOW, uv.x));

  // スペクトルの背景：その段の音程の周波数に音があれば段が光り、今の位置から左へ流れて消える
  float hz = 65.406 * exp2(pRow * 4.0);
  float sx = log2(hz / 40.0) / log2(400.0);
  float sv = smoothstep(0.35, 0.9, specS(sx));
  float rowShape = smoothstep(0.0, 0.8, 1.0 - abs(fract(semi + 0.5) - 0.5) * 2.0);
  float ago = XNOW - uv.x;                     // 今の位置からの距離（画面幅）
  float trail = ago > 0.0 ? exp(-ago * 2.2) : exp(ago * 25.0);
  float streak = 0.55 + 0.45 * vnoise(vec2((uv.x + u_time * scroll) * 9.0, floor(semi + 0.5) * 3.1));
  float back = u_param.z * (0.7 - 0.4 * u_qual);
  col += pal(pRow * 2.0 + drift) * sv * rowShape * trail * streak * back;

  // キック：小節線のような縦線が左へ流れる
  float bars = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 ev = u_kickEv[i];
    float x = XNOW - ev.x * scroll;
    if (x < -0.02) continue;
    float d = (uv.x - x) * A;
    bars += exp(-d * d * 9000.0) * ev.y * smoothstep(-0.02, 0.2, x);
  }
  col += u_pal[1] * bars * 0.045 * smoothstep(0.0, 0.25, uv.y) * smoothstep(1.0, 0.75, uv.y);

  // 今の音程の段を横いっぱいに淡く照らす（声が出ている間）
  float dyNow = uv.y - pitchY(u_pitch);
  col += pal(u_pitch * 2.0 + drift + 0.05) * exp(-dyNow * dyNow * 300.0) * (0.015 + 0.05 * u_voS)
    * (0.4 + 0.6 * smoothstep(0.0, XNOW, uv.x));

  // 今の位置の縦線
  float dNow = (uv.x - XNOW) * A;
  col += pal(u_pitch * 2.0 + drift) * exp(-dNow * dNow * 20000.0) * (0.06 + 0.06 * u_voiced);

  // メロディ線：左右の近くの点（品質で 14 点 / 10 点）を結ぶ区間までの距離。
  // 無声・大きな跳びでは切る（端は丸く）
  float hx = uv.x / XNOW;
  int nPts = u_quality > 0.5 ? 14 : 10;
  float hw = float(nPts / 2);       // 片側の点の数
  float i0 = floor(hx * 127.0) - hw + 1.0;
  float best = 1e3, bestP = 0.0, bestHx = 0.0;
  float pPrev = -1.0;
  vec2 aPrev = vec2(0.0);
  for (int k = 0; k < 14; k++) {
    if (k >= nPts) break;
    float ii = i0 + float(k);
    if (ii < 0.0 || ii > 127.0) { pPrev = -1.0; continue; }
    float pc = pitchHist(ii / 127.0);
    vec2 pt = vec2(ii / 127.0 * XNOW * A, pitchY(pc));
    if (pc >= 0.0) {
      float t = 0.0, d;
      if (pPrev >= 0.0 && abs(pc - pPrev) < JUMP) {
        d = segDist(q, aPrev, pt, t);
        if (d < best) { best = d; bestP = mix(pPrev, pc, t); bestHx = (ii - 1.0 + t) / 127.0; }
      } else {
        d = length(q - pt);
        if (d < best) { best = d; bestP = pc; bestHx = ii / 127.0; }
      }
    }
    pPrev = pc;
    aPrev = pt;
  }
  float lw = max((0.005 + 0.022 * lvAt(bestHx)) * u_param.y, 1.3 / u_res.y);
  float hr = lw * 1.4 + 0.007;                 // にじみの幅
  float age = smoothstep(0.0, 0.45, bestHx);   // 昔の部分ほど淡く
  // 調べた点の範囲の端で光が切れて四角く見えないよう、端に近いほど弱める
  float win = 1.0 - smoothstep(hw - 3.0, hw - 1.0, abs(hx - bestHx) * 127.0);
  float amt = age * win * mix(0.45, 1.0, u_qual);
  vec3 lc = pal(bestP * 2.0 + drift + 0.05);
  float core = exp(-best * best / (lw * lw));
  float halo = exp(-best * best / (hr * hr));
  col += (mix(lc, vec3(1.0), 0.55 * core) * core * 0.9 + lc * halo * 0.4) * amt;
  // 線の下に垂れる淡い光のカーテン（線に厚みを出す。線の端では横にぼかす）
  float below = pitchY(bestP) - uv.y;
  float dxc = (hx - bestHx) * XNOW * A;
  float strand = 0.55 + 0.45 * vnoise(vec2((uv.x + u_time * scroll) * 60.0, uv.y * 3.0));
  col += lc * step(0.0, below) * exp(-below * 5.0) * exp(-dxc * dxc * 8000.0) * 0.13 * strand * amt;

  // 今の点：声が出ている間は明るく、無声の間は淡い輪だけ（直前の音程の位置）
  vec2 np = vec2(XNOW * A, pitchY(u_pitch));
  float dn = length(q - np);
  float nr = (0.008 + 0.018 * u_lvlNow) * u_param.y;
  vec3 nc = pal(u_pitch * 2.0 + drift + 0.05);
  col += mix(nc, vec3(1.0), 0.6) * exp(-dn * dn / (nr * nr)) * u_voiced;
  col += nc * exp(-dn / (nr + 0.015)) * (0.12 + 0.3 * u_voiced);
  col += nc * exp(-pow((dn - 0.03) / max(0.003, 1.0 / u_res.y), 2.0)) * 0.25 * (1.0 - u_voiced);

  // きらめき：音の変わり目の位置（線の上）に十字の光と小さな輪。線と一緒に左へ流れる
  float th = max(0.0025, 0.7 / u_res.y);      // 細い線の太さ（低い解像度でも 1 画素弱は残す）
  for (int i = 0; i < ${NN}; i++) {
    vec3 ev = u_notes[i];
    float a = ev.x;
    if (a > 1.2) continue;
    float ex = 1.0 - a / u_histSec;
    float pe = pitchHist(ex);
    vec2 sp = vec2(ex * XNOW * A, pitchY(pe >= 0.0 ? pe : ev.y));
    vec2 d = rot(a * 1.5) * (q - sp);
    float s = (0.025 + 0.03 * ev.z) * (1.0 - 0.4 * a);
    float star = exp(-abs(d.x) / th) * exp(-abs(d.y) / s * 3.0) + exp(-abs(d.y) / th) * exp(-abs(d.x) / s * 3.0);
    float ring = exp(-pow((length(d) - a * 0.12) / (th + 0.01 * a), 2.0));
    float fade = ev.z * exp(-a * 3.0) * smoothstep(0.0, 0.03, a);
    col += mix(vec3(1.0), pal(pe * 2.0 + drift + 0.3), 0.4) * (star * 0.9 + ring * 0.3) * fade;
  }
  col *= 1.0 + 0.1 * idle();
  outColor = vec4(col, 1.0);
}`,
  });
})(globalThis.VJ = globalThis.VJ || {});
