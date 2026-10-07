// 設定の読み込み：型の確認・既定値を共有しない・壊れた値を捨てる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ } from '../helpers/load-src.mjs';

const VJ = loadVJ();

test('設定：書き換えても既定値は変わらない（初期設定に戻すで本当に戻る）', () => {
  const before = JSON.stringify(VJ.defaultSettings);
  const a = VJ.storage.fromJSON('{}');
  a.messages[0] = 'テロップ';
  a.autoScenes.ripple = false;
  a.sceneParams.orb = [1, 2];
  a.midiMap.n1 = 'flash';
  a.output.size = 0.5;
  assert.equal(JSON.stringify(VJ.defaultSettings), before);
  const b = VJ.storage.fromJSON('{}');
  assert.equal(b.messages[0], '');
  assert.deepEqual(b.autoScenes, {});
});

test('設定：型の合わない値・壊れた中身は捨てる', () => {
  const s = VJ.storage.fromJSON(JSON.stringify({
    bandName: 123, master: 'x', react: null, output: null, autoScenes: [1, 2], sensitivity: 3,
    sceneParams: { orb: [0.5, 'x'], waves: [1, 2, 3], bad: 'no', many: [1, 2, 3, 4, 5] },
    midiMap: { n36: 'scene:orb', x1: 'flash', c7: 5, c8: 'master' },
    messages: ['a', 2, 'c'], crossfade: 1, speechTitle: true,
  }));
  assert.equal(s.bandName, VJ.defaultSettings.bandName);
  assert.equal(s.master, VJ.defaultSettings.master);
  assert.equal(s.react, VJ.defaultSettings.react);
  assert.deepEqual(s.output, VJ.defaultSettings.output);
  assert.deepEqual(s.autoScenes, {});
  assert.equal(s.sensitivity, 3);
  assert.deepEqual(s.sceneParams, { waves: [1, 2, 3] });
  assert.deepEqual(s.midiMap, { n36: 'scene:orb', c8: 'master' });
  assert.deepEqual(s.messages, ['a', '', 'c']);
  assert.equal(s.crossfade, 1);
  assert.equal(s.speechTitle, true);
  assert.throws(() => VJ.storage.fromJSON('{not json'));
});
