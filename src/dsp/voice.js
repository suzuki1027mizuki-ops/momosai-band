/* VoiceAnalyzer：ピッチ推定（PitchTracker）の結果から、声に関する特徴を作る。
 *
 *  - 有声 / 無声（声帯が鳴っているか）と、なめらかにした音程
 *  - 音程が変わった瞬間（レガートで音量が下がらない音の変わり目・合唱の和音の変わり目）
 *  - 話し声らしさ（司会・MC の検出）
 *
 * 話し声の判定（約 4 秒の窓、0.17 秒ごとに更新）。実音声（朗読 3 本・読み上げ 3 本）と
 * 音楽（器楽 6 曲・歌入り 1 曲・合成音源）で調べた、次の 4 つの手がかりの組み合わせ：
 *   lef   1 秒ごとに「平均の半分より小さい音量のフレーム」の割合。話し声は音節・単語の間で
 *         音量が落ちるので大きい（0.3〜0.45）。音楽は伸びる音・残響で小さい（0.05〜0.2）
 *   flat  有声のところで、約 50ms の音程の幅が半音の半分未満の割合。歌や楽器は音程を保つので
 *         大きい（0.65〜0.9）。話し声は抑揚で常に動くので小さい（0.3〜0.45）
 *   range 有声のところの音程の幅（10〜90%）。和音の楽器・旋律は広い。話し声は 3〜10 半音
 *   vr    有声の割合。打楽器だけ・拍手・ざわめきは小さい
 *   run   有声が続く平均の長さ。話し声は音節ごとに切れる（0.1〜0.25 秒）。ロングトーンは長い */
(function (VJ) {
  'use strict';
  const D = VJ.dsp;
  const ramp = (x, a, b) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a));
  const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

  class VoiceAnalyzer {
    /**
     * @param stepSec ピッチ推定の間隔（秒）
     * @param cfg VJ.dspConfig.voice
     */
    constructor(stepSec, cfg) {
      this.cfg = cfg;
      this.stepSec = stepSec;
      this.N = Math.ceil(cfg.speechWindow / stepSec);
      this.act = new Uint8Array(this.N);
      this.vo = new Uint8Array(this.N);
      this.mid = new Float32Array(this.N);
      this.amp = new Float32Array(this.N);
      this.idx = 0;
      this.count = 0; // 区間の始まりからの推定回数（N まで）
      this.silentSteps = 0;
      this.sorted = new Float32Array(this.N);
      this.every = Math.max(1, Math.round(cfg.speechEvery / stepSec));
      this.stepN = 0;
      // 音程
      this.hzHist = [0, 0, 0];
      this.voiced = false;
      this.voicedRun = 0;
      this.midi = 0; // なめらかにした音程（MIDI 番号）
      this.center = 0; // 音程変化の検出用（ゆっくり追従）
      this.devRun = 0;
      this.lastOnsetStep = -1e9;
      this.steps = 0;
      // 話し声
      this.score = 0;
      this.level = 0;
      this.speech = false;
      this.feats = { lef: 0, flat: 0, range: 0, vr: 0, run: 0 };
      // 音程の履歴（描画用）：normalized 0..1 / 無声は -1。2 推定に 1 回（約 21ms）
      this.hist = new Float32Array(cfg.histLen).fill(-1);
      this.histIdx = 0;
      this.out = { noteOnset: false, strength: 0 };
    }

    /** 音程（MIDI）→ 0..1（C2〜C6） */
    norm(m) { return Math.max(0, Math.min(1, (m - 36) / 48)); }

    /**
     * ピッチ推定 1 回ごとに呼ぶ。
     * @param hz 推定（無声は 0）
     * @param active 全体の音量がゲートを超えているか
     * @param amp この区間の RMS
     */
    step(hz, active, amp) {
      const cfg = this.cfg, out = this.out;
      out.noteOnset = false;
      this.steps++;
      // 3 回の中央値で単発の外れ（オクターブ誤り）を消す
      const h = this.hzHist;
      h[0] = h[1]; h[1] = h[2]; h[2] = active ? hz : 0;
      const nz = (h[0] > 0) + (h[1] > 0) + (h[2] > 0);
      let est = 0;
      if (h[2] > 0 && nz >= 2) {
        const a = h[0], b = h[1], c = h[2];
        est = a > 0 && b > 0 ? Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)) : c;
      }
      const v = est > 0;
      if (v) {
        const m = hzToMidi(est);
        if (!this.voiced) { this.midi = m; this.center = m; this.devRun = 0; }
        else {
          this.midi += (m - this.midi) * cfg.pitchSmooth;
          // 音程の変わり目：中心から thr 半音以上ずれた状態が holdSteps 回続いた
          const dev = m - this.center;
          if (Math.abs(dev) > cfg.noteThr) {
            if (++this.devRun >= cfg.noteHold && this.steps - this.lastOnsetStep >= cfg.noteGap / this.stepSec) {
              out.noteOnset = true;
              out.strength = Math.min(0.9, 0.45 + 0.08 * Math.abs(dev));
              this.lastOnsetStep = this.steps;
              this.center = m;
              this.devRun = 0;
            }
          } else {
            this.devRun = 0;
            this.center += (m - this.center) * cfg.centerFollow;
          }
        }
        this.voicedRun++;
      } else {
        this.voicedRun = 0;
        this.devRun = 0;
      }
      this.voiced = v;
      if ((this.steps & 1) === 0) {
        this.hist[this.histIdx] = v ? this.norm(this.midi) : -1;
        this.histIdx = (this.histIdx + 1) % this.hist.length;
      }

      // 話し声の窓
      const i = this.idx;
      this.act[i] = active ? 1 : 0;
      this.vo[i] = v ? 1 : 0;
      this.mid[i] = v ? hzToMidi(est) : 0;
      this.amp[i] = amp;
      this.idx = (i + 1) % this.N;
      if (this.count < this.N) this.count++;
      if (active) this.silentSteps = 0;
      else if (++this.silentSteps * this.stepSec >= cfg.segmentGap) {
        // 長い無音で区切る（次の音は新しい区間として判定し直す）
        this.count = 0;
        if (this.silentSteps * this.stepSec >= cfg.speechHoldSilence) { this.speech = false; this.level = 0; this.score = 0; }
      }
      if (++this.stepN >= this.every) {
        this.stepN = 0;
        this._speechUpdate();
      }
      return out;
    }

    /** 話し声らしさの更新（窓 = 区間の始まりから最大 speechWindow 秒） */
    _speechUpdate() {
      const cfg = this.cfg, N = this.N, n = this.count;
      const minSteps = Math.round(cfg.speechMinSec / this.stepSec);
      let nAct = 0;
      for (let k = 0; k < n; k++) nAct += this.act[(this.idx - 1 - k + N) % N];
      let score = 0;
      if (nAct >= minSteps) {
        // 古い → 新しい順に並べ直さず、末尾から数える
        const at = (k) => (this.idx - n + k + N) % N; // k = 0 が最古
        // lef：1 秒ごと
        const seg = Math.max(8, Math.round(1 / this.stepSec));
        let lefN = 0, lefD = 0;
        for (let end = n; end > 0; end -= seg) {
          const s0 = Math.max(0, end - seg);
          if (end - s0 < seg / 2 && lefD > 0) break; // 古い側の短い端は使わない
          let sum = 0;
          for (let k = s0; k < end; k++) sum += this.amp[at(k)];
          const mean = sum / (end - s0);
          for (let k = s0; k < end; k++) if (this.amp[at(k)] < 0.5 * mean) lefN++;
          lefD += end - s0;
        }
        const lef = lefD ? lefN / lefD : 0;
        // flat / range / vr
        let nv = 0, nFlat = 0, nWin = 0, ns = 0, runs = 0, prevV = 0;
        for (let k = 0; k < n; k++) {
          const j = at(k);
          if (this.vo[j] && !prevV) runs++;
          prevV = this.vo[j];
          if (!this.vo[j]) continue;
          nv++;
          this.sorted[ns++] = this.mid[j];
          if (k >= 4) {
            let ok = true, mn = 1e9, mx = -1e9;
            for (let q = 0; q < 5; q++) {
              const jj = at(k - q);
              if (!this.vo[jj]) { ok = false; break; }
              const m = this.mid[jj];
              if (m < mn) mn = m;
              if (m > mx) mx = m;
            }
            if (ok) { nWin++; if (mx - mn < 0.5) nFlat++; }
          }
        }
        const vr = nv / nAct;
        const flat = nWin ? nFlat / nWin : 1;
        let range = 0;
        if (ns > 10) {
          const arr = this.sorted.subarray(0, ns);
          arr.sort();
          range = arr[Math.floor(ns * 0.9)] - arr[Math.floor(ns * 0.1)];
        }
        const run = runs ? (nv / runs) * this.stepSec : 0;
        const f = this.feats;
        f.lef = lef; f.flat = flat; f.range = range; f.vr = vr; f.run = run;
        if (nWin >= 10) {
          score = ramp(lef, 0.14, 0.24) * (1 - ramp(flat, 0.58, 0.72)) * (1 - ramp(range, 12, 17))
            * ramp(vr, 0.22, 0.32) * (1 - ramp(vr, 0.86, 0.93)) * (1 - ramp(run, 0.35, 0.6));
        }
      }
      this.score = score;
      const a = 1 - Math.exp(-cfg.speechEvery / cfg.speechTau);
      this.level += (score - this.level) * a;
      if (!this.speech && this.level > cfg.speechOn) this.speech = true;
      else if (this.speech && this.level < cfg.speechOff) this.speech = false;
    }

    /** 音程の履歴を古い順に dst へ */
    history(dst) {
      const H = this.hist.length;
      for (let k = 0; k < dst.length; k++) dst[k] = this.hist[(this.histIdx - dst.length + k + H * 2) % H];
      return dst;
    }
  }

  D.VoiceAnalyzer = VoiceAnalyzer;
})(globalThis.VJ = globalThis.VJ || {});
