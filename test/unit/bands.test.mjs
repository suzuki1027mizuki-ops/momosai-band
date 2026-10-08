// 出演バンド（タイムテーブル）・セットリストの表の書き出し・シーンの見本画像
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ, scriptList } from '../helpers/load-src.mjs';

const VJ = loadVJ([...['src/core/', 'src/dsp/', 'src/audio/synth.js', 'src/audio/voicesynth.js', 'src/show/', 'src/scenes/', 'src/ui/midi.js', 'src/ui/keys.js'], 'src/ui/thumbs.js', 'src/ui/scenepick.js']);
const fresh = () => VJ.storage.merge(VJ.defaultSettings, {});

test('出演バンド：追加・切替で名前・セットリスト・ロゴ・タイプ・色・開演時刻・テロップが入れ替わり、戻すと元どおり', () => {
  const s = fresh();
  assert.equal(s.bands.length, 1);
  s.bandName = 'A';
  s.setlistText = 'a1 | 1\na2 | 2';
  s.logo = 'data:image/png;base64,AAAA';
  s.profile = 'dance';
  s.bandPalette = 3; // パネルで選んだバンドの色
  s.paletteIdx = 5; // 曲ごとの色・C キーで変わった、いまの色（覚えない）
  s.countdownTo = '13:00';
  s.messages = ['qa', '', ''];
  const i = VJ.bands.add(s, 'B');
  assert.equal(i, 1);
  assert.ok(VJ.bands.select(s, 1));
  assert.equal(s.bandName, 'B');
  assert.equal(s.setlistText, '');
  assert.equal(s.logo, '');
  assert.equal(s.profile, 'dance', '新しいバンドの音楽のタイプは前のバンドに合わせる');
  assert.equal(s.countdownTo, '');
  assert.deepEqual(s.messages, ['', '', '']);
  s.setlistText = 'b1';
  s.profile = 'acoustic';
  s.countdownTo = '14:30';
  // いま出ているバンドの値は二重に持たない（ロゴを 2 回保存しない）
  assert.deepEqual(s.bands[1], {});
  assert.ok(VJ.bands.select(s, 0));
  assert.equal(s.bandName, 'A');
  assert.equal(s.setlistText, 'a1 | 1\na2 | 2');
  assert.equal(s.logo, 'data:image/png;base64,AAAA');
  assert.equal(s.profile, 'dance');
  assert.equal(s.bandPalette, 3);
  assert.equal(s.paletteIdx, 3, 'バンドの色に戻る');
  assert.equal(s.countdownTo, '13:00');
  assert.deepEqual(s.messages, ['qa', '', '']);
  const list = VJ.bands.list(s);
  assert.deepEqual(list.map((b) => [b.name, b.start, b.songs, b.current]), [['A', '13:00', 2, true], ['B', '14:30', 1, false]]);
  assert.equal(VJ.bands.select(s, 0), false, '同じバンドは何もしない');
  assert.equal(VJ.bands.select(s, 5), false);
});

test('出演バンド：並べ替え・削除で「出演中」がずれない。最後の 1 組は消せない', () => {
  const s = fresh();
  s.bandName = 'A';
  s.setlistText = ''; // 見本のセットリストの @band が名前より優先されるので空に
  VJ.bands.add(s, 'B');
  VJ.bands.add(s, 'C');
  VJ.bands.select(s, 1);
  assert.ok(VJ.bands.move(s, 1, 1));
  assert.equal(s.bandIdx, 2);
  assert.deepEqual(VJ.bands.list(s).map((b) => b.name), ['A', 'C', 'B']);
  assert.ok(VJ.bands.remove(s, 0));
  assert.equal(s.bandIdx, 1);
  assert.equal(s.bandName, 'B');
  assert.ok(VJ.bands.remove(s, 1), '出演中を消すと隣に切り替わる');
  assert.equal(s.bandName, 'C');
  assert.equal(VJ.bands.remove(s, 0), false);
  assert.equal(VJ.bands.move(s, 0, -1), false);
});

test('出演バンド：セットリストの @band が名前より優先。設定ファイルを読み込んでも一覧が残り、壊れた値は捨てる', () => {
  const s = fresh();
  VJ.bands.add(s, 'X');
  VJ.bands.select(s, 1);
  s.setlistText = '@band Real Name\nsong';
  VJ.bands.select(s, 0);
  assert.equal(VJ.bands.nameOf(s, 1), 'Real Name');
  const loaded = VJ.storage.fromJSON(JSON.stringify(Object.assign({}, s, {
    bands: [...s.bands, { bandName: 3, setlistText: 'ok', logo: 'javascript:alert(1)', bandPalette: 'x', messages: [1, 'm'] }, 'junk'],
  })));
  assert.equal(loaded.bands.length, 4);
  assert.equal(loaded.bands[2].bandName, undefined);
  assert.equal(loaded.bands[2].logo, undefined, 'data:image 以外のロゴは捨てる');
  assert.deepEqual(loaded.bands[2].messages, ['', 'm', '']);
  assert.deepEqual(loaded.bands[3], {});
  assert.ok(VJ.bands.select(loaded, 2));
  assert.equal(loaded.setlistText, 'ok');
  assert.equal(loaded.bandName, '');
  assert.equal(loaded.bandPalette, -1);
});

test('タイトル：出演バンドが複数なら「次の出演」、終演後は「次は ○○」。開演時刻があればカウントダウンが優先。切替で開演前に戻る', () => {
  const s = fresh();
  s.setlistText = 'a | 1';
  const c = new VJ.ShowController(s);
  assert.equal(c.titleSub(), '', '1 組だけなら何も出さない');
  // セットリストの無いバンドは、演奏中も「次の出演」を出さない
  const s2 = fresh();
  s2.setlistText = '';
  VJ.bands.add(s2, 'X');
  assert.equal(new VJ.ShowController(s2).titleSub(), '');
  VJ.bands.add(s, 'Next Band');
  c.applySettings(s);
  assert.equal(c.titleSub(), '次の出演');
  c.nextSong();
  assert.equal(c.titleSub(), '');
  c.nextSong();
  assert.ok(c.state.endState);
  assert.equal(c.titleSub(), '次は Next Band');
  s.countdownTo = '23:59';
  c.state.endState = false;
  c.state.songIdx = -1;
  assert.match(c.titleSub(new Date(2026, 9, 8, 23, 0, 0)), /開演まで 59:00/);
  c.nextSong();
  c.resetShow();
  assert.equal(c.state.songIdx, -1);
  assert.equal(c.state.sceneId, 'title');
  assert.equal(c.state.endState, false);
});

test('セットリストの表：書き出して読み直すと同じ（曲名の「|」・数字で始まる曲名・notitle・コメント）', () => {
  const text = '@band B\n# メモ\n1. 夜に駆ける | 2,s3 | neon\n22才の別れ | オーロラ\nMC | 0 | | notitle\n@end Fin';
  const p = VJ.setlist.parse(text);
  assert.deepEqual(p.errors, []);
  p.songs.push({ title: '3.14 Pi | x', scenes: ['petals'], palette: 6, notitle: false });
  const out = VJ.setlist.serialize(p, VJ.setlist.headComments(text));
  assert.match(out, /^@band B\n# メモ\n1\. 夜に駆ける \| 2,s3 \| neon\n/);
  const q = VJ.setlist.parse(out);
  assert.deepEqual(q.errors, []);
  assert.equal(q.band, 'B');
  assert.equal(q.end, 'Fin');
  assert.deepEqual(q.songs.map((x) => [x.title, x.scenes, x.palette, x.notitle]), [
    ['夜に駆ける', ['tunnel', 'fireworks'], 0, false],
    ['22才の別れ', ['aurora'], null, false],
    ['MC', ['title'], null, true],
    ['3.14 Pi / x', ['petals'], 6, false],
  ]);
});

test('セットリストの表：書き直しても、コメント・@band / @end・読めない行・編集していない曲の行はそのまま残る', () => {
  const text = '@band B\n# head\n1. A | 1 | neon\n# --- MC ---\n2. B | 2,nope\nbadline | | | weird\n3. C | 3\n@end Fin\n# tail';
  const p = VJ.setlist.parse(text);
  const songs = p.songs.map((x) => ({ title: x.title, scenes: x.scenes, palette: x.palette, notitle: x.notitle, line: x.line, dirty: false }));
  const [a, , w, c] = songs;
  a.title = 'A2';
  a.dirty = true;
  // C を先頭へ・A を編集・B を消す・新しい曲を足す
  const out = VJ.setlist.rewrite(text, [c, a, w, { title: 'New', scenes: ['petals'], palette: null, notitle: false, line: null, dirty: true }]);
  assert.equal(out, '@band B\n# head\n1. C | 3\n# --- MC ---\n2. A2 | 1 | neon\nbadline | | | weird\n4. New | s8\n@end Fin\n# tail');
  // 読めない行のエラーは残る（表で消えない）
  assert.ok(VJ.setlist.parse(out).errors.some((e) => /weird/.test(e.msg)));
  // 編集していない B の行は「nope」ごと残る
  assert.match(VJ.setlist.rewrite(text, songs), /2\. B \| 2,nope/);
  assert.equal(VJ.setlist.rewrite('@band Z\n@end E', [{ title: 'X', scenes: [], palette: null, notitle: false, line: null, dirty: true }]), '@band Z\n1. X\n@end E');
});

test('保存：出演バンドの一覧は別に保存し、変わったときだけ書く。読み込むと戻る', () => {
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); writes.push(k); }, removeItem: (k) => store.delete(k) };
  const writes = [];
  const prev = globalThis.localStorage;
  globalThis.localStorage = ls;
  try {
    const s = VJ.storage.reset();
    s.bandName = 'A';
    s.setlistText = '';
    VJ.bands.add(s, 'B');
    assert.ok(VJ.storage.save(s));
    assert.ok(!JSON.parse(store.get(VJ.storage.KEY)).bands, '本体の設定には入れない');
    const n1 = writes.filter((k) => k.endsWith('/bands')).length;
    s.sensitivity = 2;
    VJ.storage.save(s);
    assert.equal(writes.filter((k) => k.endsWith('/bands')).length, n1, '一覧が変わっていなければ書かない');
    VJ.bands.select(s, 1);
    VJ.storage.save(s);
    assert.equal(writes.filter((k) => k.endsWith('/bands')).length, n1 + 1);
    const back = VJ.storage.load();
    assert.equal(back.bandIdx, 1);
    assert.deepEqual(VJ.bands.list(back).map((b) => b.name), ['A', 'B']);
    VJ.storage.reset();
    assert.equal(store.size, 0);
  } finally {
    globalThis.localStorage = prev;
  }
});

test('シーンの見本画像：表示するすべてのシーンにあり（無ければ node tools/thumbs.mjs で作り直す）、キーの順に並ぶ', () => {
  assert.ok(scriptList().includes('src/ui/thumbs.js'));
  for (const d of VJ.scenes.list.filter((x) => !x.hidden)) {
    assert.match(VJ.thumbs[d.id] || '', /^data:image\/webp;base64,/, d.id);
    assert.ok(VJ.thumbs[d.id].length < 20000, d.id);
  }
  const keys = VJ.scenePick.list().map((d) => VJ.scenePick.keyLabel(d));
  assert.deepEqual(keys.slice(0, 11), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '⇧1']);
});
