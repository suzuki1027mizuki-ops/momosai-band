/* 決定的なバンド音源シンセ（デモ再生 + テスト用の正解付き音源）。
 * DOM に依存しないので Node のテストからも使える。 */
(function (VJ) {
  'use strict';

  const NOTE = { E1: 41.2, F1: 43.65, G1: 49.0, A1: 55.0, B1: 61.74, C2: 65.41, D2: 73.42, E2: 82.41 };

  class Mixer {
    constructor(sr, seconds) {
      this.sr = sr;
      this.buf = new Float32Array(Math.ceil(sr * seconds));
      this.onsets = { kick: [], snare: [], hat: [], crash: [] };
    }

    add(start, fn, dur) {
      const sr = this.sr, i0 = Math.max(0, Math.round(start * sr)), n = Math.round(dur * sr);
      const b = this.buf;
      for (let i = 0; i < n && i0 + i < b.length; i++) b[i0 + i] += fn(i / sr, i);
    }

    kick(t, vel, rnd) {
      this.onsets.kick.push(t);
      let ph = 0;
      const sr = this.sr;
      this.add(t, (x) => {
        const f = 48 + 120 * Math.exp(-x / 0.03);
        ph += (2 * Math.PI * f) / sr;
        const click = x < 0.003 ? (rnd() * 2 - 1) * 0.15 * (1 - x / 0.003) : 0;
        return (Math.sin(ph) * Math.exp(-x / 0.14) + click) * 0.9 * vel;
      }, 0.45);
    }

    snare(t, vel, rnd) {
      this.onsets.snare.push(t);
      // スナッピー：約 1.5〜6kHz の帯域ノイズ（2 次共振）＋ 胴鳴り 185Hz
      const sr = this.sr, f0 = 3200, q = 0.8;
      const w0 = (2 * Math.PI * f0) / sr, al = Math.sin(w0) / (2 * q), a0 = 1 + al;
      const b0 = al / a0, b2 = -al / a0, a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - al) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      this.add(t, (x) => {
        const w = rnd() * 2 - 1;
        const y = b0 * w + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = w; y2 = y1; y1 = y;
        const tone = Math.sin(2 * Math.PI * 185 * x) * Math.exp(-x / 0.05) * 0.45;
        return (tone + y * Math.exp(-x / 0.1) * 1.4) * vel;
      }, 0.4);
    }

    hat(t, vel, rnd, open) {
      this.onsets.hat.push(t);
      let p1 = 0, p2 = 0;
      const tau = open ? 0.18 : 0.035;
      this.add(t, (x) => {
        const w = rnd() * 2 - 1, h1 = w - p1; p1 = w;
        const h2 = h1 - p2; p2 = h1;
        return h2 * Math.exp(-x / tau) * 0.16 * vel;
      }, open ? 0.6 : 0.15);
    }

    crash(t, vel, rnd) {
      this.onsets.crash.push(t);
      let p1 = 0;
      this.add(t, (x) => {
        const w = rnd() * 2 - 1, h1 = w - p1; p1 = w;
        return h1 * Math.exp(-x / 0.9) * 0.22 * vel;
      }, 2.5);
    }

    /** ベース（ピック弾き）。legato=true は前の音から切れ目なく弾き直す（音量が一瞬落ちて戻る） */
    bass(t, dur, freq, vel, legato) {
      let lp = 0;
      const sr = this.sr, a = 1 - Math.exp((-2 * Math.PI * 400) / sr);
      const rel = 0.006;
      this.add(t, (x) => {
        // 位相は絶対時刻から（同じ音の弾き直しで打ち消し合わないように）
        let ph = freq * (t + x); ph -= Math.floor(ph);
        const saw = ph * 2 - 1;
        lp += (saw - lp) * a;
        const atk = legato ? 0.45 + 0.55 * Math.min(1, x / 0.015) : Math.min(1, x / 0.008);
        const env = atk * Math.exp(-x / 0.9) * (x > dur - rel ? Math.max(0, (dur - x) / rel) : 1);
        return lp * env * 0.5 * vel;
      }, dur);
    }

    guitar(t, dur, root, vel, palm) {
      const sr = this.sr, fr = [root * 2, root * 3, root * 4, root * 2 * 1.006];
      const ph = [0, 0, 0, 0];
      let lp = 0;
      const a = 1 - Math.exp((-2 * Math.PI * (palm ? 1200 : 3200)) / sr);
      this.add(t, (x) => {
        let s = 0;
        for (let k = 0; k < 4; k++) { ph[k] += fr[k] / sr; ph[k] -= Math.floor(ph[k]); s += ph[k] * 2 - 1; }
        const d = Math.tanh(s * 3);
        lp += (d - lp) * a;
        const env = Math.min(1, x / 0.004) * (palm ? Math.exp(-x / 0.12) : 1) * (x > dur - 0.02 ? Math.max(0, (dur - x) / 0.02) : 1);
        return lp * env * 0.22 * vel;
      }, dur);
    }

    normalize(peak) {
      let m = 0;
      for (const v of this.buf) m = Math.max(m, Math.abs(v));
      if (m > 0) { const g = peak / m; for (let i = 0; i < this.buf.length; i++) this.buf[i] *= g; }
      return this;
    }
  }

  /**
   * セクションの列から曲を作る。
   * section: { bars, drums: 'none'|'click'|'8beat'|'four'|'half'|'roll'|'hats', bass: bool, guitar: 'none'|'chord'|'chug',
   *            gain, crash: bool, prog: [root names...] }
   */
  function song(opts) {
    const sr = opts.sampleRate || 48000;
    const bpm = opts.bpm || 128;
    const beat = 60 / bpm, bar = beat * 4, e8 = beat / 2, s16 = beat / 4;
    const rnd = VJ.util.rng(opts.seed || 1);
    const human = opts.humanize === undefined ? 0.003 : opts.humanize;
    const sections = opts.sections;
    const lead = opts.lead || 0.25; // 先頭の無音
    const totalBars = sections.reduce((a, s) => a + s.bars, 0);
    const m = new Mixer(sr, lead + totalBars * bar + (opts.tail || 1.5));
    const jit = () => (rnd() * 2 - 1) * human;
    let t0 = lead;
    let lastBassRoot = 0;
    for (const sec of sections) {
      const g = sec.gain === undefined ? 1 : sec.gain;
      const prog = sec.prog || ['E1', 'C2', 'G1', 'D2'];
      for (let b = 0; b < sec.bars; b++) {
        const tb = t0 + b * bar;
        const root = NOTE[prog[b % prog.length]] || 41.2;
        const v = () => g * (0.85 + rnd() * 0.15);
        if (sec.crash && b === 0) m.crash(tb, g, rnd);
        switch (sec.drums) {
          case 'click':
            for (let k = 0; k < 4; k++) m.kick(tb + k * beat, g, rnd);
            break;
          case 'hats':
            for (let k = 0; k < 8; k++) m.hat(tb + k * e8 + jit(), v() * (k % 2 ? 0.7 : 1), rnd, false);
            break;
          case '8beat':
            for (let k = 0; k < 8; k++) {
              if (k === 0 || k === 4 || (k === 5 && b % 2 === 1)) m.kick(tb + k * e8 + jit(), v(), rnd);
              if (k === 2 || k === 6) m.snare(tb + k * e8 + jit(), v(), rnd);
              m.hat(tb + k * e8 + jit(), v() * (k % 2 ? 0.7 : 1), rnd, false);
            }
            break;
          case 'four':
            for (let k = 0; k < 4; k++) {
              m.kick(tb + k * beat + jit(), v(), rnd);
              if (k === 1 || k === 3) m.snare(tb + k * beat + jit(), v(), rnd);
              m.hat(tb + k * beat + e8 + jit(), v(), rnd, true);
            }
            break;
          case 'half':
            m.kick(tb + jit(), v(), rnd);
            m.snare(tb + 2 * beat + jit(), v(), rnd);
            for (let k = 0; k < 4; k++) m.hat(tb + k * beat + jit(), v() * 0.8, rnd, false);
            break;
          case 'roll': {
            const n = b === sec.bars - 1 ? 16 : 8;
            const step = b === sec.bars - 1 ? s16 : e8;
            for (let k = 0; k < n; k++) m.snare(tb + k * step + jit(), g * (0.5 + (0.5 * (b * n + k)) / (sec.bars * n)), rnd);
            for (let k = 0; k < 4; k++) m.kick(tb + k * beat + jit(), v(), rnd);
            break;
          }
          default:
            break;
        }
        if (sec.bass) {
          for (let k = 0; k < 8; k++) m.bass(tb + k * e8, e8 + 0.006, root, g * 0.9, k > 0 || lastBassRoot === root);
          lastBassRoot = root;
        } else {
          lastBassRoot = 0;
        }
        if (sec.guitar === 'chord') m.guitar(tb, bar * 0.98, root, g, false);
        else if (sec.guitar === 'chug') for (let k = 0; k < 8; k++) m.guitar(tb + k * e8, e8 * 0.9, root, g, true);
      }
      t0 += sec.bars * bar;
    }
    if (opts.normalize !== false) m.normalize(opts.peak || 0.7);
    return { samples: m.buf, sampleRate: sr, onsets: m.onsets, bpm, duration: m.buf.length / sr };
  }

  /** デモ用の 1 曲（約 75 秒、イントロ→A→ビルド→ブレイク→サビ→アウトロ） */
  function demoSong(sampleRate, seed) {
    return song({
      sampleRate, seed: seed || 7, bpm: 132, lead: 0.1, tail: 0.1,
      sections: [
        { bars: 4, drums: 'hats', guitar: 'chord', gain: 0.45, prog: ['E1', 'C2', 'G1', 'D2'] },
        { bars: 8, drums: '8beat', bass: true, guitar: 'chug', gain: 0.75, crash: true, prog: ['E1', 'E1', 'C2', 'D2'] },
        { bars: 4, drums: 'half', bass: true, guitar: 'chord', gain: 0.7, prog: ['C2', 'D2', 'E1', 'E1'] },
        { bars: 2, drums: 'roll', bass: false, guitar: 'none', gain: 0.85 },
        { bars: 1, drums: 'none', guitar: 'none', gain: 0 },
        { bars: 8, drums: 'four', bass: true, guitar: 'chord', gain: 1.0, crash: true, prog: ['C2', 'D2', 'E1', 'G1'] },
        { bars: 4, drums: '8beat', bass: true, guitar: 'chug', gain: 0.95, prog: ['C2', 'D2', 'E1', 'E1'] },
        { bars: 4, drums: 'half', bass: true, guitar: 'chord', gain: 0.6, crash: true, prog: ['E1'] },
        { bars: 1, drums: 'none', guitar: 'none', gain: 0 },
      ],
    });
  }

  /** 純音・ノイズなど（テスト用） */
  function tone(sr, seconds, freq, amp) {
    const b = new Float32Array(Math.round(sr * seconds));
    for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * freq * i) / sr) * amp;
    return b;
  }

  function pinkNoise(sr, seconds, ampDb, seed) {
    const rnd = VJ.util.rng(seed || 3), b = new Float32Array(Math.round(sr * seconds));
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < b.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      b[i] = b0 + b1 + b2 + w * 0.1848;
    }
    let rms = 0;
    for (const v of b) rms += v * v;
    rms = Math.sqrt(rms / b.length);
    const g = VJ.util.dbToLin(ampDb) / rms;
    for (let i = 0; i < b.length; i++) b[i] *= g;
    return b;
  }

  /** 16bit PCM WAV（モノラル） */
  function toWav(samples, sr) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
    return new Uint8Array(buf);
  }

  VJ.synth = { Mixer, song, demoSong, tone, pinkNoise, toWav, NOTE };
})(globalThis.VJ = globalThis.VJ || {});
