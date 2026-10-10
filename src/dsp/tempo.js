/* テンポ（BPM）と拍の位置の推定 + タップテンポ。
 *  - 立ち上がりの強さ（帯域ごとの dB 上昇量の重み付き和）を約 10ms ごとに 8 秒分ためる
 *  - 0.5 秒ごとに自己相関で周期を求める（60〜200BPM、120BPM 付近をゆるく優先）
 *  - 3:2 の取り違え（付点 4 分を拍と取る）を、1.5 倍の速さの拍の位置にも同じくらい立ち上がりがあるかで直す
 *  - 倍・半分は「拍の中間（裏）にも拍と同じくらい強い立ち上がりがあれば速い方」で決める（いちばん遅い候補から順に）。
 *    速いテンポほど厳しく、いまのテンポは続けやすく、ドラムの無い曲では速くしすぎない
 *  - 周期が分かったら、櫛形の和が最大になる位置を「拍」とする
 *  - 4 拍のうちキックが最も強い位置を小節の頭（ダウンビート）とみなす
 * タップテンポ（3 回以上）はしばらく自動推定より優先する。
 * 拍の予測で先回りして光らせることはしない（人間のドラムの揺れで外れが目立つため）。用途は
 * オートの切替タイミング・拍に合わせたゆるい動き・表示。
 * 合成した曲（8 ビート・4 つ打ち・2 ビート・ハーフ・シャッフル・ファンク・ヒップホップ・ドラムンベース・
 * ドラムなし、残響・雑音あり）での評価は ISSUES.md（G8）。 */
(function (VJ) {
  'use strict';

  const DEFAULTS = {
    hopsPerFrame: 4, seconds: 8, every: 0.5, manualSec: 120,
    minBpm: 60, maxBpm: 200, // 自己相関で探す範囲
    prefBpm: 120, prefOct: 1.2, // 120BPM 付近をゆるく優先（オクターブ単位の幅）
    h2: 0.25, h3: 0.25, // 2 倍・3 倍の周期の相関を足す重み
    r32: 0.9, // 3:2：1.5 倍の速さの拍の位置の強さが、いまの拍のこれ以上ならそちらを採る
    outMin: 55, outMax: 210, outMaxDrumless: 165, // 倍・半分を選んだ結果の範囲
    thLo: 0.4, thSlope: 0.4, thRef: 130, // 速い方に上げる条件（裏の強さ / 拍の強さ）。thRef を超える速さは log2 で厳しく
    octBias: 0.3, // いまのテンポを続けやすくする幅
    hold: 2, octHold: 4, // 大きく変わったときに切り替えるまでの回数（倍・半分は長め）
    smooth: 0.3,
  };

  class TempoTracker {
    constructor(sr, hop, opts) {
      this.sr = sr;
      this.hop = hop;
      this.opts = Object.assign({}, DEFAULTS, opts || {});
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
      this.pos = new Float32Array(this.n);
      this.lastEst = 0;
      this.drumless = false;
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

    /** ドラムの無い曲か（ドラムの無い曲モード。速いテンポに上げすぎないように） */
    setDrumless(v) { this.drumless = !!v; }

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
      const x = this.lin, y = this.pos;
      let mean = 0;
      for (let i = 0; i < n; i++) { const v = this.ring[(this.idx - n + i + this.n) % this.n]; x[i] = v; mean += v; }
      mean /= n;
      let energy = 0;
      for (let i = 0; i < n; i++) { x[i] -= mean; energy += x[i] * x[i]; y[i] = x[i] > 0 ? x[i] : 0; }
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
        // 倍・3 倍の周期の相関も足して基本周期を優先、さらに 120BPM 付近をゆるく優先
        const s = r[L] + o.h2 * ac(2 * L) + o.h3 * ac(3 * L);
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
      const mu = sum / cnt, sd = Math.sqrt(Math.max(1e-12, sum2 / cnt - mu * mu));
      const conf = Math.max(0, Math.min(1, (r[best] - mu) / sd / 4));
      const from = Math.max(0, n - Math.round(o.seconds / fs));
      const bpm = this._octave(y, n, this._triple(y, n, 60 / ((best + d) * fs), from), from);

      // 推定の安定化：近ければなめらかに追従、大きく違えば数回続いたら切り替え（倍・半分は長めに）
      const rel = (p, q) => Math.abs(p - q) / q;
      const octave = Math.min(rel(bpm, this.bpm * 2), rel(bpm, this.bpm / 2)) < 0.05;
      if (!this.bpm || rel(bpm, this.bpm) < 0.04) {
        this.bpm = this.bpm ? this.bpm * (1 - o.smooth) + bpm * o.smooth : bpm;
        this.candCount = 0;
      } else if (this.cand && rel(bpm, this.cand) < 0.04) {
        if (++this.candCount >= (octave && this.conf > 0.3 ? o.octHold : o.hold)) {
          this.bpm = bpm;
          this.candCount = 0;
          this.posStrength.fill(0);
        }
      } else {
        this.cand = bpm;
        this.candCount = 1;
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

    /** 周期 P フレームの拍の位置（最良の位相）での立ち上がりの平均（out.a）と、withB なら拍の中間（裏）の平均（out.b）。
     *  各位置は ±1 フレームの最大を取る（人の演奏の揺れ・フレームの区切りの分） */
    _pulse(y, n, P, from, out, withB) {
      const pk = (p) => { const i = Math.round(p); let m = 0; for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < n && y[j] > m) m = y[j]; return m; };
      let bestA = 0, bestB = 0;
      const steps = Math.max(8, Math.round(P));
      const end = from + 1 + (withB ? P / 2 : 0);
      for (let k = 0; k < steps; k++) {
        let A = 0, B = 0, c = 0;
        for (let p = n - 3 - (k * P) / steps; p > end; p -= P) { A += pk(p); if (withB) B += pk(p - P / 2); c++; }
        if (c && A / c > bestA) { bestA = A / c; bestB = B / c; }
      }
      out.a = bestA;
      out.b = bestB;
      return out;
    }

    /** 3:2 の取り違え：70〜140BPM に寄せたテンポの 1.5 倍の拍の位置にも、同じくらい強い立ち上がりがあればそちらを採る
     *  （8 ビートで付点 4 分を拍と取る誤り。シャッフル・ハーフは 1.5 倍の位置が外れるので変わらない） */
    _triple(y, n, bpm, from) {
      const o = this.opts, fs = this.frameSec, q = this._pq || (this._pq = {});
      let t = bpm;
      while (t >= 140) t /= 2;
      while (t < 70) t *= 2;
      const a1 = this._pulse(y, n, 60 / t / fs, from, q).a;
      const a2 = this._pulse(y, n, 60 / (1.5 * t) / fs, from, q).a;
      return a1 > 0 && a2 >= o.r32 * a1 ? 1.5 * t : bpm;
    }

    /** 倍・半分の選び方：いちばん遅い候補から、拍の中間（裏）も拍と同じくらい強ければ速い方へ */
    _octave(y, n, bpm, from) {
      const o = this.opts, fs = this.frameSec, q = this._pq || (this._pq = {});
      let t = bpm;
      while (t / 2 >= o.outMin) t /= 2;
      const cur = this.bpm, sure = this.conf > 0.3;
      const top = this.drumless ? o.outMaxDrumless : o.outMax;
      while (t * 2 <= top) {
        this._pulse(y, n, 60 / t / fs, from, q, true);
        const ba = q.a > 0 ? q.b / q.a : 0;
        let th = o.thLo + o.thSlope * Math.max(0, Math.log2((t * 2) / o.thRef));
        // いまのテンポを続けやすく（倍・半分の行き来を減らす）
        if (cur && sure) {
          if (Math.abs(cur - t * 2) / cur < 0.06) th -= o.octBias;
          else if (Math.abs(cur - t) / cur < 0.06) th += o.octBias;
        }
        if (ba >= th || t < o.minBpm) t *= 2;
        else break;
      }
      return t;
    }

    /** タップテンポ（sample = 押した時点のサンプル位置） */
    tap(sample) {
      const t = this.taps;
      if (t.length && (sample - t[t.length - 1]) / this.sr > 2.0) { t.length = 0; this.tapCount = 0; }
      t.push(sample);
      this.tapCount = (this.tapCount || 0) + 1; // 間隔の計算には直近 8 回だけ使うが、小節の頭は最初のタップから数える
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
      this.cand = 0;
      this.candCount = 0;
      this.beat0 = sample;
      this.indexBase = 0;
      this.conf = 1;
      // 最初のタップを小節の頭とみなす
      this.downOffset = (((-(this.tapCount - 1)) % 4) + 4) % 4;
      this.posStrength.fill(0);
      return bpm;
    }

    clearManual() { this.manual = null; this.taps.length = 0; this.tapCount = 0; }

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
