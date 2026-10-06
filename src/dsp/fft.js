/* 基数 2 の FFT（見た目用スペクトル専用。タイミング検出には使わない）。 */
(function (VJ) {
  'use strict';

  class FFT {
    constructor(n) {
      if (n & (n - 1)) throw new Error('FFT size must be a power of 2');
      this.n = n;
      this.re = new Float32Array(n);
      this.im = new Float32Array(n);
      this.cos = new Float32Array(n / 2);
      this.sin = new Float32Array(n / 2);
      for (let i = 0; i < n / 2; i++) {
        this.cos[i] = Math.cos((2 * Math.PI * i) / n);
        this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
      }
      this.rev = new Uint32Array(n);
      const bits = Math.log2(n);
      for (let i = 0; i < n; i++) {
        let r = 0;
        for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
        this.rev[i] = r;
      }
      this.window = new Float32Array(n);
      for (let i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      this.windowSum = this.window.reduce((a, b) => a + b, 0);
    }

    /** 複素 FFT（in-place、re/im を直接使う） */
    transform() {
      const n = this.n, re = this.re, im = this.im, rev = this.rev;
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let start = 0; start < n; start += size) {
          for (let k = 0; k < half; k++) {
            const wr = this.cos[k * step], wi = this.sin[k * step];
            const a = start + k, b = a + half;
            const xr = re[b] * wr - im[b] * wi;
            const xi = re[b] * wi + im[b] * wr;
            re[b] = re[a] - xr; im[b] = im[a] - xi;
            re[a] += xr; im[a] += xi;
          }
        }
      }
    }

    /** src の末尾 n サンプルにハン窓をかけ、振幅スペクトル（0..n/2）を out に書く。
     *  振幅は正弦波のピークが約 1 になるよう正規化。 */
    magnitudes(src, out) {
      const n = this.n, off = src.length - n, w = this.window, re = this.re, im = this.im;
      for (let i = 0; i < n; i++) { re[i] = src[off + i] * w[i]; im[i] = 0; }
      this.transform();
      const scale = 2 / this.windowSum;
      for (let i = 0; i <= n / 2; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * scale;
      return out;
    }
  }

  VJ.dsp = VJ.dsp || {};
  VJ.dsp.FFT = FFT;
})(globalThis.VJ = globalThis.VJ || {});
