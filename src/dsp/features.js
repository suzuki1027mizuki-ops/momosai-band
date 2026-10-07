/* FeatureExtractor：音声サンプル → 映像用の特徴量（AudioFeatures）。
 *
 * process(samples)       128 サンプル刻みで帯域フィルタ → 包絡線 → オンセット → 自動正規化。
 *                        チャンクの切り方に結果が依存しない（端数は次回へ持ち越し）。
 * computeFrame(latest)   描画フレームごと。FFT スペクトル・波形・盛り上がり・ヒット履歴の経過秒数。
 *
 * features は 1 つのオブジェクトを上書きし続ける（毎フレームのメモリ確保をしない）。 */
(function (VJ) {
  'use strict';
  const D = VJ.dsp;
  const { clamp01, powToDb, dbToLin, decay } = VJ.util;

  const TYPES = ['kick', 'snare', 'hat', 'accent', 'impact'];
  const FLAG = { kick: 1, snare: 2, hat: 4, accent: 8, impact: 16, beat: 32, downbeat: 64, note: 128 };

  function makeFeatures(cfg) {
    const H = cfg.historyLen;
    return {
      time: 0, audioTime: 0, sampleRate: 0,
      active: false, silenceSec: 0,
      rmsDb: -120, floorDb: -120,
      level: 0, low: 0, mid: 0, high: 0,
      kick: 0, snare: 0, hat: 0, accent: 0,
      kickN: 0, snareN: 0, hatN: 0, accentN: 0, impactN: 0,
      kickEv: new Float32Array(H * 2), snareEv: new Float32Array(H * 2), accentEv: new Float32Array(H * 2),
      onsetFlags: 0,
      intensity: 0, centroid: 0.5,
      spectrum: new Float32Array(cfg.specBands),
      spectrumSlow: new Float32Array(cfg.specBands),
      waveform: new Float32Array(cfg.waveLen),
      bpm: 0, beatPhase: 0, beatConf: 0, barPhase: 0, beatN: 0, tempoManual: false,
      melodic: false, // ドラムの無い曲として扱っているか
      // 声
      voiced: 0, // 声（音程のある音）が鳴っているか 0..1
      pitch: 0.5, // 音程 0..1（C2〜C6）。無声の間は直前の値を保つ
      pitchHz: 0, note: 0, pitchClass: 0, // Hz（無声は 0）・MIDI 番号・音名（0..1 = C〜B）
      noteN: 0, // 音程の変わり目の回数
      speech: false, speechScore: 0, // 話し声（司会・MC）と判定しているか・その度合い
      pitchHist: new Float32Array(cfg.voice.histLen), // 音程の履歴（古い順、無声は -1）
    };
  }

  class FeatureExtractor {
    constructor(opts) {
      const cfg = (this.cfg = (opts && opts.config) || VJ.dspConfig);
      const sr = (this.sr = opts.sampleRate);
      const hop = (this.hop = cfg.hop);
      const hopSec = (this.hopSec = hop / sr);

      this.filters = cfg.bands.map((b) => new D.BandFilter(b, sr, hop));
      this.fullFilter = new D.BandFilter({ lo: 30, hi: null, order: 2 }, sr, hop);
      this.bandE = new Float64Array(cfg.bands.length);
      this.bandDb = new Float64Array(cfg.bands.length);

      // オンセット検出器：帯域ごとに 1 つ（全帯域の z をアクセント判定に使う）
      this.det = [];
      this.detType = [];
      for (const key of Object.keys(cfg.onset)) {
        const p = cfg.onset[key];
        this.det[p.band] = new D.OnsetDetector(p, hopSec, cfg.statTau);
        this.detType[p.band] = key;
      }
      this.bandGroup = [0, 0, 1, 1, 2]; // low / mid / high

      // ドラムが無い曲用のメロディ立ち上がり検出
      this.melDet = new D.OnsetDetector(cfg.melodic, hopSec, cfg.statTau);
      this.melFloor = new D.NoiseFloor(cfg.noiseFloor, hopSec);
      this.melMode = cfg.melodicMode === 'on';
      this.kickRing = new Float64Array(32).fill(-1e12);
      this.kickRingIdx = 0;
      this.melRing = new Float64Array(32).fill(-1e12);
      this.melRingIdx = 0;
      this.activeSec = 0;

      // 声：ピッチ・音程の変わり目・話し声
      this.pitch = new D.PitchTracker(sr, cfg.pitch);
      this.voice = new D.VoiceAnalyzer((cfg.pitch.every * hop) / sr, cfg.voice);
      this.voiceMode = cfg.voice.mode;
      this.voiceE = 0;
      this.lastMelSample = -1e12;
      this.voicedSm = 0;
      this.pitchSm = 0.5;
      this.lastKickDrum = false;

      // テンポ
      this.tempo = new D.TempoTracker(sr, hop);
      this.tempoState = {};
      this.lastBeatIndex = null;

      // 自動正規化：full, low, mid, high
      this.agc = [0, 1, 2, 3].map(() => new D.AutoGain(cfg.agc, hopSec));
      this.groupFloor = [0, 1, 2, 3].map(() => new D.NoiseFloor(cfg.noiseFloor, hopSec));
      this.bandFloor = cfg.bands.map(() => new D.NoiseFloor(cfg.noiseFloor, hopSec));

      this.env = {
        level: new D.Follower(cfg.env.level, hopSec),
        low: new D.Follower(cfg.env.low, hopSec),
        mid: new D.Follower(cfg.env.mid, hopSec),
        high: new D.Follower(cfg.env.high, hopSec),
      };
      this.fastPow = new D.Smoother(0.05, hopSec, 0);
      this.slowPow = new D.Smoother(2.0, hopSec, 0);
      this.activePow = new D.Smoother(0.05, hopSec, 0);
      this.l3s = new D.Smoother(3.0, hopSec, -60);
      this.peak60 = new D.PeakHold(60, hopSec, -60);

      this.pending = new Float32Array(hop);
      this.pendingN = 0;
      this.sampleCount = 0;
      this.hopCount = 0;
      this.sens = 1;
      this.sensStep = 0;

      // アクセント・ブレイク
      this.lastZHop = new Float64Array(cfg.bands.length).fill(-1e9);
      this.lastAccentHop = -1e9;
      this.lastSnareHop = -1e9;
      this.prevEFull = 0;
      this.fullPeak = -200;
      this.peakLag = new Float64Array(cfg.accent.lagHops).fill(-200);
      this.peakLagIdx = 0;
      this.breakSec = 0;
      this.impactArmedUntil = -1;
      this.accentHops = Math.round(cfg.accent.refractory / hopSec);

      // フレームまでに溜まったオンセット
      this.boost = { kick: 0, snare: 0, hat: 0, accent: 0 };
      this.flagsAcc = 0;
      this.onsetLog = null; // テスト用：[{type, sample, strength}]

      // 履歴（新しい順）：サンプル位置と強さ
      const H = cfg.historyLen;
      this.hist = {};
      for (const t of ['kick', 'snare', 'accent']) this.hist[t] = { pos: new Float64Array(H).fill(-1e12), str: new Float32Array(H) };

      // 密度（直近 4 秒のオンセット）
      this.densRing = new Float64Array(128).fill(-1e12);
      this.densIdx = 0;

      // スペクトル
      this.fft = new D.FFT(cfg.fftSize);
      this.mag = new Float32Array(cfg.fftSize / 2 + 1);
      this._initSpecBands();
      this.specRef = -30;
      this.specRefRelease = Math.exp(-1 / 60 / 5);
      this.intensitySm = 0;
      this.centroidSm = 0.5;

      this.features = makeFeatures(cfg);
      this.features.sampleRate = sr;
    }

    _initSpecBands() {
      const cfg = this.cfg, n = cfg.specBands, N = cfg.fftSize, sr = this.sr;
      this.specLoBin = new Float32Array(n);
      this.specHiBin = new Float32Array(n);
      this.specTilt = new Float32Array(n);
      const hi = Math.min(cfg.specHi, sr * 0.45);
      for (let i = 0; i < n; i++) {
        const f0 = cfg.specLo * Math.pow(hi / cfg.specLo, i / n);
        const f1 = cfg.specLo * Math.pow(hi / cfg.specLo, (i + 1) / n);
        this.specLoBin[i] = (f0 * N) / sr;
        this.specHiBin[i] = (f1 * N) / sr;
        const fc = Math.sqrt(f0 * f1);
        this.specTilt[i] = 3 * Math.log2(fc / 1000); // +3dB/oct（音楽は高域ほど弱いので補正）
      }
      this.specTmp = new Float32Array(n);
    }

    setSensitivity(step) {
      this.sensStep = Math.max(-5, Math.min(5, step | 0));
      this.sens = Math.pow(0.9, this.sensStep);
    }

    /** 時間の飛び（タブ裏・デバイス再接続）後に呼ぶ。誤検出防止のため一定時間オンセットを止める */
    resync() {
      this.pendingN = 0;
      for (const f of this.filters) f.reset();
      this.fullFilter.reset();
      const mute = Math.ceil(0.05 / this.hopSec);
      for (const d of this.det) d.resync(mute);
      this.pitch.reset();
    }

    /** サンプルを投入。長さは任意（端数は持ち越し）。 */
    process(samples) {
      const hop = this.hop;
      let i = 0;
      const n = samples.length;
      // 端数があれば先に埋める
      if (this.pendingN > 0) {
        while (i < n && this.pendingN < hop) this.pending[this.pendingN++] = samples[i++];
        if (this.pendingN === hop) { this._hop(this.pending, 0); this.pendingN = 0; }
      }
      while (i + hop <= n) { this._hop(samples, i); i += hop; }
      while (i < n) this.pending[this.pendingN++] = samples[i++];
    }

    _hop(buf, off) {
      const cfg = this.cfg, hop = this.hop;
      this.sampleCount += hop;
      this.hopCount++;
      const nb = this.filters.length;

      const eFull = this.fullFilter.energy(buf, off, hop);
      this.voiceE += eFull;
      for (let b = 0; b < nb; b++) {
        const e = this.filters[b].energy(buf, off, hop);
        this.bandE[b] = e;
        this.bandDb[b] = powToDb(e);
      }
      const eLow = this.bandE[0] + this.bandE[1], eMid = this.bandE[2] + this.bandE[3], eHigh = this.bandE[4];
      const dbFull = powToDb(eFull);
      const groupDb = [dbFull, powToDb(eLow), powToDb(eMid), powToDb(eHigh)];

      // ノイズフロア・有効判定
      const fl = this.groupFloor;
      for (let g = 0; g < 4; g++) fl[g].update(groupDb[g], this.agc[g].ref);
      const actDb = powToDb(this.activePow.update(eFull));
      const active = actDb > Math.max(fl[0].db + 6, cfg.silenceAbsDb);
      this.active = active;
      if (active) this.silenceSec = 0; else this.silenceSec = (this.silenceSec || 0) + this.hopSec;
      if (active) this.activeSec += this.hopSec; else if (this.silenceSec > 2) this.activeSec = 0;

      // 自動正規化と包絡線
      for (let g = 0; g < 4; g++) this.agc[g].update(groupDb[g], active && groupDb[g] > fl[g].db + cfg.gateDb, fl[g].db);
      // 無音（ゲート外）では 0 を入れて自然に減衰させる
      const g = active ? 1 : 0;
      this.env.level.update(g * this.agc[0].norm(dbFull));
      this.env.low.update(g * this.agc[1].norm(groupDb[1]));
      this.env.mid.update(g * this.agc[2].norm(groupDb[2]));
      this.env.high.update(g * this.agc[3].norm(groupDb[3]));
      this.rmsDb = dbFull;

      // 話し声の間は、子音をスネア・ハイハットとして扱わず、キメ・一撃・拍も出さない
      const speechNow = cfg.speechGuard && this.voice.speech;
      const noDrums = this.voiceMode !== 'off' || speechNow;

      // オンセット（高い帯域から：スネア判定をキック判定より先に）
      const sampleEnd = this.sampleCount;
      for (let b = nb - 1; b >= 0; b--) {
        const fl = this.bandFloor[b].update(this.bandDb[b], this.agc[1 + this.bandGroup[b]].ref);
        const det = this.det[b];
        // 全体が無音（ゲート外）の間はオンセットを出さない（定常ノイズのゆらぎで反応しないように）
        const s = det.step(this.bandE[b], active ? Math.max(fl + cfg.gateDb, cfg.silenceAbsDb) : Infinity, this.sens);
        if (det.gateOpen && det.z > cfg.accent.zMin && det.flux > 0) this.lastZHop[b] = this.hopCount;
        const type = this.detType[b];
        if ((type === 'snare' || type === 'hat') && noDrums) continue;
        if (type === 'kick' || type === 'snare' || type === 'hat') {
          // スネアの胴鳴りがキック帯域に漏れた分は、キック帯域のピークより明らかに小さければ捨てる
          if (s > 0 && type === 'kick' && this.hopCount - this.lastSnareHop <= cfg.kickSnareHops && det.rel < -cfg.kickSnareRelDb) continue;
          if (s > 0 && type === 'snare') this.lastSnareHop = this.hopCount;
          if (s > 0 && type === 'kick') {
            // 低域が中域より十分強い立ち上がりだけを「ドラムがある」証拠として数える
            // （ピアノやギターの低い音がキック帯域に漏れたものは中域の方が強い）
            this.lastKickDrum = powToDb(this.bandE[0]) - powToDb(this.bandE[1] + this.bandE[2]) > cfg.drumRatioDb;
            if (this.lastKickDrum) {
              this.kickRing[this.kickRingIdx] = sampleEnd;
              this.kickRingIdx = (this.kickRingIdx + 1) % this.kickRing.length;
            }
            this.tempo.noteKick(s, sampleEnd);
            if (this.melMode) continue; // ドラムの無い曲モードではメロディの立ち上がりをキックとして使う
          }
          if (s > 0) this._onset(type, sampleEnd, s);
          else if (det.strengthUpdate > 0 && !(type === 'kick' && this.melMode) && this.boost[type] < det.strengthUpdate) this.boost[type] = det.strengthUpdate;
        }
      }

      // メロディ（150Hz〜5kHz）の立ち上がり
      const eMel = this.bandE[1] + this.bandE[2] + 0.5 * this.bandE[3];
      const melFl = this.melFloor.update(powToDb(eMel), this.agc[2].ref);
      const ms = this.melDet.step(eMel, active ? Math.max(melFl + cfg.gateDb, cfg.silenceAbsDb) : Infinity, this.sens);
      if (ms > 0) {
        this.melRing[this.melRingIdx] = sampleEnd;
        this.melRingIdx = (this.melRingIdx + 1) % this.melRing.length;
        if (this.melMode && sampleEnd - this.lastMelSample >= 0.1 * this.sr) {
          this.lastKickDrum = false;
          this._onset('kick', sampleEnd, ms);
          this.lastMelSample = sampleEnd;
        }
      } else if (this.melMode && this.melDet.strengthUpdate > 0 && this.boost.kick < this.melDet.strengthUpdate) {
        this.boost.kick = this.melDet.strengthUpdate;
      }
      if ((this.hopCount & 63) === 0) this._updateMode();

      // 声（約 10ms ごと）
      if (this.pitch.push(buf, off, hop)) {
        const amp = Math.sqrt(this.voiceE / cfg.pitch.every);
        this.voiceE = 0;
        const ev = this.voice.step(this.pitch.hz, active, amp, this.pitch.aperiodic);
        if (ev.noteOnset) {
          this.flagsAcc |= FLAG.note;
          this.features.noteN++;
          if (this.onsetLog) this.onsetLog.push({ type: 'note', sample: sampleEnd, strength: ev.strength });
          // 歌のモード：音量の山が無い音程の変わり目（レガート）もキックとして使う
          // （子音のある音は音量の立ち上がりで既に反応しているので、その直後は重ねない）
          if (this.voiceMode === 'sing' && this.melMode && sampleEnd - this.lastMelSample >= 0.25 * this.sr) {
            this.lastKickDrum = false;
            this._onset('kick', sampleEnd, ev.strength);
            this.lastMelSample = sampleEnd;
          }
        }
      }

      // テンポ推定用の立ち上がりの強さ
      if (active && !speechNow) {
        const w = cfg.tempoWeights;
        let osf = 0;
        for (let b = 0; b < nb; b++) osf += w[b] * this.det[b].flux;
        this.tempo.push(osf, sampleEnd);
      } else {
        this.tempo.push(0, sampleEnd);
      }

      // アクセント（キメ）：3 帯域以上が同時に立ち上がり、かつ全帯域の短時間音量が
      // 「少し前までのピーク + loudDb」を超えた（＝周りより明らかに大きい一撃）
      const ac = cfg.accent;
      const sFull = powToDb((eFull + this.prevEFull) * 0.5);
      this.prevEFull = eFull;
      const lagged = this.peakLag[this.peakLagIdx];
      this.peakLag[this.peakLagIdx] = this.fullPeak;
      this.peakLagIdx = (this.peakLagIdx + 1) % this.peakLag.length;
      if (sFull > this.fullPeak) this.fullPeak = sFull;
      else this.fullPeak = Math.max(sFull, this.fullPeak - ac.peakFall * this.hopSec);
      if (!speechNow && this.hopCount - this.lastAccentHop >= this.accentHops && this.env.level.v >= ac.minLevel && sFull >= lagged + ac.loudDb) {
        let cnt = 0;
        for (let b = 0; b < nb; b++) if (this.hopCount - this.lastZHop[b] <= ac.windowHops) cnt++;
        // 低域（キック）か高域（シンバル）も一緒に立ち上がった一撃だけ（声の出だしは中域だけ）
        let edge = !ac.edgeBands;
        if (ac.edgeBands) for (const b of ac.edgeBands) if (this.hopCount - this.lastZHop[b] <= ac.windowHops) edge = true;
        if (cnt >= ac.minBands && edge) {
          this.lastAccentHop = this.hopCount;
          this._onset('accent', sampleEnd, Math.max(0.5, Math.min(1, 0.4 + (sFull - lagged) / 12)));
        }
      }

      // ブレイク → インパクト
      const fast = this.fastPow.update(eFull);
      const slow = this.slowPow.update(eFull);
      const slowDb = powToDb(slow);
      if (speechNow) {
        this.breakSec = 0;
        this.impactArmedUntil = -1;
      } else if (Math.sqrt(fast) < cfg.breakRatio * Math.sqrt(slow) && slowDb > fl[0].db + cfg.gateDb) {
        this.breakSec += this.hopSec;
        if (this.breakSec >= cfg.breakHold) this.impactArmedUntil = this.sampleCount + cfg.impactWindow * this.sr;
      } else {
        this.breakSec = 0;
      }

      // 盛り上がり用
      this.l3s.update(dbFull > -120 ? Math.max(dbFull, -90) : -90);
      this.peak60.update(this.l3s.v);
    }

    /** ドラムの有無でモードを切り替える（auto のとき） */
    _updateMode() {
      const mode = this.cfg.melodicMode;
      if (mode === 'on') { this.melMode = true; return; }
      if (mode === 'off') { this.melMode = false; return; }
      const since = this.sampleCount - 6 * this.sr;
      let kicks = 0, mels = 0;
      for (let i = 0; i < 32; i++) { if (this.kickRing[i] > since) kicks++; if (this.melRing[i] > since) mels++; }
      if (!this.melMode && this.activeSec > 4 && kicks <= 1 && mels >= 4) this.melMode = true;
      else if (this.melMode && kicks >= 5) this.melMode = false;
    }

    /** タップテンポ（今の音声位置を拍として登録）。BPM（3 回目以降）を返す */
    tap() { return this.tempo.tap(this.sampleCount); }

    _onset(type, sample, strength) {
      if (this.onsetLog) this.onsetLog.push({ type, sample, strength });
      this.flagsAcc |= FLAG[type];
      const f = this.features;
      f[type + 'N']++;
      if (type !== 'impact') {
        if (this.boost[type] < strength) this.boost[type] = strength;
      }
      const h = this.hist[type];
      if (h) {
        h.pos.copyWithin(1, 0); h.str.copyWithin(1, 0);
        h.pos[0] = sample; h.str[0] = strength;
      }
      if (type === 'kick' || type === 'snare' || type === 'hat') {
        this.densRing[this.densIdx] = sample;
        this.densIdx = (this.densIdx + 1) % this.densRing.length;
      }
      // ブレイク明けの強打 → インパクト
      // （キックはドラムらしい低音のときだけ。ドラムの無い曲・話し声の出だしでは出さない）
      if (((type === 'kick' && this.lastKickDrum) || type === 'accent') && strength >= 0.6 && sample <= this.impactArmedUntil) {
        this.impactArmedUntil = -1;
        this._onset('impact', sample, 1);
      }
    }

    /**
     * 描画フレームごとに呼ぶ。
     * @param latest 最新の音声（末尾が最新。fftSize 以上の長さ）
     * @param nowSec 表示時刻（秒）
     * @param dt     前フレームからの秒数
     */
    computeFrame(latest, nowSec, dt) {
      const cfg = this.cfg, f = this.features;
      f.time = nowSec;
      f.audioTime = this.sampleCount / this.sr;
      f.active = !!this.active;
      f.silenceSec = this.silenceSec || 0;
      f.rmsDb = this.rmsDb === undefined ? -120 : this.rmsDb;
      f.floorDb = this.groupFloor[0].db || -120;
      f.level = this.env.level.v;
      f.low = this.env.low.v;
      f.mid = this.env.mid.v;
      f.high = this.env.high.v;

      // ヒットの山：減衰してから、このフレームの新しいヒットで跳ね上げる（ピークを削らない）
      for (const t of ['kick', 'snare', 'hat', 'accent']) {
        const v = f[t] * decay(cfg.peak[t], dt);
        f[t] = v > this.boost[t] ? v : this.boost[t];
        this.boost[t] = 0;
      }
      // テンポ・拍
      const ts = this.tempo.state(this.sampleCount, this.tempoState);
      f.bpm = ts.bpm; f.beatPhase = ts.phase; f.beatConf = ts.conf; f.barPhase = ts.bar; f.tempoManual = ts.manual;
      const speechNow = this.cfg.speechGuard && this.voice.speech;
      if (ts.bpm && this.lastBeatIndex !== null && ts.beatIndex > this.lastBeatIndex && ts.conf >= 0.25 && this.active && !speechNow) {
        this.flagsAcc |= FLAG.beat;
        f.beatN++;
        if (ts.bar < 0.25) this.flagsAcc |= FLAG.downbeat;
      }
      this.lastBeatIndex = ts.bpm ? ts.beatIndex : null;
      f.melodic = this.melMode;
      this._voiceFrame(dt);

      f.onsetFlags = this.flagsAcc;
      this.flagsAcc = 0;

      // 履歴の経過秒数
      const sc = this.sampleCount, sr = this.sr, H = cfg.historyLen;
      for (const t of ['kick', 'snare', 'accent']) {
        const h = this.hist[t], ev = f[t + 'Ev'];
        for (let i = 0; i < H; i++) {
          const age = (sc - h.pos[i]) / sr;
          ev[i * 2] = age > 1e3 ? 1e3 : age;
          ev[i * 2 + 1] = age > 1e3 ? 0 : h.str[i];
        }
      }

      // 盛り上がり
      const lvlPart = clamp01((this.l3s.v - (this.peak60.v - 18)) / 18);
      let cnt = 0;
      const since = sc - 4 * sr;
      for (let i = 0; i < this.densRing.length; i++) if (this.densRing[i] > since) cnt++;
      const target = this.active ? 0.6 * lvlPart + 0.4 * clamp01(cnt / 4 / 8) : 0;
      this.intensitySm += (target - this.intensitySm) * (1 - Math.exp(-dt / 0.5));
      f.intensity = this.intensitySm;

      if (latest && latest.length >= cfg.fftSize) {
        this._spectrum(latest, dt);
        this._waveform(latest);
      }
      return f;
    }

    _voiceFrame(dt) {
      const f = this.features, vo = this.voice;
      const v = vo.voiced && this.active;
      this.voicedSm += ((v ? 1 : 0) - this.voicedSm) * (1 - Math.exp(-dt / (v ? 0.03 : 0.15)));
      f.voiced = this.voicedSm;
      if (v) {
        this.pitchSm += (vo.norm(vo.midi) - this.pitchSm) * (1 - Math.exp(-dt / 0.04));
        f.note = vo.midi;
        f.pitchHz = 440 * Math.pow(2, (vo.midi - 69) / 12);
        f.pitchClass = (((Math.round(vo.midi) % 12) + 12) % 12) / 12;
      } else {
        f.pitchHz = 0;
      }
      f.pitch = this.pitchSm;
      f.speech = vo.speech;
      f.speechScore = vo.level;
      vo.history(f.pitchHist);
    }

    _spectrum(latest, dt) {
      const cfg = this.cfg, f = this.features, mag = this.fft.magnitudes(latest, this.mag);
      const n = cfg.specBands, tmp = this.specTmp;
      let maxDb = -200, num = 0, den = 0;
      const binHz = this.sr / cfg.fftSize;
      for (let i = 0; i < n; i++) {
        const lo = this.specLoBin[i], hi = this.specHiBin[i];
        let p;
        if (hi - lo < 1) {
          // 1 ビン未満：線形補間
          const c = (lo + hi) * 0.5, i0 = Math.floor(c), t = c - i0;
          const m = mag[i0] * (1 - t) + mag[Math.min(i0 + 1, mag.length - 1)] * t;
          p = m * m;
        } else {
          let s = 0, k = 0;
          for (let j = Math.ceil(lo); j < hi && j < mag.length; j++) { s += mag[j] * mag[j]; k++; }
          p = k ? s / k : 0;
        }
        const db = powToDb(p) + this.specTilt[i];
        tmp[i] = db;
        if (db > maxDb) maxDb = db;
      }
      for (let j = 2; j < mag.length; j++) { const p = mag[j] * mag[j]; num += j * binHz * p; den += p; }
      // 基準：立ち上がり即時・減衰約 5 秒
      const rel = Math.exp(-dt / 5);
      this.specRef = maxDb > this.specRef ? maxDb : Math.max(maxDb, this.specRef * rel + maxDb * (1 - rel));
      if (this.specRef < -70) this.specRef = -70;
      const kf = Math.exp(-dt / cfg.specRelease), ks = Math.exp(-dt / cfg.specSlowRelease);
      const gate = this.active ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const v = gate * clamp01(1 + (tmp[i] - this.specRef) / cfg.specRangeDb);
        const a = f.spectrum[i] * kf, b = f.spectrumSlow[i] * ks;
        f.spectrum[i] = v > a ? v : a;
        f.spectrumSlow[i] = v > b ? v : b;
      }
      if (den > 1e-12 && this.active) {
        const c = num / den;
        const t = clamp01(Math.log(Math.max(c, 100) / 100) / Math.log(80));
        this.centroidSm += (t - this.centroidSm) * (1 - Math.exp(-dt / 0.15));
      }
      f.centroid = this.centroidSm;
    }

    _waveform(latest) {
      const cfg = this.cfg, wl = cfg.waveLen, out = this.features.waveform;
      const D = 4; // 4 サンプル平均で間引く（約 43ms 分を表示。低い音でも数周期見えて形がなめらか）
      const span = wl * D;
      const end = latest.length - span;
      // 立ち上がりのゼロ交差でトリガ（オシロスコープ風に揃える）
      let start = end;
      const lim = Math.max(1, end - 2048);
      for (let i = end; i > lim; i--) {
        if (latest[i - 1] < 0 && latest[i] >= 0) { start = i; break; }
      }
      const rmsRef = dbToLin(this.agc[0].ref);
      const g = this.active ? 1 / (rmsRef * 3 + 1e-6) / D : 0;
      for (let i = 0; i < wl; i++) {
        const j = start + i * D;
        const v = (latest[j] + latest[j + 1] + latest[j + 2] + latest[j + 3]) * g;
        out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
      }
    }
  }

  FeatureExtractor.TYPES = TYPES;
  FeatureExtractor.FLAG = FLAG;
  D.FeatureExtractor = FeatureExtractor;
})(globalThis.VJ = globalThis.VJ || {});
