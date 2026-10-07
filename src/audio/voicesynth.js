/* 声の合成（声帯音源 → フォルマント）。正解の発音時刻つき。テストと「デモ音源（歌・話し声）」に使う。
 *   sing()   歌（アカペラ）：音程を保つ・長い音にビブラート・一部はレガート
 *   speak()  話し声（司会）：抑揚（句ごとの下降・単語ごとの山・音節内の上がり下がり）・子音・単語や句の間
 *   choir()  合唱：4 声・ゆっくりした立ち上がり
 *   longTones()  ビブラート付きのロングトーン
 * 話し声は、実際の朗読・読み上げ音声で調べた特徴（音量の谷の割合・音程の揺れ・有声の割合）に合わせてある。 */
(function (VJ) {
  'use strict';

  const VOWEL = { a: [800, 1200, 2500], i: [300, 2300, 3000], u: [350, 1300, 2500], e: [500, 1900, 2500], o: [500, 800, 2500] };
  const VOWELS = Object.keys(VOWEL);
  const CONS = ['', 'k', 's', 't', 'n', 'm', '', 'p', 'sh', 'r', 'h'];

  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  function bandpass(sr, f0, q) {
    const w0 = (2 * Math.PI * f0) / sr, al = Math.sin(w0) / (2 * q), a0 = 1 + al;
    const b0 = al / a0, b2 = -al / a0, a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return (x) => { const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  }

  const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class Voice {
    constructor(sr, sec, seed) {
      this.sr = sr;
      this.buf = new Float32Array(Math.ceil(sec * sr));
      this.rnd = rng(seed);
      this.onsets = [];
      this.notes = [];
    }

    /** 子音（雑音・破裂）。長さ（秒）を返す */
    consonant(t, c, vel) {
      const sr = this.sr, b = this.buf, rnd = this.rnd, i0 = Math.round(t * sr);
      if (c === 's' || c === 'sh' || c === 'h') {
        const len = c === 'h' ? 0.05 : 0.08;
        const bq = bandpass(sr, c === 's' ? 6500 : c === 'sh' ? 3800 : 1500, c === 'h' ? 0.7 : 2);
        for (let i = 0; i < len * sr && i0 + i < b.length; i++) {
          const x = i / sr, env = Math.min(1, x / 0.015) * Math.min(1, (len - x) / 0.015);
          b[i0 + i] += bq(rnd() * 2 - 1) * env * (c === 'h' ? 0.12 : 0.22) * vel;
        }
        return len;
      }
      if (c === 'k' || c === 't' || c === 'p') {
        const gap = 0.035; // 閉鎖（無音）→ 破裂
        const bq = bandpass(sr, c === 'k' ? 2000 : c === 't' ? 4000 : 1000, 1);
        const j0 = i0 + Math.round(gap * sr);
        for (let i = 0; i < 0.025 * sr && j0 + i < b.length; i++) b[j0 + i] += bq(rnd() * 2 - 1) * Math.exp(-i / sr / 0.008) * 0.45 * vel;
        return gap + 0.02;
      }
      return 0; // 鼻音・ら行は有声部分で表現
    }

    /** 有声音。f0(x) は秒 → Hz の関数 */
    voiced(t, dur, f0, vowel, opts) {
      const o = Object.assign({ vel: 1, attack: 0.02, release: 0.04, female: false, nasal: 0 }, opts);
      const sr = this.sr, b = this.buf, rnd = this.rnd;
      const fs = VOWEL[vowel].map((f) => f * (o.female ? 1.17 : 1));
      const fil = fs.map((f, k) => bandpass(sr, f, f / [80, 90, 120][k]));
      const i0 = Math.round(t * sr), n = Math.round(dur * sr);
      let ph = 0;
      for (let i = 0; i < n && i0 + i < b.length; i++) {
        const x = i / sr;
        ph += (f0(x) * (1 + 0.003 * (rnd() - 0.5))) / sr;
        if (ph >= 1) ph -= 1;
        const src = 2 * ph - 1 + 0.03 * (rnd() * 2 - 1);
        let y = 0;
        for (let k = 0; k < 3; k++) y += fil[k](src) * [1, 0.5, 0.25][k];
        const nas = o.nasal && x < o.nasal ? 0.35 : 1;
        const env = Math.min(1, x / o.attack) * Math.min(1, Math.max(0, dur - x) / o.release) * nas;
        b[i0 + i] += y * env * 0.35 * o.vel;
      }
    }

    norm(peak = 0.6) {
      let m = 0;
      for (const v of this.buf) m = Math.max(m, Math.abs(v));
      const k = peak / (m || 1);
      for (let i = 0; i < this.buf.length; i++) this.buf[i] *= k;
      return this;
    }

    room(db = -62) {
      const a = Math.pow(10, db / 20), r = this.rnd;
      for (let i = 0; i < this.buf.length; i++) this.buf[i] += (r() * 2 - 1) * a;
      return this;
    }

    result() { return { samples: this.norm().room().buf, onsets: this.onsets.slice().sort((a, b) => a - b), notes: this.notes, sampleRate: this.sr }; }
  }

  /** 歌（アカペラ）。onsets = 音符の頭。legato: 子音なしで音程だけ変わる音の割合 */
  function sing({ sr = 48000, bpm = 90, bars = 12, female = true, seed = 1, legato = 0.3, vib = 0.4 } = {}) {
    const beat = 60 / bpm, v = new Voice(sr, bars * 4 * beat + 2, seed), r = v.rnd;
    const scale = [0, 2, 4, 5, 7, 9, 11, 12];
    let t = 0.5, deg = 2, prevEnd = -1;
    while (t < bars * 4 * beat) {
      const len = r() < 0.6 ? beat / 2 : beat;
      let nd = deg;
      while (nd === deg) nd = Math.max(0, Math.min(7, deg + Math.floor(r() * 5) - 2));
      deg = nd;
      const hz = midiToHz((female ? 64 : 52) + scale[deg]);
      if (r() < 0.1) { t += len; prevEnd = -1; continue; } // 休符
      v.onsets.push(t);
      v.notes.push({ t, dur: len, midi: (female ? 64 : 52) + scale[deg] });
      const leg = prevEnd > 0 && r() < legato; // 前の音から切らずに音程だけ変える
      const c = leg ? '' : CONS[Math.floor(r() * CONS.length)];
      const cl = leg ? 0 : v.consonant(t, c, 0.8);
      const d = len - cl - (leg ? 0 : 0.03);
      const vd = len >= beat ? vib : 0;
      v.voiced(t + cl, d + (leg ? 0.02 : 0), (x) => hz * Math.pow(2, (vd * Math.sin(2 * Math.PI * 5.5 * x) * Math.min(1, x / 0.3)) / 12),
        VOWELS[Math.floor(r() * 5)], { female, vel: 0.7 + 0.3 * r(), attack: leg ? 0.005 : 0.04, release: leg ? 0.005 : 0.05, nasal: c === 'n' || c === 'm' ? 0.05 : 0 });
      prevEnd = t + len;
      t += len;
    }
    return v.result();
  }

  /** 話し声（司会・MC）。onsets = 音節の頭 */
  function speak({ sr = 48000, sec = 30, female = false, seed = 2, rate = 7 } = {}) {
    const v = new Voice(sr, sec + 1.5, seed), r = v.rnd;
    const base = female ? 210 : 120;
    let t = 0.4;
    while (t < sec) {
      // 句：3〜6 単語。全体に下降（declination）
      const words = 3 + Math.floor(r() * 4);
      const phraseStart = t, phraseTop = 2 + 3 * r();
      let w = 0;
      for (; w < words && t < sec; w++) {
        const syl = 2 + Math.floor(r() * 4);
        const peak = 1.5 + 3 * r(); // 単語の山（半音）
        const peakPos = r();
        for (let s = 0; s < syl && t < sec; s++) {
          const len = (0.8 + 0.5 * r()) / rate;
          const c = s === 0 && r() < 0.3 ? '' : CONS[Math.floor(r() * CONS.length)];
          v.onsets.push(t);
          const cl = v.consonant(t, c, 0.7);
          const d = Math.max(0.05, len - cl);
          const u0 = (s + 0) / syl, u1 = (s + 1) / syl;
          // 音節内の上がり下がり（実際の話し声は 1 音節の中でも 1〜3 半音動く）と細かい揺れ
          const glide = (r() * 2 - 1) * 3, wf = 6 + 4 * r(), wp = r() * 6.28;
          const st = (u) => {
            const decl = phraseTop - 5 * Math.min(1, (t - phraseStart + u * d) / 2.5);
            const bump = peak * Math.exp(-Math.pow((u0 + (u1 - u0) * u - peakPos) / 0.35, 2));
            return decl + bump + glide * (u - 0.5) + 0.45 * Math.sin(wp + 2 * Math.PI * wf * u * d);
          };
          const hz = (x) => base * Math.pow(2, st(x / d) / 12);
          v.voiced(t + cl, d, hz, VOWELS[Math.floor(r() * 5)], { female, vel: 0.55 + 0.45 * r() * (1 - 0.4 * (s / syl)), attack: 0.015, release: 0.03, nasal: c === 'n' || c === 'm' ? 0.04 : 0 });
          t += cl + d + 0.015 + 0.03 * r();
        }
        t += r() < 0.4 ? 0.06 + 0.12 * r() : 0.01; // 単語の間
      }
      t += 0.35 + 0.6 * r(); // 句の間（息継ぎ）
    }
    return v.result();
  }

  /** 合唱：4 声、2 拍ごとに和音。onsets = 和音の頭 */
  function choir({ sr = 48000, bpm = 66, bars = 10, seed = 4 } = {}) {
    const beat = 60 / bpm, v = new Voice(sr, bars * 4 * beat + 3, seed), r = v.rnd;
    const chords = [[60, 64, 67, 48], [57, 60, 64, 45], [53, 57, 60, 41], [55, 59, 62, 43]];
    for (let bar = 0; bar < bars; bar++) for (let h = 0; h < 2; h++) {
      const t = 0.5 + (bar * 4 + h * 2) * beat;
      v.onsets.push(t);
      chords[bar % 4].forEach((m, k) => {
        const hz = midiToHz(m + (k < 3 ? 0 : 12));
        v.voiced(t + 0.03 * r(), 2 * beat * 0.97, (x) => hz * Math.pow(2, (0.25 * Math.sin(2 * Math.PI * 5.2 * x + k) * Math.min(1, x / 0.4)) / 12),
          ['a', 'o', 'u', 'a'][k], { female: k < 2, vel: 0.5, attack: 0.12, release: 0.08 });
      });
    }
    return v.result();
  }

  /** ロングトーン（ビブラート付き）5 音 */
  function longTones({ sr = 48000, seed = 3 } = {}) {
    const v = new Voice(sr, 26, seed);
    [57, 60, 64, 62, 59].forEach((m, i) => {
      const t = 0.5 + i * 5, hz = midiToHz(m);
      v.onsets.push(t);
      v.voiced(t, 4.5, (x) => hz * Math.pow(2, (0.6 * Math.sin(2 * Math.PI * 5.5 * x) * Math.min(1, x / 0.3)) / 12), 'a', { female: true, attack: 0.15, release: 0.1 });
    });
    return v.result();
  }

  /** 音声をつなぐ（間に gap 秒の無音） */
  function concat(parts, sr = 48000, gap = 1.5) {
    const n = parts.reduce((a, p) => a + p.samples.length + Math.round(gap * sr), 0);
    const out = new Float32Array(n);
    const marks = [];
    let pos = 0;
    for (const p of parts) {
      out.set(p.samples, pos);
      marks.push({ start: pos / sr, end: (pos + p.samples.length) / sr });
      pos += p.samples.length + Math.round(gap * sr);
    }
    return { samples: out, marks };
  }

  /** デモ用：歌と話し声 */
  function demo(kind, sr) {
    if (kind === 'speech') return speak({ sr, sec: 40, seed: 21 });
    return sing({ sr, bpm: 96, bars: 16, seed: 22 });
  }

  VJ.voiceSynth = { sing, speak, choir, longTones, concat, demo, midiToHz };
})(globalThis.VJ = globalThis.VJ || {});
