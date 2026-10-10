// メディアの一覧・曲ごとのメディア（m:…）・カメラ・キュー
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ } from '../helpers/load-src.mjs';
import { oscToCommand } from '../../bridge/server.mjs';

const VJ = loadVJ([...['src/core/', 'src/dsp/', 'src/audio/synth.js', 'src/audio/voicesynth.js', 'src/show/', 'src/scenes/', 'src/ui/midi.js', 'src/ui/keys.js'], 'src/io/']);
const fresh = (over) => Object.assign(VJ.storage.merge(VJ.defaultSettings, {}), { auto: false }, over || {});
const fakeFeatures = (over) => Object.assign({ active: true, silenceSec: 0, onsetFlags: 0, kick: 0, snare: 0, hat: 0, accent: 0, level: 0.5, intensity: 0.5, kickN: 0, snareN: 0 }, over || {});
const LIB = [
  { id: 'Lcam', name: 'ステージ', kind: 'camera', cameraId: 'dev1', mirror: true },
  { id: 'Llogo', name: 'ロゴ', kind: 'image', key: 'k1' },
  { id: 'Lmv', name: 'MV', kind: 'video', key: 'k2' },
  { id: 'Lyt', name: '12', kind: 'web', url: 'https://youtu.be/dQw4w9WgXcQ' },
];

test('メディアの一覧：形を確かめる（壊れた設定・古い版でも動く）', () => {
  assert.deepEqual(VJ.mediaLib.clean({ id: 'a', name: 'x', kind: 'camera', cameraId: 'c', mirror: 1 }), { id: 'a', name: 'x', kind: 'camera', cameraId: 'c', mirror: true });
  assert.equal(VJ.mediaLib.clean({ id: 'a', kind: 'image' }), null, '画像は中身の鍵が要る');
  assert.equal(VJ.mediaLib.clean({ id: 'a', kind: 'web', url: 'javascript:alert(1)' }), null);
  assert.equal(VJ.mediaLib.clean({ id: 'a b', kind: 'camera' }), null, 'id に空白');
  assert.equal(VJ.mediaLib.clean({ id: 'a', kind: 'capture' }), null, '画面の取り込みは一覧に入れない');
  assert.equal(VJ.mediaLib.clean({ id: 'a', kind: 'image', key: 'k', name: 'x'.repeat(99) }).name.length, 60);
  // 設定の読み込み：おかしなもの・同じ id は外す。キューも
  const s = VJ.storage.fromJSON(JSON.stringify({
    mediaLib: [LIB[0], { id: 'Lcam', kind: 'camera' }, { kind: 'image' }, 'x', LIB[1]],
    cues: [{ name: 'A', scene: 'tunnel', palette: 2, media: 'Lcam', ovScene: 'stars' }, { scene: 'test', palette: 999, media: '<x>', ovScene: 'nope' }, null],
    overlay: { mediaKind: 'lib', libId: 'Lcam', cameraId: 'x'.repeat(300) },
  }));
  assert.deepEqual(s.mediaLib.map((x) => x.id), ['Lcam', 'Llogo']);
  assert.deepEqual(s.cues, [{ name: 'A', scene: 'tunnel', palette: 2, media: 'Lcam', ovScene: 'stars' }, { name: '', scene: '', palette: -1, media: '', ovScene: '' }]);
  assert.equal(s.overlay.mediaKind, 'lib');
  assert.equal(s.overlay.cameraId.length, 200);
  assert.equal(VJ.storage.fromJSON(JSON.stringify({ overlay: { mediaKind: 'evil' } })).overlay.mediaKind, 'image');
});

test('メディアの一覧：m:… の指定（番号・名前・off）・セットリストに書く名前・名前の付け替え', () => {
  const s = fresh({ mediaLib: LIB.map((x) => Object.assign({}, x)) });
  assert.equal(VJ.mediaLib.find(s, '1').id, 'Lcam');
  assert.equal(VJ.mediaLib.find(s, ' ろご '), null);
  assert.equal(VJ.mediaLib.find(s, 'ロゴ').id, 'Llogo');
  assert.equal(VJ.mediaLib.find(s, 'mv').id, 'Lmv', '大文字・小文字は無視');
  assert.deepEqual(VJ.mediaLib.find(s, 'OFF'), { off: true });
  assert.equal(VJ.mediaLib.find(s, '9'), null);
  assert.equal(VJ.mediaLib.find(s, ''), null);
  // 数字だけの名前は番号と間違えるので、セットリストには番号で書く
  assert.equal(VJ.mediaLib.token(s, 'Llogo'), 'ロゴ');
  assert.equal(VJ.mediaLib.token(s, 'Lyt'), '4');
  assert.equal(VJ.mediaLib.uniqueName(s, 'ロゴ'), 'ロゴ 2');
  assert.equal(VJ.mediaLib.uniqueName(s, 'ロゴ', 'Llogo'), 'ロゴ', '自分自身とは重ならない');
  assert.deepEqual(VJ.mediaLib.keys(s), ['k1', 'k2']);
  assert.equal(VJ.mediaLib.label(s, 'Lmv'), 'm3');
  const text = '1. A | 2 | | m:ロゴ\n2. B ｜ 3 ｜ fire ｜ notitle ｜ m：ロゴ\n3. ロゴ | 4 | | m:ロゴ2\n# m:ロゴ';
  assert.equal(VJ.mediaLib.renameRefs(text, 'ロゴ', 'LOGO'), '1. A | 2 | | m:LOGO\n2. B ｜ 3 ｜ fire ｜ notitle ｜ m：LOGO\n3. ロゴ | 4 | | m:ロゴ2\n# m:ロゴ');
});

test('セットリスト：m:… の読み書き（表で編集しても消えない）', () => {
  const p = VJ.setlist.parse('A | 1 | | m:ロゴ\nB | | | notitle | メディア：off\nC');
  assert.deepEqual(p.songs.map((x) => x.media), ['ロゴ', 'off', '']);
  assert.equal(p.errors.length, 0);
  assert.equal(VJ.setlist.songLine({ title: 'A', scenes: [], palette: null, notitle: false, media: 'ロゴ' }, 0), '1. A |  |  | m:ロゴ');
  const back = VJ.setlist.parse(VJ.setlist.songLine({ title: 'A', scenes: ['tunnel'], palette: 3, notitle: true, media: 'MV' }, 0)).songs[0];
  assert.deepEqual([back.scenes, back.palette, back.notitle, back.media], [['tunnel'], 3, true, 'MV']);
  // 表で曲のメディアを変える
  const songs = p.songs.map((x) => Object.assign({}, x, { dirty: false }));
  songs[2].media = '2'; songs[2].dirty = true;
  assert.equal(VJ.setlist.parse(VJ.setlist.rewrite('A | 1 | | m:ロゴ\nB | | | notitle | メディア：off\nC', songs)).songs[2].media, '2');
});

test('曲ごとのメディア：曲が変わると出すメディアが変わる。m:off は出さない。曲の途中で選んだメディアが優先', () => {
  const s = fresh({ mediaLib: LIB.map((x) => Object.assign({}, x)), overlayOn: false, setlistText: 'A | 1 | | m:ステージ\nB | 2 | | m:off\nC | 3\nD | 4 | | m:ロゴ' });
  s.overlay.image = 'data:image/png;base64,AAAA';
  s.overlay.mediaKind = 'image';
  const c = new VJ.ShowController(s);
  c.update(fakeFeatures(), 1 / 60, 1);
  assert.equal(c.effectiveMedia().kind, 'image', '開演前は設定のメディア');
  c.nextSong();
  let e = c.effectiveMedia();
  assert.deepEqual([e.kind, e.cameraId, e.mirror, e.name, e.song], ['camera', 'dev1', true, 'ステージ', true]);
  assert.equal(s.overlayOn, true, '曲にメディアの指定があれば出す');
  c.update(fakeFeatures(), 1 / 60, 1.5);
  let fr = c.frame(fakeFeatures(), 1 / 60, null);
  assert.ok(fr.ovImage && fr.ovImage.mirror, 'カメラの左右反転');
  c.nextSong();
  assert.deepEqual([c.effectiveMedia().kind, c.effectiveMedia().song], ['', true]);
  c.update(fakeFeatures(), 1 / 60, 2.5);
  fr = c.frame(fakeFeatures(), 1 / 60, null);
  assert.equal(fr.ovImage, null, 'm:off の曲では出さない');
  c.nextSong();
  assert.equal(c.effectiveMedia().kind, 'image', '指定の無い曲は設定のメディア');
  // 曲の途中で一覧から選んだ（設定が変わった）→ 次の曲まではそちらが優先
  c.nextSong();
  assert.equal(c.effectiveMedia().key, 'k1');
  s.overlay.mediaKind = 'lib'; s.overlay.libId = 'Lmv';
  assert.equal(c.effectiveMedia().key, 'k2');
  c.prevSong(); c.nextSong();
  assert.equal(c.effectiveMedia().key, 'k1', '次の曲では曲の指定に戻る');
  // 同じものを選び直したとき（設定は変わらない）も、優先させられる
  c.overrideSongMedia();
  assert.equal(c.effectiveMedia().key, 'k2');
  // 一覧から消えたメディアは出さない
  s.overlay.libId = 'nope';
  assert.equal(c.effectiveMedia().kind, '');
});

test('曲ごとのメディア：m:off の曲でも O で出せば設定のメディアを出す', () => {
  const s = fresh({ mediaLib: LIB.map((x) => Object.assign({}, x)), setlistText: 'A | 1 | | m:off' });
  s.overlay.image = 'data:image/png;base64,AAAA';
  s.overlayOn = true;
  const c = new VJ.ShowController(s);
  c.nextSong();
  assert.equal(c.effectiveMedia().kind, '');
  c.toggleOverlay(); // OFF
  c.toggleOverlay(); // ON
  assert.equal(c.effectiveMedia().kind, 'image');
});

test('キュー：いまの状態を入れる・出す（そのままの項目は変えない）・説明', () => {
  const s = fresh({ mediaLib: LIB.map((x) => Object.assign({}, x)), overlayOn: true, ovSceneOn: false });
  s.overlay.mediaKind = 'lib'; s.overlay.libId = 'Lcam';
  const c = VJ.cues.capture(s, { sceneId: 'tunnel', paletteIdx: 4 }, 'サビ');
  assert.deepEqual(c, { name: 'サビ', scene: 'tunnel', palette: 4, media: 'Lcam', ovScene: 'off' });
  assert.equal(VJ.cues.capture(s, { sceneId: 'test', paletteIdx: 0 }).scene, '', 'テストパターンは入れない');
  s.overlayOn = false;
  assert.equal(VJ.cues.capture(s, { sceneId: 'ripple', paletteIdx: 0 }).media, 'off');
  // 出す：メディア・重ねるシーン
  const s2 = fresh({ mediaLib: LIB.map((x) => Object.assign({}, x)), overlayOn: false, ovSceneOn: false });
  assert.equal(VJ.cues.applySettings(s2, { media: 'Llogo', ovScene: 'stars' }), true);
  assert.deepEqual([s2.overlayOn, s2.overlay.mediaKind, s2.overlay.libId, s2.ovSceneOn, s2.overlay.scene], [true, 'lib', 'Llogo', true, 'stars']);
  assert.equal(VJ.cues.applySettings(s2, { media: '', ovScene: '' }), false, 'そのままなら何も変えない');
  VJ.cues.applySettings(s2, { media: 'off', ovScene: 'off' });
  assert.deepEqual([s2.overlayOn, s2.ovSceneOn, s2.overlay.libId], [false, false, 'Llogo']);
  assert.equal(VJ.cues.applySettings(s2, { media: 'Lgone' }), false, '消えたメディアは選ばない');
  VJ.i18n.lang = 'ja';
  assert.equal(VJ.cues.describe(s2, { scene: 'tunnel', palette: -1, media: 'Llogo', ovScene: 'off' }), `${VJ.sceneName(VJ.scenes.byId.tunnel)}・m2 ロゴ・重ね OFF`);
  assert.equal(VJ.cues.describe(s2, { scene: '', palette: -1, media: '', ovScene: '' }), '（何も変えない）');
  assert.equal(VJ.cues.describe(s2, { scene: '', palette: -1, media: 'Lgone', ovScene: '' }), '（消えたメディア）');
});

test('キュー：MIDI・スマホ・OSC から出す（1〜9 だけ）', () => {
  const s = fresh();
  const show = new VJ.ShowController(s);
  const fired = [];
  const cue = (i) => fired.push(i);
  s.midiMap = { n50: 'cue3' };
  assert.equal(VJ.midi.handle(show, [0x90, 50, 100], s, cue), true);
  assert.deepEqual(fired, [2]);
  assert.ok(VJ.midi.actions().some((a) => a.id === 'cue9'));
  VJ.net.app = { show, settings: s, ui: { toast() {} }, cue };
  assert.equal(VJ.net.exec('cue', [1]), true);
  assert.equal(VJ.net.exec('cue', [0]), false);
  assert.equal(VJ.net.exec('cue', [10]), false);
  assert.equal(VJ.net.exec('cue', ['2']), false);
  assert.deepEqual(fired, [2, 0]);
  show.lock();
  assert.equal(VJ.net.exec('cue', [2]), false, 'ロック中は出さない');
  assert.deepEqual(oscToCommand({ address: '/vj/cue', args: [4] }), { name: 'cue', args: [4] });
  assert.deepEqual(oscToCommand({ address: '/vj/cue/7', args: [1] }), { name: 'cue', args: [7] });
  assert.equal(oscToCommand({ address: '/vj/cue/7', args: [0] }), null, 'ボタンを離したとき');
  assert.equal(oscToCommand({ address: '/vj/cue', args: [12] }), null);
});

test('キュー：Alt+1〜9（Ctrl・⌘ と一緒・入力欄・ロック中は出さない）', () => {
  const fired = [];
  const listeners = {};
  globalThis.window = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  try {
    const s = fresh();
    const show = new VJ.ShowController(s);
    const app = { show, settings: s, ui: { toast() {} }, cue: (i) => fired.push(i) };
    const k = VJ.keys.install(app);
    const ev = (code, mods) => Object.assign({ code, repeat: false, isComposing: false, target: { tagName: 'BODY' }, preventDefault() {} }, mods);
    k.handle(ev('Digit3', { altKey: true }));
    k.handle(ev('Numpad9', { altKey: true }));
    k.handle(ev('Digit3', { altKey: true, ctrlKey: true }));
    k.handle(ev('Digit0', { altKey: true }));
    k.handle(ev('Digit2', { altKey: true, target: { tagName: 'INPUT', type: 'text' } }));
    assert.deepEqual(fired, [2, 8]);
    assert.equal(show.state.sceneId, 'title', 'Alt+数字ではシーンは変えない');
    show.lock();
    k.handle(ev('Digit1', { altKey: true }));
    assert.deepEqual(fired, [2, 8]);
  } finally {
    delete globalThis.window;
  }
});
