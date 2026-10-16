// 録音で解析を確かめる道具（tools/corpus-lib.mjs）：WAV の読み取り・ラベル・照合・前回との比較。合成音源で既存のテストと同じ数字になる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadVJ, ROOT, analyze, score, times } from '../helpers/load-src.mjs';
import { readWav, toMono, readLabels, matchOnsets, analyzeSamples, secondsCSV, compareSummaries } from '../../tools/corpus-lib.mjs';

/** テスト用の WAV を作る（format 1 = PCM / 3 = 浮動小数、extensible なら WAVE_FORMAT_EXTENSIBLE） */
function wav(channels, sr, bits, format, extensible) {
  const nc = channels.length, n = channels[0].length, bps = bits / 8;
  const fmtLen = extensible ? 40 : 16;
  const data = Buffer.alloc(n * nc * bps);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    const v = channels[c][i], p = (i * nc + c) * bps;
    if (format === 3) data.writeFloatLE(v, p);
    else if (bits === 16) data.writeInt16LE(Math.round(v * 32767), p);
    else if (bits === 24) data.writeIntLE(Math.round(v * 8388607), p, 3);
  }
  const fmt = Buffer.alloc(fmtLen);
  fmt.writeUInt16LE(extensible ? 0xfffe : format, 0); fmt.writeUInt16LE(nc, 2); fmt.writeUInt32LE(sr, 4);
  fmt.writeUInt32LE(sr * nc * bps, 8); fmt.writeUInt16LE(nc * bps, 12); fmt.writeUInt16LE(bits, 14);
  if (extensible) { fmt.writeUInt16LE(22, 16); fmt.writeUInt16LE(format, 24); }
  const head = Buffer.alloc(12);
  head.write('RIFF', 0); head.writeUInt32LE(4 + 8 + fmtLen + 8 + data.length, 4); head.write('WAVE', 8);
  const chunk = (id, b) => { const h = Buffer.alloc(8); h.write(id, 0); h.writeUInt32LE(b.length, 4); return Buffer.concat([h, b]); };
  return Buffer.concat([head, chunk('fmt ', fmt), chunk('LIST', Buffer.from('xx')), chunk('data', data)]);
}

test('録音の道具：WAV（16・24 ビット・浮動小数・EXTENSIBLE・ステレオ）を読み、左右をパネルと同じに選ぶ', () => {
  const L = Float32Array.from([0, 0.5, -0.5, 0.25]), R = Float32Array.from([0.1, -0.1, 0.2, -0.2]);
  for (const [bits, format, ext, eps] of [[16, 1, false, 1e-4], [24, 1, false, 1e-6], [32, 3, false, 1e-7], [24, 1, true, 1e-6]]) {
    const w = readWav(wav([L, R], 44100, bits, format, ext));
    assert.equal(w.sr, 44100);
    assert.equal(w.channels.length, 2);
    w.channels[0].forEach((v, i) => assert.ok(Math.abs(v - L[i]) < eps, `${bits}bit L[${i}] ${v}`));
    assert.ok(Math.abs(toMono(w.channels, 'mix')[1] - 0.2) < 1e-3);
    assert.equal(toMono(w.channels, 'right'), w.channels[1]);
  }
  assert.throws(() => readWav(Buffer.from('not a wav file at all')), /WAV/);
});

test('録音の道具：Audacity のラベルを読み、手で付けた正解と検出を前後同じ幅で照らす', () => {
  const lb = readLabels('0.500000\t0.500000\tk\r\n1.000\t1.000\tKick\nbad line\n1.5\t1.5\tb\n');
  assert.deepEqual(lb, [{ t: 0.5, label: 'k' }, { t: 1, label: 'kick' }, { t: 1.5, label: 'b' }]);
  const m = matchOnsets([0.5, 1.0, 2.0], [0.46, 1.03, 1.5], 0.05);
  assert.deepEqual([m.tp, m.fp, m.fn], [2, 1, 1]);
});

test('録音の道具：合成音源（正解つき）で、単体テストの解析と同じ検出・テンポになり、1 秒ごとの表を作る', () => {
  const p = path.join(ROOT, 'test/fixtures/drums.wav');
  if (!fs.existsSync(p)) return; // npm run fixtures の前
  const VJ = loadVJ();
  const w = readWav(fs.readFileSync(p));
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/drums.json'), 'utf8'));
  const labels = truth.onsets.kick.map((t) => ({ t, label: 'kick' }));
  const { seconds, summary } = analyzeSamples(VJ, toMono(w.channels), w.sr, { labels, tol: 0.03 });
  // 同じ音声を単体テストと同じ方法で解析したときの数字
  const ref = analyze(VJ, toMono(w.channels), w.sr, {});
  const kicks = times(ref.log, 'kick', w.sr);
  assert.equal(summary.kick, kicks.length);
  const s = score(truth.onsets.kick, kicks, 0.03);
  assert.ok(Math.abs(summary.kickRecall - s.recall) < 0.02, `再現率 ${summary.kickRecall} / ${s.recall}`);
  assert.ok(summary.kickRecall > 0.9, `合成のドラムはほとんど拾う ${summary.kickRecall}`);
  assert.equal(seconds.length, Math.ceil(truth.duration));
  assert.equal(seconds.reduce((a, r) => a + r.kick, 0), summary.kick);
  const csv = secondsCSV(seconds);
  assert.ok(csv.startsWith('﻿秒,音量,キック'));
});

test('録音の道具：前回より悪くなった数字だけを示す', () => {
  const base = { 'a.wav': { kickRecall: 0.95, kickPrecision: 0.9, bpmError: 0.5 }, 'b.wav': { kickRecall: 0.8 } };
  const now = { 'a.wav': { kickRecall: 0.9, kickPrecision: 0.91, bpmError: 2.0 }, 'b.wav': { kickRecall: 0.79 }, 'c.wav': { kickRecall: 0.1 } };
  assert.deepEqual(compareSummaries(now, base), ['a.wav: kickRecall 0.95 → 0.9', 'a.wav: bpmError 0.5% → 2%']);
});
