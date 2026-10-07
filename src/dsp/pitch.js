/* PitchTracker：声の高さ（基本周波数）を YIN で推定する。
 *
 * 128 サンプルごとに push() し、約 10ms ごとに推定する。
 *   1. 2kHz の低域通過 → 約 12kHz に間引き（計算量を 1/16 にする）
 *   2. 直近 W + τmax サンプルで差分関数 d(τ) → 累積平均で正規化した d'(τ)
 *   3. d'(τ) の最小の谷とほぼ同じ深さの谷のうち、いちばん短い τ を周期とする
 *      （YIN の「固定の閾値を下回る最初の谷」だと、母音のフォルマントと重なった 3 倍音などを拾うことがある）
 *   4. 放物線補間
 * 窓は約 36ms なので、ピッチの遅れは 20ms 前後（キック検出は別系統なので影響しない）。 */
(function (VJ) {
  'use strict';
  const D = VJ.dsp;

  class PitchTracker {
    /**
     * @param sr  サンプルレート
     * @param cfg { fmin, fmax, every（推定間隔のホップ数）, thr（谷の閾値）, maxAperiodic（これより大きいと無声） }
     */
    constructor(sr, cfg) {
      const c = (this.cfg = Object.assign({ fmin: 70, fmax: 1100, every: 4, thr: 0.15, maxAperiodic: 0.3, lowpass: 2000 }, cfg || {}));
      this.sr = sr;
      this.dec = Math.max(1, Math.round(sr / 12000));
      this.srd = sr / this.dec;
      this.lp = D.BUTTER_Q[4].map((q) => new D.Biquad('lowpass', Math.min(c.lowpass, this.srd * 0.4), q, sr));
      this.tauMin = Math.max(2, Math.floor(this.srd / c.fmax) - 1);
      this.tauMax = Math.ceil(this.srd / c.fmin) + 2;
      this.W = Math.max(this.tauMax, Math.round(this.srd * 0.022));
      this.N = this.W + this.tauMax + 2;
      this.ring = new Float32Array(this.N * 2); // 末尾 N サンプルを連続で読めるように 2 倍の長さ
      this.ringPos = 0;
      this.filled = 0;
      this.decPhase = 0;
      this.tmp = new Float32Array(1024);
      this.d = new Float32Array(this.tauMax + 2);
      this.hopN = 0;
      // 結果
      this.hz = 0; // 無声なら 0
      this.aperiodic = 1; // 0 に近いほど周期的（声・楽器の音程がはっきりしている）
      this.rms = 0;
    }

    reset() { for (const s of this.lp) s.reset(); this.filled = 0; this.hopN = 0; this.hz = 0; this.aperiodic = 1; }

    /** @returns 推定を行ったら true */
    push(input, off, n) {
      const tmp = n <= this.tmp.length ? this.tmp : (this.tmp = new Float32Array(n));
      for (let i = 0; i < n; i++) tmp[i] = input[off + i];
      for (const s of this.lp) s.process(tmp, n);
      const dec = this.dec, N = this.N, ring = this.ring;
      let ph = this.decPhase;
      for (let i = 0; i < n; i++) {
        if (ph === 0) {
          const v = tmp[i];
          ring[this.ringPos] = v;
          ring[this.ringPos + N] = v;
          this.ringPos = (this.ringPos + 1) % N;
          if (this.filled < N) this.filled++;
        }
        ph = (ph + 1) % dec;
      }
      this.decPhase = ph;
      if (++this.hopN < this.cfg.every) return false;
      this.hopN = 0;
      if (this.filled < N) { this.hz = 0; this.aperiodic = 1; return true; }
      this._estimate();
      return true;
    }

    _estimate() {
      const W = this.W, tMax = this.tauMax, tMin = this.tauMin, d = this.d, ring = this.ring;
      const x0 = this.ringPos; // ring[x0 .. x0+N) が古い順
      let e = 0;
      for (let j = 0; j < W; j++) { const v = ring[x0 + j]; e += v * v; }
      this.rms = Math.sqrt(e / W);
      if (e < 1e-12) { this.hz = 0; this.aperiodic = 1; return; }
      // 差分関数と累積平均正規化
      d[0] = 1;
      let cum = 0;
      for (let t = 1; t <= tMax; t++) {
        let s = 0;
        const b = x0 + t;
        for (let j = 0; j < W; j++) { const df = ring[x0 + j] - ring[b + j]; s += df * df; }
        cum += s;
        d[t] = cum > 0 ? (s * t) / cum : 1;
      }
      // 最小の谷
      let best = tMin, m = Infinity;
      for (let t = tMin; t <= tMax; t++) if (d[t] < m) { m = d[t]; best = t; }
      // 最小とほぼ同じ深さの谷のうち、いちばん短い周期を選ぶ（最小の谷は本当の周期の整数倍のことがある）
      const lim = Math.min(this.cfg.thr, m * 1.5 + 0.05);
      for (let t = tMin + 1; t < tMax; t++) {
        if (d[t] <= lim && d[t] <= d[t - 1] && d[t] <= d[t + 1]) { best = t; break; }
      }
      const ap = d[best];
      this.aperiodic = ap;
      if (ap > this.cfg.maxAperiodic || best <= tMin || best >= tMax) { this.hz = 0; return; }
      // 放物線補間
      const a = d[best - 1], b = d[best], c = d[best + 1];
      const den = a - 2 * b + c;
      const shift = den > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      this.hz = this.srd / (best + shift);
    }
  }

  /** Hz → MIDI ノート番号（小数） */
  PitchTracker.hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

  D.PitchTracker = PitchTracker;
})(globalThis.VJ = globalThis.VJ || {});
