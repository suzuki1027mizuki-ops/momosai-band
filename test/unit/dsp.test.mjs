// DSP（フィルタ・FFT・オンセット検出・特徴量）の単体テスト。正解付きの合成音源で決定的に検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ, analyze, score, times } from '../helpers/load-src.mjs';

const VJ = loadVJ();
const SR = 48000;
const db = (x) => 20 * Math.log10(x);

test('帯域フィルタの周波数特性（通過 ±1dB / カットオフ -3dB±1 / 1 オクターブ外 -20dB 以下）', () => {
  for (const spec of VJ.dspConfig.bands) {
    const f = new VJ.dsp.BandFilter(spec, SR, 128);
    const lo = spec.lo || 20, hi = spec.hi || 20000;
    const mid = spec.lo && spec.hi ? Math.sqrt(lo * hi) : spec.lo ? lo * 2.5 : hi / 2.5;
    assert.ok(Math.abs(db(f.magnitude(mid))) < 1, `${spec.name} pass ${db(f.magnitude(mid)).toFixed(2)}dB`);
    if (spec.lo) {
      assert.ok(Math.abs(db(f.magnitude(spec.lo)) + 3) < 1.2, `${spec.name} lo cutoff ${db(f.magnitude(spec.lo)).toFixed(2)}`);
      assert.ok(db(f.magnitude(spec.lo / 2)) < -20, `${spec.name} lo-1oct`);
    }
    if (spec.hi) {
      assert.ok(Math.abs(db(f.magnitude(spec.hi)) + 3) < 1.2, `${spec.name} hi cutoff ${db(f.magnitude(spec.hi)).toFixed(2)}`);
      assert.ok(db(f.magnitude(spec.hi * 2)) < -20, `${spec.name} hi+1oct`);
    }
  }
});

test('直交エネルギー：低域の正弦波でホップごとのエネルギーが脈打たない', () => {
  const spec = VJ.dspConfig.bands[0];
  const f = new VJ.dsp.BandFilter(spec, SR, 128);
  const s = VJ.synth.tone(SR, 1, 55, 0.5);
  const es = [];
  for (let i = 0; i + 128 <= s.length; i += 128) es.push(f.energy(s, i, 128));
  const tail = es.slice(100).map((e) => 10 * Math.log10(e));
  const ripple = Math.max(...tail) - Math.min(...tail);
  assert.ok(ripple < 6, `ripple ${ripple.toFixed(1)}dB`);
});

test('FFT が素朴な DFT と一致する', () => {
  const n = 256, fft = new VJ.dsp.FFT(n), rnd = VJ.util.rng(5);
  const x = new Float32Array(n).map(() => rnd() * 2 - 1);
  for (let i = 0; i < n; i++) { fft.re[i] = x[i]; fft.im[i] = 0; }
  fft.transform();
  for (const k of [0, 1, 7, 64, 127]) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { re += x[i] * Math.cos((2 * Math.PI * k * i) / n); im -= x[i] * Math.sin((2 * Math.PI * k * i) / n); }
    assert.ok(Math.abs(fft.re[k] - re) < 1e-3 && Math.abs(fft.im[k] - im) < 1e-3, `bin ${k}`);
  }
});

test('クリックトラック（120BPM キックのみ）：全数検出・誤検出 0・遅延 平均 8ms 以下 / 最大 12ms 以下', () => {
  const s = VJ.synth.song({ sampleRate: SR, bpm: 120, seed: 1, humanize: 0, sections: [{ bars: 16, drums: 'click' }] });
  const r = analyze(VJ, s.samples, SR);
  const sc = score(s.onsets.kick, times(r.log, 'kick', SR));
  assert.equal(sc.recall, 1, JSON.stringify(sc));
  assert.equal(sc.fp, 0, JSON.stringify(sc));
  assert.ok(sc.meanDelay <= 0.008, `mean ${sc.meanDelay}`);
  assert.ok(sc.maxDelay <= 0.012, `max ${sc.maxDelay}`);
});

test('8 ビートのドラム（140BPM）：キック/スネア/ハイハットの適合率・再現率 0.9 以上', () => {
  const s = VJ.synth.song({ sampleRate: SR, bpm: 140, seed: 2, sections: [{ bars: 16, drums: '8beat' }] });
  const r = analyze(VJ, s.samples, SR);
  for (const t of ['kick', 'snare', 'hat']) {
    const sc = score(s.onsets[t], times(r.log, t, SR));
    assert.ok(sc.recall >= 0.9 && sc.precision >= 0.9, `${t} ${JSON.stringify(sc)}`);
  }
});

test('バンド演奏（ドラム+ベース+歪みギター）：キック再現率 0.85 以上・誤検出率 10% 以下', () => {
  const s = VJ.synth.song({ sampleRate: SR, bpm: 140, seed: 3, sections: [{ bars: 16, drums: '8beat', bass: true, guitar: 'chug' }] });
  const r = analyze(VJ, s.samples, SR);
  const sc = score(s.onsets.kick, times(r.log, 'kick', SR));
  assert.ok(sc.recall >= 0.85, JSON.stringify(sc));
  assert.ok(sc.fp / (sc.tp + sc.fp) <= 0.1, JSON.stringify(sc));
  // スネアはギターに埋もれても拾えること
  const sn = score(s.onsets.snare, times(r.log, 'snare', SR));
  assert.ok(sn.recall >= 0.9, 'snare ' + JSON.stringify(sn));
});

test('無音・-60dBFS のピンクノイズ：ヒット 0、level < 0.05', () => {
  for (const samples of [new Float32Array(SR * 5), VJ.synth.pinkNoise(SR, 8, -60, 9)]) {
    const r = analyze(VJ, samples, SR, { keepFrames: true });
    const hits = r.log.filter((o) => o.type !== 'hat');
    assert.equal(hits.length, 0, JSON.stringify(hits.slice(0, 5)));
    const late = r.frames.slice(60);
    assert.ok(late.every((f) => f.level < 0.05), 'level ' + Math.max(...late.map((f) => f.level)));
  }
});

test('レベルの段差（-30dB → -10dB）：大量のヒットが出ず、8 秒以内に自動正規化が収束', () => {
  const a = VJ.synth.pinkNoise(SR, 6, -30, 4), b = VJ.synth.pinkNoise(SR, 10, -10, 5);
  const s = new Float32Array(a.length + b.length);
  s.set(a); s.set(b, a.length);
  const r = analyze(VJ, s, SR, { keepFrames: true });
  // 段差の直後 1 秒にヒットが連発しない
  const after = r.log.filter((o) => o.sample > a.length && o.sample < a.length + SR);
  for (const t of ['kick', 'snare', 'hat', 'accent']) {
    assert.ok(after.filter((o) => o.type === t).length <= 1, `${t} ${after.filter((o) => o.type === t).length}`);
  }
  // 大音量の定常ノイズでも乱発しない（1 秒に 1.5 回未満）
  const rest = r.log.filter((o) => o.sample > a.length + SR && o.type !== 'hat');
  assert.ok(rest.length / 9 < 1.5, `steady loud noise hits ${rest.length}`);
  const ref = r.fx.agc[0].ref;
  assert.ok(Math.abs(ref - -10) < 4, `agc ref ${ref}`);
});

test('ブレイク → 強打でインパクトが 1 回出る', () => {
  const s = VJ.synth.song({
    sampleRate: SR, bpm: 128, seed: 6,
    sections: [
      { bars: 4, drums: '8beat', bass: true, guitar: 'chug' },
      { bars: 1, drums: 'none', gain: 0 },
      { bars: 2, drums: 'four', bass: true, guitar: 'chord', crash: true },
    ],
  });
  const r = analyze(VJ, s.samples, SR);
  const imp = r.log.filter((o) => o.type === 'impact');
  assert.equal(imp.length, 1, JSON.stringify(imp));
  const breakEnd = 0.25 + 5 * 4 * (60 / 128);
  assert.ok(Math.abs(imp[0].sample / SR - breakEnd) < 0.05, `impact at ${imp[0].sample / SR} vs ${breakEnd}`);
});

test('アクセントは単調なループでは稀、セクション頭では出る', () => {
  const loop = VJ.synth.song({ sampleRate: SR, bpm: 140, seed: 2, sections: [{ bars: 16, drums: '8beat', bass: true, guitar: 'chug' }] });
  const r1 = analyze(VJ, loop.samples, SR);
  const n1 = r1.log.filter((o) => o.type === 'accent' && o.sample > SR).length;
  assert.ok(n1 <= 4, `accents in steady loop: ${n1}`);
  const build = VJ.synth.song({
    sampleRate: SR, bpm: 128, seed: 8,
    sections: [{ bars: 4, drums: 'hats', guitar: 'chord', gain: 0.35 }, { bars: 4, drums: 'four', bass: true, guitar: 'chord', crash: true }],
  });
  const r2 = analyze(VJ, build.samples, SR);
  const sectionStart = 0.25 + 4 * 4 * (60 / 128);
  const acc = r2.log.filter((o) => o.type === 'accent').map((o) => o.sample / SR);
  assert.ok(acc.some((t) => Math.abs(t - sectionStart) < 0.05), `accents ${acc.join(',')} expected ~${sectionStart}`);
});

test('チャンクの切り方に結果が依存しない（128 固定 vs ランダム長）', () => {
  const s = VJ.synth.demoSong(SR).samples.subarray(0, SR * 20);
  const a = analyze(VJ, s, SR, { chunk: 128, frames: false });
  const b = analyze(VJ, s, SR, { chunk: 'random', frames: false });
  assert.ok(a.log.length > 50);
  assert.deepEqual(b.log, a.log);
});

test('resync 後はしばらく誤検出しない', () => {
  const s = VJ.synth.song({ sampleRate: SR, bpm: 140, seed: 2, sections: [{ bars: 8, drums: '8beat', bass: true, guitar: 'chug' }] }).samples;
  const fx = new VJ.dsp.FeatureExtractor({ sampleRate: SR });
  fx.onsetLog = [];
  fx.process(s.subarray(0, SR * 3));
  fx.resync();
  const before = fx.sampleCount;
  // 途中から（不連続な位置）再開
  fx.process(s.subarray(Math.round(SR * 5.1), Math.round(SR * 5.2)));
  const early = fx.onsetLog.filter((o) => o.sample > before && o.sample <= before + SR * 0.05);
  assert.equal(early.length, 0, JSON.stringify(early));
});

test('特徴量の値域（0..1、NaN なし）と波形・スペクトル', () => {
  const s = VJ.synth.demoSong(SR).samples.subarray(0, SR * 30);
  const fx = new VJ.dsp.FeatureExtractor({ sampleRate: SR });
  const latest = new Float32Array(8192);
  let maxSpec = 0, maxWave = 0;
  for (let i = 0; i + 800 <= s.length; i += 800) {
    fx.process(s.subarray(i, i + 800));
    latest.copyWithin(0, 800);
    latest.set(s.subarray(i, i + 800), 8192 - 800);
    const f = fx.computeFrame(latest, i / SR, 800 / SR);
    for (const k of ['level', 'low', 'mid', 'high', 'kick', 'snare', 'hat', 'accent', 'intensity', 'centroid']) {
      assert.ok(f[k] >= 0 && f[k] <= 1 && !Number.isNaN(f[k]), `${k}=${f[k]}`);
    }
    for (const v of f.spectrum) assert.ok(v >= 0 && v <= 1);
    maxSpec = Math.max(maxSpec, ...f.spectrum);
    maxWave = Math.max(maxWave, ...f.waveform.map(Math.abs));
    for (let j = 0; j < 16; j += 2) assert.ok(f.kickEv[j] >= 0);
  }
  assert.ok(maxSpec > 0.8, 'spectrum reaches ' + maxSpec);
  assert.ok(maxWave > 0.3, 'waveform reaches ' + maxWave);
  assert.ok(fx.features.kickN > 20 && fx.features.snareN > 10);
});

test('感度ステップでしきい値が変わる', () => {
  const s = VJ.synth.song({ sampleRate: SR, bpm: 140, seed: 3, sections: [{ bars: 8, drums: '8beat', bass: true, guitar: 'chug' }] });
  const lo = analyze(VJ, s.samples, SR, { sens: -5 }).log.length;
  const hi = analyze(VJ, s.samples, SR, { sens: 5 }).log.length;
  assert.ok(hi > lo, `sens+5 ${hi} vs sens-5 ${lo}`);
});
