/* 決定的なバンド音源シンセ（デモ再生 + テスト用の正解付き音源）。
 * DOM に依存しないので Node のテストからも使える。 */
(function (VJ) {
  'use strict';

  const NOTE = { E1: 41.2, F1: 43.65, G1: 49.0, A1: 55.0, B1: 61.74, C2: 65.41, D2: 73.42, E2: 82.41 };

  class Mixer {
    constructor(sr, seconds) {
      this.sr = sr;
      this.buf = new Float32Array(Math.ceil(sr * seconds));
      this.onsets = { kick: [], snare: [], hat: [], crash: [], note: [] };
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

    /** ピアノ/ギターの単音・和音（倍音が速く減衰する撥弦・打鍵の音）。freqs は配列 */
    pluck(t, freqs, vel, dur) {
      this.onsets.note.push(t);
      const sr = this.sr, n = freqs.length;
      const ph = new Float64Array(n * 4);
      this.add(t, (x) => {
        let s = 0;
        for (let k = 0; k < n; k++) {
          for (let h = 0; h < 4; h++) {
            const i = k * 4 + h;
            ph[i] += (freqs[k] * (h + 1)) / sr;
            if (ph[i] > 1) ph[i] -= 1;
            s += Math.sin(2 * Math.PI * ph[i]) * Math.exp(-x * (2.2 + h * 2.5)) / (h + 1);
          }
        }
        const atk = Math.min(1, x / 0.003);
        return (s / Math.sqrt(n)) * atk * 0.32 * vel;
      }, dur || 1.6);
    }

    /** 歌・ストリングスのような持続音（立ち上がりがゆっくり。オンセットの正解には含めない） */
    pad(t, freq, vel, dur) {
      const sr = this.sr;
      let ph = 0;
      this.add(t, (x) => {
        const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * x);
        ph += (freq * vib) / sr;
        if (ph > 1) ph -= 1;
        const env = Math.min(1, x / 0.25) * Math.min(1, Math.max(0, (dur - x) / 0.3));
        return (Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph)) * env * 0.18 * vel;
      }, dur);
    }

    normalize(peak) {
      let m = 0;
      for (const v of this.buf) m = Math.max(m, Math.abs(v));
      if (m > 0) { const g = peak / m; for (let i = 0; i < this.buf.length; i++) this.buf[i] *= g; }
      return this;
    }
  }

  // 16 分音符 16 マスのリズム（k キック・s スネア・g ゴースト（弱いスネア）・h ハイハット）。
  // swing8：裏の 8 分を遅らせる割合（1/3 で 3 連のシャッフル）、swing16：裏の 16 分を遅らせる割合
  const EVEN8 = [0, 2, 4, 6, 8, 10, 12, 14], ALL16 = [...Array(16).keys()];
  const PATTERNS = {
    twobeat: { k: [0, 4, 8, 12], s: [2, 6, 10, 14], h: EVEN8 }, // 2 ビート（パンク・メロコア）
    shuffle: { k: [0, 8], s: [4, 12], h: EVEN8, swing8: 1 / 3 }, // シャッフル（ハネる 8 分）
    funk: { k: [0, 6, 10], s: [4, 12], g: [7, 9, 15], h: ALL16 }, // ファンク（16 分のシンコペーション）
    hiphop: { k: [0, 7, 10], s: [4, 12], h: EVEN8, swing16: 0.25 }, // ブーンバップ
    dnb: { k: [0, 10], s: [4, 12], h: EVEN8 }, // ドラムンベース（2 ステップ）
    sparse: { k: [0], g: [8], h: [0, 4, 8, 12] }, // 静かなバラード（キック 1 つ・リム・4 分のハイハット）
  };

  /**
   * セクションの列から曲を作る。
   * section: { bars, drums: 'none'|'click'|'8beat'|'four'|'half'|'roll'|'hats'|PATTERNS のキー, bass: bool,
   *            guitar: 'none'|'chord'|'chug', gain, crash: bool, prog: [root names...] }
   * opts.drift：曲の終わりまでに拍の長さを何割変えるか（-0.04 = 終わりで 4% 速い。テンポが揺れるバンドのテスト用）
   */
  function song(opts) {
    const sr = opts.sampleRate || 48000;
    const bpm = opts.bpm || 128;
    const drift = opts.drift || 0;
    const beat0 = 60 / bpm;
    let beat = beat0, bar = beat * 4, e8 = beat / 2, s16 = beat / 4;
    const rnd = VJ.util.rng(opts.seed || 1);
    const human = opts.humanize === undefined ? 0.003 : opts.humanize;
    const sections = opts.sections;
    const lead = opts.lead || 0.25; // 先頭の無音
    const totalBars = sections.reduce((a, s) => a + s.bars, 0);
    const m = new Mixer(sr, lead + totalBars * bar * (1 + Math.max(0, drift)) + (opts.tail || 1.5));
    const jit = () => (rnd() * 2 - 1) * human;
    let tb = lead, nBar = 0;
    let lastBassRoot = 0;
    for (const sec of sections) {
      const g = sec.gain === undefined ? 1 : sec.gain;
      const prog = sec.prog || ['E1', 'C2', 'G1', 'D2'];
      for (let b = 0; b < sec.bars; b++, nBar++) {
        if (b > 0 || nBar > 0) tb += bar;
        // テンポの揺れ：小節ごとに拍の長さを少しずつ変える
        beat = beat0 * (1 + (drift * nBar) / Math.max(1, totalBars));
        bar = beat * 4; e8 = beat / 2; s16 = beat / 4;
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
          default: {
            const P = PATTERNS[sec.drums];
            if (!P) break;
            const at = (k) => tb + k * s16 + (k % 4 === 2 && P.swing8 ? P.swing8 * e8 : 0) + (k % 2 === 1 && P.swing16 ? P.swing16 * s16 : 0) + jit();
            for (const k of P.k || []) m.kick(at(k), v(), rnd);
            for (const k of P.s || []) m.snare(at(k), v(), rnd);
            for (const k of P.g || []) m.snare(at(k), v() * 0.35, rnd);
            for (const k of P.h || []) m.hat(at(k), v() * (k % 4 === 0 ? 1 : 0.65), rnd, false);
            break;
          }
        }
        if (sec.bass) {
          for (let k = 0; k < 8; k++) m.bass(tb + k * e8, e8 + 0.006, root, g * 0.9, k > 0 || lastBassRoot === root);
          lastBassRoot = root;
        } else {
          lastBassRoot = 0;
        }
        if (sec.guitar === 'chord') m.guitar(tb, bar * 0.98, root, g, false);
        else if (sec.guitar === 'chug') for (let k = 0; k < 8; k++) m.guitar(tb + k * e8, e8 * 0.9, root, g, true);
        // 鍵盤・アコースティック系（ドラムなしの曲のテスト用）
        const r4 = root * 4, maj = [1, 1.26, 1.5, 2];
        if (sec.keys === 'arp') {
          const seq = [0, 2, 1, 3, 2, 1, 3, 2];
          for (let k = 0; k < 8; k++) m.pluck(tb + k * e8 + jit(), [r4 * maj[seq[k]]], v() * (k % 2 ? 0.8 : 1), 1.2);
        } else if (sec.keys === 'chords') {
          m.pluck(tb + jit(), maj.map((x) => r4 * x), v(), 2.0);
          m.pluck(tb + 2 * beat + jit(), maj.map((x) => r4 * x), v() * 0.85, 2.0);
        } else if (sec.keys === 'ballad') {
          m.pluck(tb + jit(), maj.slice(0, 3).map((x) => r4 * x), v() * 0.9, 2.4);
          for (let k = 1; k < 4; k++) m.pluck(tb + k * beat + jit(), [r4 * 2 * maj[(b + k) % 4]], v() * 0.7, 1.4);
        }
        if (sec.vocal) m.pad(tb, r4 * 2 * maj[b % 4], g, bar);
      }
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
