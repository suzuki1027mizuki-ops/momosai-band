// 光過敏チェック（WCAG 2.3.1 の「一般閃光」の近似）。
// 領域ごとの相対輝度の時系列から「逆向きの変化（10% 以上）」を数え、
// 2 回で 1 フラッシュとして、どの 1 秒間でも 3 フラッシュ以下かを調べる。

/** 逆向きの変化（ヒステリシス thr）が起きたフレーム番号の配列 */
export function transitions(series, thr = 0.1) {
  const out = [];
  let dir = 0, hi = series[0], lo = series[0], ext = series[0];
  for (let i = 1; i < series.length; i++) {
    const v = series[i];
    if (dir === 0) {
      hi = Math.max(hi, v); lo = Math.min(lo, v);
      if (hi - v >= thr) { dir = -1; ext = v; } else if (v - lo >= thr) { dir = 1; ext = v; }
      continue;
    }
    if (dir > 0) {
      if (v > ext) ext = v;
      else if (ext - v >= thr) { if (Math.min(ext, v) < 0.8) out.push(i); dir = -1; ext = v; }
    } else {
      if (v < ext) ext = v;
      else if (v - ext >= thr) { if (Math.min(ext, v) < 0.8) out.push(i); dir = 1; ext = v; }
    }
  }
  return out;
}

/** 1 秒窓での最大フラッシュ数（逆向き変化 2 回 = 1 フラッシュ） */
export function maxFlashesPerSecond(series, fps, thr = 0.1) {
  const tr = transitions(series, thr);
  let best = 0, j = 0;
  for (let i = 0; i < tr.length; i++) {
    while (tr[i] - tr[j] >= fps) j++;
    best = Math.max(best, i - j + 1);
  }
  return best / 2;
}

/** luma: フレームごとの領域輝度配列 → 領域ごとの最大フラッシュ数 */
export function regionFlashes(luma, fps, thr = 0.1) {
  const n = luma[0].length, out = [];
  for (let g = 0; g < n; g++) out.push(maxFlashesPerSecond(luma.map((f) => f[g]), fps, thr));
  // 画面全体の平均でも
  out.push(maxFlashesPerSecond(luma.map((f) => f.reduce((a, b) => a + b, 0) / n), fps, thr));
  return out;
}
