/* 2 次 IIR（RBJ Audio EQ Cookbook）とバターワース帯域フィルタ。
 * 解析は 128 サンプル刻みで行うので、FFT より窓遅延がはるかに小さい。 */
(function (VJ) {
  'use strict';

  // バターワース 4 次 = Q の異なる 2 次を 2 段
  const BUTTER_Q = { 2: [Math.SQRT1_2], 4: [0.5411961001461969, 1.3065629648763766] };

  class Biquad {
    constructor(type, freq, q, fs) {
      this.type = type;
      this.freq = freq;
      this.q = q;
      this.fs = fs;
      this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
      this.z1 = 0; this.z2 = 0;
      this._design();
    }

    _design() {
      const w0 = (2 * Math.PI * Math.min(this.freq, this.fs * 0.49)) / this.fs;
      const cs = Math.cos(w0), sn = Math.sin(w0);
      const alpha = sn / (2 * this.q);
      let b0, b1, b2;
      if (this.type === 'lowpass') {
        b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
      } else if (this.type === 'highpass') {
        b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
      } else {
        throw new Error('unknown biquad type ' + this.type);
      }
      const a0 = 1 + alpha;
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
      this.a1 = (-2 * cs) / a0; this.a2 = (1 - alpha) / a0;
    }

    reset() { this.z1 = 0; this.z2 = 0; }

    /** in-place 処理（転置直接形 II） */
    process(buf, n) {
      const b0 = this.b0, b1 = this.b1, b2 = this.b2, a1 = this.a1, a2 = this.a2;
      let z1 = this.z1, z2 = this.z2;
      for (let i = 0; i < n; i++) {
        const x = buf[i];
        const y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        buf[i] = y;
      }
      // 非正規化数の蓄積を防ぐ
      this.z1 = Math.abs(z1) < 1e-25 ? 0 : z1;
      this.z2 = Math.abs(z2) < 1e-25 ? 0 : z2;
    }

    /** 周波数 f における振幅応答（テスト用） */
    magnitude(f) {
      const w = (2 * Math.PI * f) / this.fs;
      const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
      const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2);
      const dr = 1 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
      return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
  }

  /** lo〜hi Hz を通す帯域フィルタ（lo/hi のどちらかは null 可） */
  class BandFilter {
    constructor(spec, fs, maxBlock) {
      this.spec = spec;
      this.fs = fs;
      this.stages = [];
      const qs = BUTTER_Q[spec.order || 4];
      if (spec.lo) for (const q of qs) this.stages.push(new Biquad('highpass', spec.lo, q, fs));
      if (spec.hi && spec.hi < fs * 0.45) for (const q of qs) this.stages.push(new Biquad('lowpass', spec.hi, q, fs));
      this.buf = new Float32Array(maxBlock || 128);
      // 低域はホップ（約 2.7ms）より波の周期が長く、y² が位相で大きく脈打つ。
      // y² + (y'/ωc)² は正弦波なら位相によらず振幅² になる（直交エネルギー）ので、それを使う。
      this.quadrature = !!spec.quadrature;
      const fc = spec.qf || (spec.lo && spec.hi ? Math.sqrt(spec.lo * spec.hi) : spec.lo || spec.hi || 1000);
      this.invW = fs / (2 * Math.PI * fc);
      this.prevY = 0;
    }

    reset() { for (const s of this.stages) s.reset(); this.prevY = 0; }

    /** input[off..off+n) をフィルタし、平均二乗（エネルギー）を返す */
    energy(input, off, n) {
      const buf = this.buf;
      for (let i = 0; i < n; i++) buf[i] = input[off + i];
      for (let s = 0; s < this.stages.length; s++) this.stages[s].process(buf, n);
      let e = 0;
      if (this.quadrature) {
        let py = this.prevY;
        const k = this.invW;
        for (let i = 0; i < n; i++) {
          const y = buf[i], dy = (y - py) * k;
          e += 0.5 * (y * y + dy * dy);
          py = y;
        }
        this.prevY = py;
      } else {
        for (let i = 0; i < n; i++) e += buf[i] * buf[i];
      }
      return e / n;
    }

    magnitude(f) {
      let m = 1;
      for (const s of this.stages) m *= s.magnitude(f);
      return m;
    }
  }

  VJ.dsp = VJ.dsp || {};
  VJ.dsp.Biquad = Biquad;
  VJ.dsp.BandFilter = BandFilter;
  VJ.dsp.BUTTER_Q = BUTTER_Q;
})(globalThis.VJ = globalThis.VJ || {});
