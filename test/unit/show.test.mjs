// 演出まわり（セットリスト・フラッシュ制限・コントローラ・光過敏判定）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ } from '../helpers/load-src.mjs';
import { transitions, maxFlashesPerSecond } from '../helpers/flash.mjs';

const VJ = loadVJ();

test('セットリスト：全角記号・番号・コメント・未知の指定', () => {
  const p = VJ.setlist.parse([
    '@band　ももさいバンド',
    '# コメント',
    '',
    '１．夜に駆ける｜２、６｜neon',
    '02) ドライフラワー | オーロラ | さくら | notitle',
    '22才の別れ | 99 | nope',
    '3 マリーゴールド',
    '@end ありがとう！',
  ].join('\n'));
  assert.equal(p.band, 'ももさいバンド');
  assert.equal(p.end, 'ありがとう！');
  assert.equal(p.songs.length, 4);
  assert.deepEqual(p.songs[0], { title: '夜に駆ける', scenes: ['tunnel', 'glitch'], palette: 0, notitle: false, line: 4 });
  assert.equal(p.songs[1].title, 'ドライフラワー');
  assert.deepEqual(p.songs[1].scenes, ['aurora']);
  assert.equal(p.songs[1].palette, 6);
  assert.equal(p.songs[1].notitle, true);
  assert.equal(p.songs[2].title, '22才の別れ');
  assert.equal(p.songs[3].title, 'マリーゴールド');
  assert.equal(p.errors.length, 2); // 99 と nope
});

test('フラッシュ制限：1 秒に 3 回まで・200ms 間隔・赤は白に', () => {
  const lim = new VJ.safety.FlashLimiter();
  let ok = 0;
  for (let i = 0; i < 10; i++) if (lim.allow(i * 0.1)) ok++;
  assert.equal(ok, 3);
  // 1 秒の窓が過ぎればまた光る
  assert.ok(lim.allow(1.5));
  const l2 = new VJ.safety.FlashLimiter();
  assert.ok(l2.allow(0));
  assert.ok(!l2.allow(0.15));
  assert.ok(l2.allow(0.21));
  assert.deepEqual(VJ.safety.safeFlashColor([1, 0.1, 0.1]), [1, 1, 1]);
  assert.deepEqual(VJ.safety.safeFlashColor([0.2, 0.9, 1]), [0.2, 0.9, 1]);
});

function fakeFeatures(over) {
  return Object.assign({ active: true, silenceSec: 0, onsetFlags: 0, kick: 0, snare: 0, hat: 0, accent: 0, level: 0.5, intensity: 0.5, kickN: 0, snareN: 0 }, over || {});
}

test('コントローラ：シーン切替は次のビートまで待つ（最大 1 秒）・Shift で即時', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false });
  const c = new VJ.ShowController(s);
  c.update(fakeFeatures(), 1 / 60, 0);
  c.selectScene('tunnel');
  assert.equal(c.state.sceneId, 'title');
  assert.equal(c.state.pending.id, 'tunnel');
  c.update(fakeFeatures(), 1 / 60, 0.2);
  assert.equal(c.state.sceneId, 'title');
  c.update(fakeFeatures({ onsetFlags: 1, kick: 0.9 }), 1 / 60, 0.3);
  assert.equal(c.state.sceneId, 'tunnel');
  c.selectScene('glitch');
  c.update(fakeFeatures(), 1 / 60, 1.4); // 1 秒経過で強制
  assert.equal(c.state.sceneId, 'glitch');
  c.selectScene('aurora', { immediate: true });
  assert.equal(c.state.sceneId, 'aurora');
});

test('コントローラ：曲送り・曲名表示・終演・戻る', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, setlistText: 'A | 2 | fire\nB | 4,5\n@end おわり' });
  const c = new VJ.ShowController(s);
  c.update(fakeFeatures(), 1 / 60, 10);
  c.nextSong();
  assert.equal(c.state.sceneId, 'tunnel');
  assert.equal(c.state.paletteIdx, 3);
  assert.equal(c.state.text.main, 'A');
  c.update(fakeFeatures(), 1 / 60, 10.5);
  assert.ok(c.textAlpha() > 0.99);
  c.nextSong();
  assert.equal(c.state.sceneId, 'aurora');
  c.nextSong();
  assert.equal(c.state.endState, true);
  assert.equal(c.state.sceneId, 'title');
  assert.equal(c.titleText(), 'おわり');
  c.prevSong();
  assert.equal(c.currentSong().title, 'B');
  c.prevSong(); c.prevSong();
  assert.equal(c.state.songIdx, -1);
  assert.equal(c.titleText(), 'MOMOSAI BAND');
});

test('コントローラ：ストロボもフラッシュ制限を超えない・暗転はフェード', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, autoFlash: true });
  const c = new VJ.ShowController(s);
  c.setStrobe(true);
  let t = 0, flashes = 0, prev = 0;
  for (let i = 0; i < 120; i++) {
    t += 1 / 60;
    const f = fakeFeatures({ onsetFlags: i % 4 === 0 ? 1 | 8 : 0, kick: 1 });
    c.update(f, 1 / 60, t);
    if (c.state.flash > prev + 0.2) flashes++;
    prev = c.state.flash;
  }
  assert.ok(flashes <= 6, `flashes in 2s: ${flashes}`);
  c.setBlackout(true);
  c.update(fakeFeatures(), 0.25, t + 0.25);
  assert.ok(c.state.black > 0.4 && c.state.black < 0.6);
  c.update(fakeFeatures(), 0.3, t + 0.55);
  assert.equal(c.state.black, 1);
});

test('オート：一定時間後のアクセントで切替・無音でタイトル・強打で復帰', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: true, setlistText: '' });
  const c = new VJ.ShowController(s);
  c._applyScene('ripple');
  let t = 0;
  const step = (f) => { t += 1 / 60; c.update(fakeFeatures(f), 1 / 60, t); };
  for (let i = 0; i < 60 * 10; i++) step();
  step({ onsetFlags: 8, accent: 1 });
  assert.equal(c.state.sceneId, 'ripple', '24 秒未満では切り替えない');
  for (let i = 0; i < 60 * 20; i++) step();
  step({ onsetFlags: 8, accent: 1 });
  assert.notEqual(c.state.sceneId, 'ripple');
  const before = c.state.sceneId;
  for (let i = 0; i < 60 * 9; i++) step({ active: false, silenceSec: i / 60, level: 0 });
  assert.equal(c.state.sceneId, 'title');
  step({ onsetFlags: 1, kick: 0.9 });
  assert.equal(c.state.sceneId, before);
});

test('光過敏判定ヘルパー：3Hz 以下は通り、5Hz の点滅は検出', () => {
  const fps = 60;
  const sq = (hz) => Array.from({ length: fps * 3 }, (_, i) => (Math.floor((i / fps) * hz * 2) % 2 ? 0.6 : 0.05));
  assert.ok(maxFlashesPerSecond(sq(2), fps) <= 3);
  assert.ok(maxFlashesPerSecond(sq(5), fps) >= 4);
  assert.equal(transitions([0, 0.05, 0.02, 0.06]).length, 0);
});

test('MIDI：ノートでシーン・フラッシュ・暗転・曲送り、CC で明るさと感度', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, setlistText: 'A | 3' });
  const c = new VJ.ShowController(s);
  c.update(fakeFeatures(), 1 / 60, 5);
  assert.ok(VJ.midi.handle(c, [0x90, 37, 100]));
  assert.equal(c.state.sceneId, 'tunnel');
  assert.ok(VJ.midi.handle(c, [0x90, 44, 100]));
  assert.equal(c.state.blackout, true);
  assert.ok(VJ.midi.handle(c, [0x90, 46, 100]));
  assert.equal(c.currentSong().title, 'A');
  assert.ok(VJ.midi.handle(c, [0x90, 43, 100]));
  assert.ok(c.state.flash > 0.8);
  assert.ok(VJ.midi.handle(c, [0xb0, 1, 0]));
  assert.equal(c.state.master, 0.2);
  assert.ok(VJ.midi.handle(c, [0xb0, 2, 127]));
  assert.equal(c.state.sens, 5);
  assert.equal(VJ.midi.handle(c, [0x80, 37, 0]), false); // ノートオフは無視
  c.lock();
  assert.equal(VJ.midi.handle(c, [0x90, 36, 100]), false); // ロック中は暗転以外無視
  assert.equal(c.state.sceneId, 'horizon');
});

test('キー割り当て：数字・Shift+数字・テンキーがすべてのシーンに対応', () => {
  const ids = new Set();
  for (const code of ['Digit', 'Numpad']) for (let d = 0; d <= 9; d++) for (const sh of [false, true]) ids.add(VJ.keys.sceneForKey(code + d, sh));
  for (const s of VJ.scenes.list) if (!s.hidden) assert.ok(ids.has(s.id), s.id);
  assert.equal(VJ.keys.sceneForKey('Numpad3', false), 'horizon');
  assert.equal(VJ.keys.sceneForKey('Digit0', false), 'title');
  assert.equal(VJ.keys.sceneForKey('Digit0', true), 'title');
  assert.equal(VJ.keys.sceneForKey('Digit1', true), 'orb');
  assert.equal(VJ.keys.sceneForKey('KeyA', false), null);
  // キーの重複が無い
  const keys = VJ.scenes.list.filter((s) => !s.hidden).map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('シーン切替：予約中に同じキーをもう一度押すと、拍を待たずに切り替わる', () => {
  const c = new VJ.ShowController(Object.assign({}, VJ.defaultSettings, { auto: false }));
  c.update(fakeFeatures(), 1 / 60, 1);
  c.selectScene('tunnel');
  assert.equal(c.state.sceneId, 'title');
  assert.equal(c.state.pending.id, 'tunnel');
  c.selectScene('tunnel');
  assert.equal(c.state.sceneId, 'tunnel');
});

test('曲ごとのパレットは、関係ない設定変更（バンド名の入力など）で元に戻らない', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, paletteIdx: 0, setlistText: 'A | 2 | fire' });
  const c = new VJ.ShowController(s);
  c.update(fakeFeatures(), 1 / 60, 1);
  c.nextSong();
  assert.equal(c.state.paletteIdx, 3);
  assert.equal(s.paletteIdx, 3, '設定にも反映（パネルの表示が今のパレットになる）');
  s.bandName = 'X';
  c.applySettings(s);
  assert.equal(c.state.paletteIdx, 3);
  c.setPalette(5); // パネルでパレットを選び直したとき
  assert.equal(c.state.paletteIdx, 5);
  assert.equal(s.paletteIdx, 5);
});

test('開演カウントダウン：日付をまたいでも表示・開演後と 1 曲目以降は消える', () => {
  const s = Object.assign({}, VJ.defaultSettings, { countdownTo: '00:10' });
  const c = new VJ.ShowController(s);
  assert.equal(c.countdownText(new Date(2026, 9, 6, 23, 50, 0)), '開演まで 20:00');
  s.countdownTo = '18:30';
  assert.equal(c.countdownText(new Date(2026, 9, 6, 17, 0, 0)), '開演まで 1:30:00');
  assert.equal(c.countdownText(new Date(2026, 9, 6, 18, 31, 0)), '');
  c.state.songIdx = 0;
  assert.equal(c.countdownText(new Date(2026, 9, 6, 17, 0, 0)), '');
});
