/* サウンドチェック（リハでの自動調整）。DOM を使わない計算部分。
 *   1. 静かな状態（数秒）：会場の雑音の大きさ
 *   2. 演奏（十数秒）：音の大きさ・割れ・左右・ドラムの有無・テンポ・声・話し声
 * から、問題点（小さすぎ・割れ・雑音に近い）と、おすすめの設定（無音とみなす音量・音楽のタイプ）を出す。
 * 測るのは音声を解析しているウィンドウ（2 画面のときは出力ウィンドウ）。結果は JSON にできる形。 */
(function (VJ) {
  'use strict';
  const t = (...a) => VJ.t(...a);

  /** 分位点（q = 0..1）。空なら -120 */
  function pct(arr, q) {
    if (!arr.length) return -120;
    const a = Float64Array.from(arr).sort();
    return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
  }

  /** 1 区間ぶんの集計。描画フレームごとに push する */
  class SoundCheckAcc {
    constructor() {
      this.n = 0;
      this.rms = [];
      this.act = [];
      this.voiced = 0;
      this.speechN = 0;
      this.melN = 0;
      this.conf = [];
      this.bpm = [];
      this.clipN = 0;
      this.peakMax = -120;
      this.lMax = -120;
      this.rMax = -120;
      this.mono = true;
      this.first = null;
      this.last = null;
    }

    /**
     * @param f 特徴量（FeatureExtractor.computeFrame の結果）
     * @param meter { l, r, lPeak, rPeak, mono }（dBFS。無ければ省略可）
     */
    push(f, meter) {
      const snap = { t: f.audioTime, kick: f.kickN, snare: f.snareN, hat: f.hatN };
      if (!this.first) this.first = snap;
      this.last = snap;
      this.n++;
      this.rms.push(f.rmsDb);
      if (f.active) this.act.push(f.rmsDb);
      this.voiced += f.voiced || 0;
      if (f.speech) this.speechN++;
      if (f.melodic) this.melN++;
      this.conf.push(f.beatConf || 0);
      if (f.bpm && f.beatConf > 0.3) this.bpm.push(f.bpm);
      if (meter) {
        const pk = Math.max(meter.lPeak, meter.mono ? -120 : meter.rPeak);
        if (pk > -0.5) this.clipN++;
        if (pk > this.peakMax) this.peakMax = pk;
        if (meter.l > this.lMax) this.lMax = meter.l;
        if (!meter.mono) { this.mono = false; if (meter.r > this.rMax) this.rMax = meter.r; }
      }
    }

    /** 集計（JSON にできる形） */
    summary() {
      const sec = this.first && this.last ? Math.max(1e-3, this.last.t - this.first.t) : 0;
      const rate = (k) => (sec > 0.5 ? (this.last[k] - this.first[k]) / sec : 0);
      const n = Math.max(1, this.n);
      return {
        n: this.n, sec,
        activeFrac: this.act.length / n,
        rmsP10: pct(this.rms, 0.1), rmsP90: pct(this.rms, 0.9), rmsMed: pct(this.rms, 0.5),
        actMed: pct(this.act, 0.5), actP20: pct(this.act, 0.2),
        kickRate: rate('kick'), snareRate: rate('snare'), hatRate: rate('hat'),
        voicedFrac: this.voiced / n, speechFrac: this.speechN / n, melodicFrac: this.melN / n,
        confMed: pct(this.conf, 0.5), bpm: this.bpm.length > this.n * 0.2 ? pct(this.bpm, 0.5) : 0,
        clipFrac: this.clipN / n, peakMax: this.peakMax,
        lMax: this.lMax, rMax: this.mono ? null : this.rMax,
      };
    }
  }

  const round = (x) => Math.round(x);

  /** 音楽のタイプの見立て：[タイプの id, 理由] */
  function guessProfile(m) {
    // ドラムの有無：解析が「ドラムの無い曲」と判断していた時間が長い（このときはメロディの立ち上がりもキックに数える）
    // か、キックが少ない・拍がはっきりしない
    const drums = m.melodicFrac < 0.5 && m.kickRate >= 0.4 && m.confMed >= 0.35;
    if (m.speechFrac > 0.4) return ['speech', t('話し声が多い')];
    if (!drums && m.voicedFrac > 0.45) return ['voice', t('ドラムが無く、歌（声）が中心')];
    if (!drums) return ['acoustic', t('ドラムが無い・静か')];
    // 4 つ打ち（ほぼ 1 拍ごとにキック）で速め → ダンス（8 ビートのロックはキックが拍の半分ほど）
    if (m.bpm >= 115 && m.kickRate >= 0.68 * (m.bpm / 60)) return ['dance', t('4 つ打ちのドラム（{0} BPM）', round(m.bpm))];
    return ['auto', m.bpm ? t('ドラムあり（{0} BPM）', round(m.bpm)) : t('ドラムあり')];
  }

  /**
   * 結果とおすすめ。
   * @param quiet 静かな区間の summary（測らなかったら null）
   * @param music 演奏の区間の summary
   * @param settings いまの設定（gateDb・profile）
   * @returns { items: [{level: 'ok'|'warn'|'bad'|'info', text}], rec: { gateDb?, profile? }, worst }
   */
  function analyze(quiet, music, settings) {
    const items = [], rec = {};
    const add = (level, text) => items.push({ level, text });
    // 足りるかは時間で見る（描画が重い PC ではフレームが少ない）
    if (!music || music.n < 10 || music.sec < 2) {
      add('bad', t('演奏の音を測れませんでした（短すぎるか、音声入力が止まっています）'));
      return { items, rec, worst: 'bad' };
    }
    // 1) 大きさ
    if (music.activeFrac < 0.3) add('bad', t('音がほとんど入っていません。入力の選び方・ケーブル・ミキサーの出力を確認してください'));
    else if (music.actMed < -48) add('warn', t('音が小さめです（{0} dBFS）。ミキサーの出力か PC の入力音量を上げてください', round(music.actMed)));
    else add('ok', t('音の大きさ OK（{0} dBFS）', round(music.actMed)));
    // 2) 割れ
    if (music.clipFrac > 0.01) add('bad', t('音が割れています。ミキサーの出力か PC の入力音量を下げてください'));
    else if (music.peakMax > -1) add('warn', t('音の山が上限ぎりぎりです（{0} dBFS）。少し下げると安心です', music.peakMax.toFixed(1)));
    else if (music.activeFrac >= 0.3) add('ok', t('音割れなし（最大 {0} dBFS）', round(music.peakMax)));
    // 3) 左右
    if (music.rMax !== null && music.lMax > -100 && Math.abs(music.lMax - music.rMax) > 24) {
      add('info', t('片方のチャンネル（{0}）にしか音がありません。「解析するチャンネル」はミックスのままで大丈夫です', music.lMax > music.rMax ? 'L' : 'R'));
    }
    // 4) 雑音と「無音とみなす音量」
    if (quiet && quiet.n >= 10 && quiet.sec >= 1) {
      const noise = quiet.rmsP90;
      if (music.activeFrac >= 0.3 && music.actMed - noise < 12) {
        add('warn', t('演奏の音が会場の雑音に近いです（差 {0} dB）。マイクを音の出る所に近づけるか、ミキサーからのライン入力を使ってください', round(music.actMed - noise)));
      }
      if (noise > -66) {
        // 雑音より少し上。ただし演奏の小さいところ（20%）より 6dB 以上下に
        let g = Math.min(round(noise + 4), round(music.actP20 - 6));
        g = Math.max(-70, Math.min(-20, g));
        // 演奏の小さいところが雑音に埋もれているときは分けられない（上の警告だけ）
        if (g < noise + 2) add('info', t('会場の雑音 {0} dBFS。演奏と区別できないので「無音とみなす音量」は変えません', round(noise)));
        else if (g > settings.gateDb + 2) {
          rec.gateDb = g;
          add('info', t('会場の雑音は {0} dBFS。雑音に反応しないよう「無音とみなす音量」を {1} dBFS にするのがおすすめです', round(noise), g));
        } else add('ok', t('会場の雑音 {0} dBFS（いまの設定で大丈夫）', round(noise)));
      } else add('ok', t('会場は静かです（雑音 {0} dBFS）', round(noise)));
    } else {
      add('info', t('会場の雑音は測りませんでした'));
    }
    // 5) 音楽のタイプ
    const [prof, why] = guessProfile(music);
    const name = VJ.profileName(VJ.profileById(prof));
    if (prof !== settings.profile) {
      rec.profile = prof;
      add('info', t('音楽のタイプは「{0}」がおすすめです（{1}）', name, why));
    } else add('ok', t('音楽のタイプ「{0}」で合っています（{1}）', name, why));
    const order = { ok: 0, info: 1, warn: 2, bad: 3 };
    const worst = items.reduce((w, x) => (order[x.level] > order[w] ? x.level : w), 'ok');
    return { items, rec, worst };
  }

  VJ.soundcheck = { SoundCheckAcc, analyze, guessProfile, pct };
})(globalThis.VJ = globalThis.VJ || {});
