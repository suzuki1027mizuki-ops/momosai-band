// 声：ピッチ推定・音程の変わり目・話し声（司会・MC）の検出
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ, analyze, score, times } from '../helpers/load-src.mjs';

const VJ = loadVJ();
const SR = 48000;
const V = VJ.voiceSynth;
const song = (o) => VJ.synth.song(Object.assign({ sampleRate: SR }, o));

function tone(sr, f, sec, saw) {
  const x = new Float32Array(Math.round(sr * sec));
  let ph = 0;
  for (let i = 0; i < x.length; i++) { ph += f / sr; ph -= Math.floor(ph); x[i] = 0.3 * (saw ? 2 * ph - 1 : Math.sin(2 * Math.PI * ph)); }
  return x;
}

test('ピッチ推定：70Hz〜1kHz の正弦波・のこぎり波を 10 セント以内（44.1k / 48k / 96k）', () => {
  for (const sr of [44100, 48000, 96000]) {
    for (const f of [70, 110, 220, 330, 440, 660, 880, 1000]) {
      for (const saw of [false, true]) {
        const pt = new VJ.dsp.PitchTracker(sr);
        const x = tone(sr, f, 0.5, saw);
        const est = [];
        for (let i = 0; i + 128 <= x.length; i += 128) if (pt.push(x, i, 128) && i > sr * 0.1) est.push(pt.hz);
        const bad = est.filter((h) => !h || Math.abs(1200 * Math.log2(h / f)) > 10);
        assert.ok(bad.length === 0, `${sr}Hz ${f}Hz ${saw ? 'saw' : 'sine'}: ${bad.slice(0, 3).map((h) => h.toFixed(1))}`);
      }
    }
  }
});

test('ピッチ推定：雑音・無音は無声（hz = 0）', () => {
  const pt = new VJ.dsp.PitchTracker(SR);
  const rnd = VJ.util.rng(3);
  const x = new Float32Array(SR);
  for (let i = 0; i < SR / 2; i++) x[i] = (rnd() * 2 - 1) * 0.2;
  let voicedNoise = 0, voicedSilence = 0, n = 0;
  for (let i = 0; i + 128 <= x.length; i += 128) {
    if (!pt.push(x, i, 128)) continue;
    if (i > SR * 0.1 && i < SR * 0.5) { n++; if (pt.hz) voicedNoise++; }
    if (i > SR * 0.6 && pt.hz) voicedSilence++;
  }
  assert.ok(voicedNoise / n < 0.05, `noise voiced ${voicedNoise}/${n}`);
  assert.equal(voicedSilence, 0);
});

test('歌：音程を半音の 1/2 以内で追い、子音をスネア・ハイハットとして扱わない（歌のタイプ）', () => {
  for (const s of [V.sing({}), V.sing({ bpm: 120, female: false, seed: 7 })]) {
    const r = analyze(VJ, s.samples, SR, { profile: 'voice', keepFrames: true });
    const errs = [];
    for (const n of s.notes) {
      for (const f of r.frames) if (f.t > n.t + 0.12 && f.t < n.t + n.dur - 0.05 && f.voiced > 0.5) errs.push(Math.abs(f.pitch * 48 + 36 - n.midi));
    }
    errs.sort((a, b) => a - b);
    assert.ok(errs.length > 100, 'voiced frames ' + errs.length);
    assert.ok(errs[Math.floor(errs.length * 0.9)] < 0.6, '90% pitch error ' + errs[Math.floor(errs.length * 0.9)]);
    assert.equal(r.log.filter((o) => o.type === 'snare' || o.type === 'hat').length, 0);
    const sc = score(s.onsets, times(r.log, 'kick', SR), 0.1);
    assert.ok(sc.recall >= 0.8 && sc.precision >= 0.8, JSON.stringify(sc));
  }
});

test('歌：レガート（音量が下がらずに音程だけ変わる）も 0.1 秒以内に拾う', () => {
  const s = V.sing({ legato: 0.8, seed: 3 });
  const plain = score(s.onsets, times(analyze(VJ, s.samples, SR, { profile: 'acoustic' }).log, 'kick', SR), 0.1);
  const r = analyze(VJ, s.samples, SR, { profile: 'voice' });
  const sc = score(s.onsets, times(r.log, 'kick', SR), 0.1);
  assert.ok(sc.recall >= 0.85 && sc.precision >= 0.9, JSON.stringify(sc));
  assert.ok(sc.recall > plain.recall + 0.1, `voice ${sc.recall} vs acoustic ${plain.recall}`);
});

test('歌：ビブラートのロングトーン・合唱の和音では、音程の変わり目を出しすぎない', () => {
  const long = analyze(VJ, V.longTones({}).samples, SR, { profile: 'voice' });
  assert.ok(long.log.filter((o) => o.type === 'note').length <= 1, 'long tone notes ' + long.log.filter((o) => o.type === 'note').length);
  const c = V.choir({});
  const r = analyze(VJ, c.samples, SR, { profile: 'voice' });
  const sc = score(c.onsets, times(r.log, 'kick', SR), 0.2);
  assert.ok(sc.precision >= 0.8, 'choir ' + JSON.stringify(sc));
});

test('話し声：司会のような話し声を数秒で話し声と判定する（男女・早口）', () => {
  for (const s of [V.speak({}), V.speak({ female: true, seed: 9 }), V.speak({ seed: 12, rate: 9 })]) {
    const r = analyze(VJ, s.samples, SR, { keepFrames: true });
    const first = r.frames.find((f) => f.speech);
    assert.ok(first && first.t < 5, 'detected at ' + (first && first.t));
    const after = r.frames.filter((f) => f.t > first.t);
    const rate = after.filter((f) => f.speech).length / after.length;
    assert.ok(rate > 0.85, 'speech rate ' + rate.toFixed(2));
  }
});

test('話し声：歌・合唱・ロングトーン・バンド演奏・ドラムの無い曲は話し声と判定しない', () => {
  const cases = [
    ['sing', V.sing({}).samples], ['sing-m', V.sing({ bpm: 120, female: false, seed: 7 }).samples], ['sing-fast', V.sing({ bpm: 150, seed: 8, legato: 0.1, vib: 0 }).samples],
    ['choir', V.choir({}).samples], ['long', V.longTones({}).samples],
    ['band', song({ bpm: 140, seed: 2, sections: [{ bars: 16, drums: '8beat', bass: true, guitar: 'chord' }] }).samples],
    ['four', song({ bpm: 128, seed: 4, sections: [{ bars: 16, drums: 'four', bass: true, guitar: 'chord' }] }).samples],
    ['arp', song({ bpm: 100, seed: 3, sections: [{ bars: 12, drums: 'none', keys: 'arp' }] }).samples],
    ['ballad', song({ bpm: 72, seed: 5, sections: [{ bars: 10, drums: 'none', keys: 'ballad', vocal: true }] }).samples],
    ['demo', VJ.synth.demoSong(SR).samples],
  ];
  for (const [name, x] of cases) {
    const r = analyze(VJ, x, SR, { keepFrames: true });
    const n = r.frames.filter((f) => f.speech).length;
    assert.ok(n === 0, `${name}: speech frames ${n}`);
  }
});

test('話し声：判定中は自動フラッシュの元（キメ・ブレイク明けの一撃）と拍を出さず、子音をドラム扱いしない', () => {
  const s = V.speak({ sec: 40, seed: 5 });
  const r = analyze(VJ, s.samples, SR, { keepFrames: true });
  const first = r.frames.find((f) => f.speech);
  const during = r.frames.filter((f) => f.speech);
  assert.ok(during.length > 1000);
  assert.equal(during.filter((f) => f.flags & (8 | 16 | 32 | 64)).length, 0, 'accent/impact/beat during speech');
  const late = r.log.filter((o) => o.sample / SR > first.t + 0.1 && (o.type === 'snare' || o.type === 'hat'));
  // 判定後のスネア・ハットは、話し声でなくなった短い間（句の間の判定の揺れ）だけ
  assert.ok(late.length <= 3, 'snare/hat after detection ' + late.length);
  // 判定前も含めて自動フラッシュの元はほとんど出ない
  assert.ok(r.frames.filter((f) => f.flags & (8 | 16)).length <= 2, 'flash triggers ' + r.frames.filter((f) => f.flags & (8 | 16)).length);
});

test('話し声 → 演奏に戻ると、話し声の判定が解除されて拍が戻る', () => {
  const sp = V.speak({ sec: 15, seed: 6 });
  const band = song({ bpm: 120, seed: 2, sections: [{ bars: 12, drums: '8beat', bass: true, guitar: 'chord' }] });
  const x = new Float32Array(sp.samples.length + band.samples.length);
  x.set(sp.samples); x.set(band.samples, sp.samples.length);
  const r = analyze(VJ, x, SR, { keepFrames: true });
  const t0 = sp.samples.length / SR;
  assert.ok(r.frames.some((f) => f.t < t0 && f.speech), 'speech detected');
  const late = r.frames.filter((f) => f.t > t0 + 6);
  assert.ok(late.every((f) => !f.speech), 'speech cleared');
  assert.ok(late.some((f) => f.flags & 32), 'beats back');
});

test('音程の履歴：有声のところは 0..1、無声は -1', () => {
  const s = V.sing({ bars: 4 });
  const fx = new VJ.dsp.FeatureExtractor({ sampleRate: SR });
  fx.process(s.samples.subarray(0, SR * 4));
  const f = fx.computeFrame(new Float32Array(4096), 4, 1 / 60);
  const h = Array.from(f.pitchHist);
  assert.equal(h.length, 128);
  assert.ok(h.filter((v) => v >= 0 && v <= 1).length > 40, 'voiced points');
  assert.ok(h.every((v) => v === -1 || (v >= 0 && v <= 1)));
});
