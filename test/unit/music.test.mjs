// いろいろな音楽への対応：ドラムの無い曲・テンポ推定・タップテンポ・音楽タイプ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ, analyze, score, times } from '../helpers/load-src.mjs';

const VJ = loadVJ();
const SR = 48000;
const song = (o) => VJ.synth.song(Object.assign({ sampleRate: SR }, o));

const ARP = song({ bpm: 100, seed: 3, sections: [{ bars: 12, drums: 'none', keys: 'arp' }] });
const CHORDS = song({ bpm: 90, seed: 4, sections: [{ bars: 12, drums: 'none', keys: 'chords', vocal: true }] });
const BALLAD = song({ bpm: 72, seed: 5, sections: [{ bars: 10, drums: 'none', keys: 'ballad', vocal: true }] });

test('ドラムの無い曲（アコースティック設定）：ピアノ・ギターの発音をキックとして 85% 以上拾う', () => {
  for (const [name, s] of [['arp', ARP], ['chords', CHORDS], ['ballad', BALLAD]]) {
    const r = analyze(VJ, s.samples, SR, { profile: 'acoustic' });
    const sc = score(s.onsets.note, times(r.log, 'kick', SR));
    assert.ok(sc.recall >= 0.85 && sc.precision >= 0.9, `${name} ${JSON.stringify(sc)}`);
  }
});

test('おまかせ：ドラムが無い曲は数秒でメロディモードに切り替わり、ドラムのある曲は切り替わらない', () => {
  const r = analyze(VJ, ARP.samples, SR, { keepFrames: true });
  const first = r.frames.find((f) => f.melodic);
  assert.ok(first && first.t < 7, 'switched at ' + (first && first.t));
  // 切り替わった後は音符の多くを拾う
  const after = ARP.onsets.note.filter((t) => t > first.t + 0.5);
  const sc = score(after, times(r.log, 'kick', SR).filter((t) => t > first.t + 0.5));
  assert.ok(sc.recall >= 0.85, JSON.stringify(sc));
  for (const s of [
    song({ bpm: 140, seed: 2, sections: [{ bars: 12, drums: '8beat' }] }),
    song({ bpm: 120, seed: 6, sections: [{ bars: 12, drums: '8beat', bass: true, keys: 'chords' }] }),
    song({ bpm: 128, seed: 4, sections: [{ bars: 12, drums: 'four', bass: true, guitar: 'chord' }] }),
  ]) {
    const d = analyze(VJ, s.samples, SR, { keepFrames: true });
    assert.ok(!d.frames.some((f) => f.melodic), 'drum track switched to melodic');
  }
});

test('おまかせ：曲の途中でドラムが入ったらドラムのモードに戻る', () => {
  const s = song({ bpm: 110, seed: 9, sections: [{ bars: 6, drums: 'none', keys: 'arp' }, { bars: 8, drums: '8beat', bass: true, keys: 'arp' }] });
  const r = analyze(VJ, s.samples, SR, { keepFrames: true });
  const drumStart = 0.25 + 6 * 4 * (60 / 110);
  assert.ok(r.frames.some((f) => f.t < drumStart && f.melodic), 'melodic before drums');
  const late = r.frames.filter((f) => f.t > drumStart + 8);
  assert.ok(late.length && late.every((f) => !f.melodic), 'back to drums');
});

test('テンポ推定：いろいろな曲で ±2BPM 以内', () => {
  const cases = [
    [song({ bpm: 140, seed: 2, sections: [{ bars: 16, drums: '8beat' }] }), 140],
    [song({ bpm: 128, seed: 4, sections: [{ bars: 16, drums: 'four', bass: true, guitar: 'chord' }] }), 128],
    [song({ bpm: 96, seed: 7, sections: [{ bars: 12, drums: 'half', bass: true, guitar: 'chord' }] }), 96],
    [song({ bpm: 174, seed: 8, sections: [{ bars: 20, drums: '8beat', bass: true, guitar: 'chug' }] }), 174],
    [ARP, 100],
    [BALLAD, 72],
  ];
  for (const [s, bpm] of cases) {
    const r = analyze(VJ, s.samples, SR, { keepFrames: true });
    const f = r.frames[r.frames.length - 1];
    assert.ok(Math.abs(f.bpm - bpm) <= 2, `expected ${bpm} got ${f.bpm.toFixed(1)} (conf ${f.conf.toFixed(2)})`);
  }
});

test('テンポ推定：シャッフル・ファンク・ヒップホップ・2 ビート・まばらなドラムでも、倍・半分・3:2 に取り違えず ±3%', () => {
  const S = (drums, bpm, seed, bars = 20) => song({ bpm, seed, humanize: 0.008, sections: [{ bars, drums, bass: true, guitar: 'chord', vocal: true }] });
  const cases = [
    [S('shuffle', 110, 11), 110],
    [S('funk', 104, 12), 104],
    [S('hiphop', 88, 13), 88],
    [S('twobeat', 184, 14, 28), 184], // 裏にスネアの 2 ビート（3:2 の 123 に取りやすい）
    [S('sparse', 68, 15, 14), 68],
    [song({ bpm: 132, seed: 16, sections: [{ bars: 20, drums: '8beat', bass: true, guitar: 'chug' }] }), 132], // 刻みのギター（88 に取りやすい）
  ];
  for (const [s, bpm] of cases) {
    const r = analyze(VJ, s.samples, SR, { keepFrames: true });
    const late = r.frames.filter((f) => f.t > 12 && f.conf > 0.2);
    const ok = late.filter((f) => Math.abs(f.bpm - bpm) / bpm < 0.03).length / Math.max(1, late.length);
    assert.ok(ok >= 0.9, `${bpm}: ${(ok * 100).toFixed(0)}% ok, last ${r.frames[r.frames.length - 1].bpm.toFixed(1)}`);
  }
});

test('テンポ推定：ドラムの無い曲で速いテンポ（倍）に上げすぎない', () => {
  const r = analyze(VJ, ARP.samples, SR, { keepFrames: true });
  const late = r.frames.filter((f) => f.t > 10);
  assert.ok(late.every((f) => f.bpm < 165), 'max ' + Math.max(...late.map((f) => f.bpm)).toFixed(1));
});

test('タップテンポ：何回たたいても、最初のタップが小節の頭（直近 8 回だけ覚えていても数はずれない）', () => {
  for (const n of [3, 4, 8, 9, 10, 11, 13]) {
    const tr = new VJ.dsp.TempoTracker(SR, 128);
    for (let i = 0; i < n; i++) tr.tap(SR + i * SR * 0.5);
    assert.ok(Math.abs(tr.state(SR + 16 * SR * 0.5).bar) < 1e-6, `${n} taps`);
  }
});

test('拍の位置：拍フラグがキックの位置とそろう', () => {
  const s = song({ bpm: 120, seed: 1, humanize: 0, sections: [{ bars: 16, drums: 'click' }] });
  const r = analyze(VJ, s.samples, SR, { keepFrames: true });
  const beats = r.frames.filter((f) => f.t > 10 && (f.flags & 32)).map((f) => f.t);
  assert.ok(beats.length >= 30, 'beats ' + beats.length);
  // 各拍フラグは直前のキックから 1 フレーム程度以内
  const kicks = s.onsets.kick;
  const errs = beats.map((t) => Math.min(...kicks.map((k) => Math.abs(t - k))));
  errs.sort((a, b) => a - b);
  assert.ok(errs[Math.floor(errs.length / 2)] < 0.04, 'median beat error ' + errs[Math.floor(errs.length / 2)]);
  // 小節の頭（ダウンビート）は 4 拍に 1 回
  const downs = r.frames.filter((f) => f.t > 10 && (f.flags & 64)).length;
  assert.ok(Math.abs(downs - beats.length / 4) <= 2, `downbeats ${downs} beats ${beats.length}`);
});

test('タップテンポ：3 回以上たたくと BPM が決まり、自動推定より優先される', () => {
  const fx = new VJ.dsp.FeatureExtractor({ sampleRate: SR });
  const s = song({ bpm: 140, seed: 2, sections: [{ bars: 8, drums: '8beat' }] }).samples;
  fx.process(s.subarray(0, SR * 6));
  let bpm = 0;
  for (let i = 0; i < 4; i++) {
    bpm = fx.tap();
    fx.process(s.subarray(SR * 6 + i * SR * 0.5, SR * 6 + (i + 1) * SR * 0.5)); // 0.5 秒ごと = 120BPM
  }
  assert.ok(Math.abs(bpm - 120) < 1, 'tap bpm ' + bpm);
  fx.process(s.subarray(SR * 8, SR * 12));
  const f = fx.computeFrame(new Float32Array(8192), 12, 1 / 60);
  assert.ok(Math.abs(f.bpm - 120) < 1 && f.tempoManual, 'manual held ' + f.bpm);
});

test('音楽タイプ：解析パラメータの上書きは元の設定を壊さない', () => {
  const base = JSON.stringify(VJ.dspConfig);
  const h = VJ.makeDspConfig({ profile: 'hiphop', gateDb: -60 });
  assert.equal(h.bands[0].lo, 28);
  assert.equal(h.bands[0].hi, 150);
  assert.equal(h.bands[1].lo, 150);
  assert.equal(h.silenceAbsDb, -60);
  assert.equal(h.onset.kick.relDb, 7);
  assert.equal(h.onset.kick.W, 4);
  assert.equal(JSON.stringify(VJ.dspConfig), base);
  assert.equal(VJ.profileById('nope').id, 'auto');
  for (const p of VJ.profiles) {
    for (const tier of Object.values(p.show.tiers)) for (const id of tier) assert.ok(VJ.scenes.byId[id], `${p.id}: ${id}`);
  }
});

test('音楽タイプ：EDM でも 4 つ打ちのキックを取りこぼさない', () => {
  const s = song({ bpm: 128, seed: 4, sections: [{ bars: 16, drums: 'four', bass: true, guitar: 'chord' }] });
  const r = analyze(VJ, s.samples, SR, { profile: 'dance' });
  const sc = score(s.onsets.kick, times(r.log, 'kick', SR));
  assert.ok(sc.recall >= 0.9 && sc.precision >= 0.9, JSON.stringify(sc));
});
