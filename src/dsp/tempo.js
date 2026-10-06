/* テンポ（BPM）と拍の位置の推定 + タップテンポ。
 *  - 立ち上がりの強さ（帯域ごとの dB 上昇量の重み付き和）を約 10ms ごとに 8 秒分ためる
 *  - 0.5 秒ごとに自己相関で周期を求める（60〜200BPM、120BPM 付近を優先、倍・半分の誤りを抑える）
 *  - 周期が分かったら、櫛形の和が最大になる位置を「拍」とする
 *  - 4 拍のうちキックが最も強い位置を小節の頭（ダウンビート）とみなす
 * タップテンポ（3 回以上）はしばらく自動推定より優先する。
 * 拍の予測で先回りして光らせることはしない（人間のドラムの揺れで外れが目立つため）。用途は
 * オートの切替タイミング・拍に合わせたゆるい動き・表示。 */
(function (VJ) {
  'use strict';

  class TempoTracker {
    constructor(sr, hop, opts) {
      this.sr = sr;
      this.hop = hop;
      this.opts = Object.assign({ hopsPerFrame: 4, seconds: 8, minBpm: 60, maxBpm: 200, prefBpm: 120, prefOct: 0.9, every: 0.5, manualSec: 120 }, opts || {});
      this.fpf = this.opts.hopsPerFrame;
      this.frameSamples = hop * this.fpf;
      this.frameSec = this.frameSamples / sr;
      this.n = Math.ceil(this.opts.seconds / this.frameSec);
      this.ring = new Float32Array(this.n);
      this.idx = 0;
      this.filled = 0;
      this.acc = 0;
      this.hopIn = 0;
      this.frameCount = 0; // 追加した OSF フレーム数
      this.lin = new Float32Array(this.n);
      this.lastEst = 0;
      this.reset();
    }

    reset() {
      this.period = 0; // サンプル数
      this.beat0 = 0; // 拍の基準（サンプル位置。最近の拍に置き直す）
      this.indexBase = 0; // beat0 を置き直しても拍番号が連続するように足す数
      this.conf = 0;
      this.bpm = 0;
      this.cand = 0;
      this.candCount = 0;
      this.downOffset = 0; // 0..3
      this.posStrength = new Float32Array(4);
      this.manual = null;
      this.taps = [];
    }

    /** 1 ホップごとに立ち上がりの強さを入れる */
    push(strength, sampleCount) {
      this.acc += strength;
      if (++this.hopIn < this.fpf) return;
      this.ring[this.idx] = this.acc;
      this.idx = (this.idx + 1) % this.n;
      if (this.filled < this.n) this.filled++;
      this.acc = 0;
      this.hopIn = 0;
      this.frameCount++;
      if ((sampleCount - this.lastEst) / this.sr >= this.opts.every) {
        this.lastEst = sampleCount;
        this._estimate(sampleCount);
      }
    }

    /** キックの強さを拍の位置（4 拍のどこか）ごとに積算 → ダウンビートの推定 */
    noteKick(strength, sample) {
      if (!this.period) return;
      const b = Math.round((sample - this.beat0) / this.period);
      const off = Math.abs(sample - (this.beat0 + b * this.period));
      if (off > this.period * 0.15) return;
      const pos = (((b + this.indexBase) % 4) + 4) % 4;
      for (let i = 0; i < 4; i++) this.posStrength[i] *= 0.97;
      this.posStrength[pos] += strength;
      let best = 0;
      for (let i = 1; i < 4; i++) if (this.posStrength[i] > this.posStrength[best]) best = i;
      // 今の小節頭より 3 割以上強い位置が出たときだけ入れ替える（全拍が同じ強さでも安定させる）
      if (this.posStrength[best] > 1.3 * this.posStrength[this.downOffset]) this.downOffset = best;
    }

    _estimate(sampleCount) {
      if (this.manual && sampleCount < this.manual.until) return;
      if (this.manual) this.manual = null;
      const n = this.filled;
      if (n < this.n * 0.5) return;
      // 時系列を古い順に並べ、平均を引く
      const x = this.lin;
      let mean = 0;
      for (let i = 0; i < n; i++) { const v = this.ring[(this.idx - n + i + this.n) % this.n]; x[i] = v; mean += v; }
      mean /= n;
      let energy = 0;
      for (let i = 0; i < n; i++) { x[i] -= mean; energy += x[i] * x[i]; }
      if (energy < 1e-6) { this.conf *= 0.8; return; }
      const fs = this.frameSec, o = this.opts;
      const lmin = Math.floor(60 / o.maxBpm / fs), lmax = Math.ceil(60 / o.minBpm / fs);
      const ac = (L) => {
        if (L >= n) return 0;
        let s = 0;
        for (let i = L; i < n; i++) s += x[i] * x[i - L];
        return s / (n - L);
      };
      const r = this._r && this._r.length >= lmax + 2 ? this._r : (this._r = new Float32Array(lmax + 2));
      for (let L = lmin - 1; L <= lmax + 1; L++) r[L] = ac(L);
      let best = -1, bestS = -Infinity, sum = 0, sum2 = 0, cnt = 0;
      for (let L = lmin; L <= lmax; L++) {
        // 倍の周期の相関も足して基本周期を優先、さらに 120BPM 付近を優先
        const s = r[L] + 0.5 * ac(2 * L) + 0.25 * ac(3 * L);
        const bpm = 60 / (L * fs);
        const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / o.prefBpm) / o.prefOct, 2));
        const sw = s * w;
        sum += r[L]; sum2 += r[L] * r[L]; cnt++;
        if (sw > bestS) { bestS = sw; best = L; }
      }
      if (best < 0) return;
      // 放物線補間で周期を細かく
      const a = r[best - 1], b = r[best], c = r[best + 1];
      const den = a - 2 * b + c;
      const d = Math.abs(den) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      const L = best + d;
      const mu = sum / cnt, sd = Math.sqrt(Math.max(1e-12, sum2 / cnt - mu * mu));
      const conf = Math.max(0, Math.min(1, (r[best] - mu) / sd / 4));
      let bpm = 60 / (L * fs);
      // 倍・半分の取り違えを補正：90〜180BPM に入るように、相関が十分あれば倍・半分を採用
      const half = Math.round(L / 2), dbl = Math.round(L * 2);
      if (bpm < 90 && half >= lmin - 1 && r[half] >= 0.5 * r[best]) bpm *= 2;
      else if (bpm >= 180 && ac(dbl) >= 0.5 * r[best]) bpm /= 2;

      // 推定の安定化：近ければなめらかに追従、大きく違えば 2 回続いたら切り替え
      if (!this.bpm || Math.abs(bpm - this.bpm) / this.bpm < 0.04) {
        this.bpm = this.bpm ? this.bpm * 0.7 + bpm * 0.3 : bpm;
        this.candCount = 0;
      } else if (this.cand && Math.abs(bpm - this.cand) / this.cand < 0.04 && ++this.candCount >= 2) {
        this.bpm = bpm;
        this.candCount = 0;
        this.posStrength.fill(0);
      } else {
        this.cand = bpm;
        if (!this.candCount) this.candCount = 1;
      }
      this.conf = this.conf * 0.6 + conf * 0.4;
      this.period = (60 / this.bpm) * this.sr;

      // 拍の位置：直近 4 秒で櫛形の和が最大になるずれ
      const P = this.period / this.frameSamples;
      const K = Math.max(2, Math.floor(4 / (60 / this.bpm)));
      let bestPhi = 0, bestSc = -Infinity;
      const steps = Math.max(8, Math.round(P));
      for (let k = 0; k < steps; k++) {
        const phi = (k * P) / steps;
        let sc = 0;
        for (let j = 0; j < K; j++) {
          const pos = n - 1 - phi - j * P;
          if (pos < 1) break;
          const i0 = Math.floor(pos), t = pos - i0;
          sc += x[i0] * (1 - t) + x[i0 + 1 < n ? i0 + 1 : i0] * t;
        }
        if (sc > bestSc) { bestSc = sc; bestPhi = phi; }
      }
      // 最新フレームの終わり = sampleCount。そこから phi フレーム前が拍
      const newBeat0 = sampleCount - (bestPhi + 0.5) * this.frameSamples;
      // 基準の拍を最近の拍に置き直す。拍番号は indexBase で連続させ、位相はなめらかに寄せる
      if (this.beat0) {
        const k = Math.round((newBeat0 - this.beat0) / this.period);
        const target = this.beat0 + k * this.period;
        this.beat0 = target + (newBeat0 - target) * 0.5;
        this.indexBase += k;
      } else {
        this.beat0 = newBeat0;
      }
    }

    /** タップテンポ（sample = 押した時点のサンプル位置） */
    tap(sample) {
      const t = this.taps;
      if (t.length && (sample - t[t.length - 1]) / this.sr > 2.0) t.length = 0;
      t.push(sample);
      if (t.length > 8) t.shift();
      if (t.length < 3) return 0;
      const iv = [];
      for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]);
      iv.sort((a, b) => a - b);
      const per = iv[Math.floor(iv.length / 2)];
      const bpm = (60 * this.sr) / per;
      if (bpm < 40 || bpm > 240) return 0;
      this.manual = { until: sample + this.opts.manualSec * this.sr };
      this.period = per;
      this.bpm = bpm;
      this.beat0 = sample;
      this.indexBase = 0;
      this.conf = 1;
      // 最初のタップを小節の頭とみなす
      this.downOffset = (((-(t.length - 1)) % 4) + 4) % 4;
      this.posStrength.fill(0);
      return bpm;
    }

    clearManual() { this.manual = null; this.taps.length = 0; }

    /** 現在（sample）の拍の状態 */
    state(sample, out) {
      out = out || {};
      if (!this.period) { out.bpm = 0; out.phase = 0; out.conf = 0; out.beatIndex = 0; out.bar = 0; out.manual = false; return out; }
      const pos = (sample - this.beat0) / this.period;
      const fl = Math.floor(pos);
      const bi = fl + this.indexBase;
      out.bpm = this.bpm;
      out.phase = pos - fl;
      out.conf = this.conf;
      out.beatIndex = bi;
      out.bar = ((((bi - this.downOffset) % 4) + 4) % 4 + out.phase) / 4; // 0..1（小節内）
      out.manual = !!this.manual;
      return out;
    }
  }

  VJ.dsp = VJ.dsp || {};
  VJ.dsp.TempoTracker = TempoTracker;
})(globalThis.VJ = globalThis.VJ || {});
