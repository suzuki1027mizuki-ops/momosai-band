// 本番の記録（src/show/recorder.js）：1 秒ごとのまとめ・出来事・例外・保存する分の取り出し・CSV
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ } from '../helpers/load-src.mjs';

const VJ = loadVJ();
const { Recorder, toCSV } = VJ.recorder;
const T0 = new Date(2026, 9, 16, 19, 30, 0).getTime(); // この PC の時刻で 19:30:00
const st = (over) => Object.assign({ input: 'mic', meter: { l: -20.4, r: -22.6 }, flags: 0, bpm: 128.4, beatConf: 0.734, speech: false, melodic: false, scale: 0.9, denied: 0, scene: 'ripple', song: 'M1 Alpha', media: 'image', guard: '' }, over || {});

test('記録：毎フレームは数を足すだけで、1 秒ごとに 1 行にまとめる（検出の数・fps・最長のフレーム・フラッシュの却下）', () => {
  const r = new Recorder();
  for (let i = 0; i < 60; i++) r.frame(T0 + i * 16.6, i === 30 ? 45 : 16.6, st({ flags: i % 15 === 0 ? 1 | 8 : i % 10 === 0 ? 2 : 0, denied: i > 40 ? 2 : 0 }));
  r.frame(T0 + 1000, 16.6, st({ denied: 2 }));
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.deepEqual([row.kick, row.accent, row.snare], [4, 4, 4]);
  assert.equal(row.fps, 61 - 1);
  assert.equal(row.maxFrame, 45);
  assert.equal(row.denied, 2, 'その 1 秒で増えた分');
  assert.deepEqual([row.levelL, row.levelR, row.bpm, row.beatConf, row.scale], [-20, -23, 128, 0.73, 0.9]);
  assert.deepEqual([row.scene, row.song, row.input], ['ripple', 'M1 Alpha', 'mic']);
});

test('記録：出来事と例外は、その秒の行に入る。フレームの合間に来た出来事は次の秒に入る', () => {
  const r = new Recorder();
  r.frame(T0, 16, st());
  r.event(T0 + 100, 'シーン: 波紋');
  r.event(T0 + 200, '暗転,ON\n');
  r.error(T0 + 300, 'TypeError: x');
  r.event(T0 + 1500, 'M2 Beta'); // まだ 1 秒目のフレームが来ていない
  r.frame(T0 + 1600, 16, st());
  r.frame(T0 + 2600, 16, st());
  assert.equal(r.rows[0].events, 'シーン: 波紋 / 暗転 ON / 例外：TypeError: x');
  assert.equal(r.rows[0].errors, 1);
  assert.equal(r.rows[1].events, 'M2 Beta');
  assert.equal(r.errors, 1);
});

test('記録：保存する分は、まだ保存していない行だけ（1 分ごとに足していく）。古い行は保存してから捨てる', () => {
  const r = new Recorder({ keepRows: 100 });
  for (let s = 0; s < 70; s++) r.frame(T0 + s * 1000, 16, st());
  const a = r.takeUnsaved();
  assert.equal(a.length, 69, 'いまの秒は含めない');
  for (let s = 70; s < 130; s++) r.frame(T0 + s * 1000, 16, st());
  const b = r.takeUnsaved();
  assert.equal(b.length, 60);
  assert.equal(b[0].t, T0 + 69 * 1000, '前に取り出した続きから');
  for (let s = 130; s < 250; s++) r.frame(T0 + s * 1000, 16, st());
  assert.ok(r.rows.length <= 100 + 60, 'メモリには上限くらいまで');
  const c = r.takeUnsaved();
  assert.equal(c[0].t, T0 + 129 * 1000, '保存していない行は捨てない');
  assert.equal(c.length, 120);
});

test('記録：CSV は BOM 付き・見出しつき・時刻は日付と時刻。カンマや引用符の入った値も崩れない', () => {
  const r = new Recorder();
  r.frame(T0, 16, st({ song: 'M1 "Hello, World"' }));
  r.event(T0 + 10, 'キュー: A');
  r.frame(T0 + 1000, 16, st());
  const csv = toCSV(r.rows);
  assert.ok(csv.startsWith('﻿時刻,入力,'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith('2026-10-16 19:30:00,mic,-20,-23,'));
  assert.ok(lines[1].includes('"M1 ""Hello, World"""'));
  assert.ok(lines[1].endsWith(',キュー: A'));
  assert.equal(lines[0].split(',').length, VJ.recorder.COLS.length);
});
