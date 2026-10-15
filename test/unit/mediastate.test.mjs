// 曲のメディア（m:…）と操作者の選択（src/show/mediastate.js）：出来事 × 状態の表で、状態と「出す・消す」の結果を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ } from '../helpers/load-src.mjs';

const VJ = loadVJ();
const M = () => VJ.mediaState;
const LIB = [{ id: 'Llogo', name: 'ロゴ', kind: 'image', key: 'k1' }];
const SONG = { media: 'ロゴ' }, OFF = { media: 'off' }, PLAIN = {};

/** 設定・状態を用意して、出来事を 1 つ起こし、[状態, overlayOn, 戻り値] を返す */
function run({ on = false, st = {}, sigChanged = false }, ev) {
  const s = VJ.storage.merge(VJ.defaultSettings, { mediaLib: LIB, overlayOn: on });
  s.overlay.image = 'data:image/png;base64,AAAA';
  const state = Object.assign(M().create(), { sigAt: M().sig(s) }, st);
  if (sigChanged) s.overlay.image = 'data:image/png;base64,BBBB';
  const r = ev(state, s);
  return [{ manual: state.manual, songOn: state.songOn }, s.overlayOn, r];
}

const ROWS = [
  // [場面, 用意, 出来事, 期待する状態, 期待する overlayOn, 期待する戻り値（省略可）]
  ['曲が始まる：指定あり・消えていた → 出して、あとで戻す印', { on: false }, (st, s) => M().songStart(st, s, SONG), { manual: false, songOn: true }, true],
  ['曲が始まる：指定あり・出ていた → そのまま（戻す印は付けない）', { on: true }, (st, s) => M().songStart(st, s, SONG), { manual: false, songOn: false }, true],
  ['曲が始まる：指定あり・前の曲の指定で出していた → 戻す印は残す', { on: true, st: { songOn: true } }, (st, s) => M().songStart(st, s, SONG), { manual: false, songOn: true }, true],
  ['曲が始まる：指定なし・前の曲の指定で出していた → 消す', { on: true, st: { songOn: true } }, (st, s) => M().songStart(st, s, PLAIN), { manual: false, songOn: false }, false],
  ['曲が始まる：m:off・前の曲の指定で出していた → 消す', { on: true, st: { songOn: true } }, (st, s) => M().songStart(st, s, OFF), { manual: false, songOn: false }, false],
  ['曲が始まる：指定なし・操作者が出していた → そのまま', { on: true }, (st, s) => M().songStart(st, s, PLAIN), { manual: false, songOn: false }, true],
  ['曲が始まる：前の曲で操作者が選んでいた → 選んだ印を消す', { on: true, st: { manual: true } }, (st, s) => M().songStart(st, s, SONG), { manual: false, songOn: false }, true],
  ['終演・開演前・バンドの切替：曲の指定で出していた → 消す', { on: true, st: { songOn: true } }, (st, s) => M().restore(st, s), { manual: false, songOn: false }, false],
  ['終演・開演前・バンドの切替：操作者が出していた → そのまま', { on: true }, (st, s) => M().restore(st, s), { manual: false, songOn: false }, true],
  ['設定を反映：曲の指定で出していたのをパネルで消した → 戻す印を消す', { on: false, st: { songOn: true } }, (st, s) => M().settingsApplied(st, s), { manual: false, songOn: false }, false],
  ['設定を反映：出たまま → 戻す印は残す', { on: true, st: { songOn: true } }, (st, s) => M().settingsApplied(st, s), { manual: false, songOn: true }, true],
  ['再開 → 選んだ印を消す', { on: true, st: { manual: true } }, (st, s) => M().resume(st, s), { manual: false, songOn: false }, true],
  ['操作者が選ぶ（一覧・キュー・カメラ）', { on: true, st: { songOn: true } }, (st) => M().override(st), { manual: true, songOn: false }, true],
  ['出すものを決める：設定のメディアが変わっていた → 操作者が選んだ', { on: true, st: { songOn: true }, sigChanged: true }, (st, s) => M().effective(st, s, SONG).song, { manual: true, songOn: false }, true, false],
  ['出すものを決める：変わっていない → 曲の指定', { on: true }, (st, s) => M().effective(st, s, SONG).key, { manual: false, songOn: false }, true, 'k1'],
  ['出すものを決める：m:off → 何も出さない', { on: true }, (st, s) => JSON.stringify(M().effective(st, s, OFF)), { manual: false, songOn: false }, true, '{"kind":"","song":true}'],
  ['出すものを決める：操作者が選んだあと → 設定のメディア', { on: true, st: { manual: true } }, (st, s) => M().effective(st, s, SONG).kind, { manual: true, songOn: false }, true, 'image'],
  ['O：m:off の曲で、ON なのに何も出ていない → 1 回で設定のメディアを出す', { on: true }, (st, s) => M().toggle(st, s, OFF), { manual: true, songOn: false }, true, 'shown'],
  ['O：出ている → 消す（戻す印も消す）', { on: true, st: { songOn: true } }, (st, s) => M().toggle(st, s, SONG), { manual: false, songOn: false }, false, 'off'],
  ['O：消えている → 出す', { on: false }, (st, s) => M().toggle(st, s, PLAIN), { manual: false, songOn: false }, true, 'on'],
  ['出す（スマホ・キュー）：もう出ている → 変わらないが、戻す印は消す', { on: true, st: { songOn: true } }, (st, s) => M().set(st, s, SONG, true), { manual: false, songOn: false }, true, ''],
  ['出す：m:off の曲 → 設定のメディアを出す', { on: true }, (st, s) => M().set(st, s, OFF, true), { manual: true, songOn: false }, true, ''],
  ['消す', { on: true }, (st, s) => M().set(st, s, SONG, false), { manual: false, songOn: false }, false, 'off'],
];

test('曲のメディアの状態：出来事 × 状態の表（' + ROWS.length + ' 通り）', () => {
  for (const [name, setup, ev, wantSt, wantOn, wantR] of ROWS) {
    const [st, on, r] = run(setup, ev);
    assert.deepEqual(st, wantSt, name + '（状態）');
    assert.equal(on, wantOn, name + '（overlayOn）');
    if (wantR !== undefined) assert.equal(r, wantR, name + '（戻り値）');
  }
});

test('曲のメディアの状態：ShowController は状態機械を通す（曲の指定で出したメディアを、指定の無い曲で消す）', () => {
  const s = VJ.storage.merge(VJ.defaultSettings, { mediaLib: LIB, overlayOn: false, auto: false, setlistText: 'A | 1 | | m:ロゴ\nB | 1' });
  const c = new VJ.ShowController(s);
  c.nextSong();
  assert.equal(s.overlayOn, true);
  assert.equal(c.effectiveMedia().key, 'k1');
  c.nextSong();
  assert.equal(s.overlayOn, false);
});
