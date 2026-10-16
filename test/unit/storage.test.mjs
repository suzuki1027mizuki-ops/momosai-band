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
  // 「設定を読み込み」：ほかの JSON（設定ファイルでないもの）は読まない（全部が初期値に戻らないように）
  for (const bad of ['{"name":"x"}', 'null', '[]', '3']) assert.throws(() => VJ.storage.fromFile(bad), /設定ファイルではありません|not a settings/);
  assert.equal(VJ.storage.fromFile(VJ.storage.toJSON(Object.assign({}, VJ.defaultSettings, { bandName: 'Z' }))).bandName, 'Z');
});

test('設定：項目の欠けた入れ子（表示の調整・ブリッジ・OSC・照明）は既定値で埋める。知らない項目は入れない', () => {
  const D = VJ.defaultSettings;
  const s = VJ.storage.fromJSON(JSON.stringify({
    v: 1, dmx: { enabled: true, out: 'enttec', count: '4', evil: 1 }, output: { rotate: 90 }, osc: { enabled: true, port: 7000 }, net: { enabled: true },
  }));
  assert.deepEqual(s.dmx, Object.assign({}, D.dmx, { enabled: true, out: 'enttec' }), '型のちがう count・知らない項目は使わない');
  assert.deepEqual(s.output, Object.assign({}, D.output, { rotate: 90 }));
  assert.deepEqual(s.osc, Object.assign({}, D.osc, { enabled: true, port: 7000 }));
  assert.deepEqual(s.net, { enabled: true, url: D.net.url }, 'アドレスの欄が空にならない');
  // 既定値は書き換わらない
  s.dmx.count = 99; s.output.size = 0.5;
  assert.deepEqual([D.dmx.count, D.output.size], [4, 1]);
});

test('設定：数値はパネルで選べる範囲に入れ、選ぶものは選択肢に無ければ既定値にする', () => {
  const D = VJ.defaultSettings;
  const s = VJ.storage.fromJSON(JSON.stringify({
    v: 1, master: 99, sensitivity: 1e9, maxScale: -5, react: 1e6, gateDb: 500, fpsCap: -1, crossfade: 99, paletteIdx: 1e9, bandPalette: -7,
    lang: 'xx', channel: 'both', logoMode: 'huge', logoCorner: 'cc', demoKind: 'x', lastSource: 'buffer', profile: 'nope',
    logo: 'https://example.com/a.png', customPalette: ['#123abc', 'red', 5, '#FFFFFF'],
    output: { rotate: 45, size: 9, x: -3, y: 0.25 }, net: { enabled: true, url: 'http://example.com/x' },
    osc: { host: '  ', port: 70000, rate: 500 }, dmx: { out: 'laser', type: 'x', host: '', universe: -1, count: 1000, start: 0, max: 7, pulse: -1 },
  }));
  assert.deepEqual([s.master, s.sensitivity, s.maxScale, s.react, s.gateDb, s.fpsCap, s.crossfade], [1, 5, 0.4, 1.5, -20, 0, 4]);
  assert.deepEqual([s.paletteIdx, s.bandPalette], [VJ.palettes.length - 1, -1]);
  assert.deepEqual([s.lang, s.channel, s.logoMode, s.logoCorner, s.demoKind, s.lastSource, s.profile], [D.lang, D.channel, D.logoMode, D.logoCorner, D.demoKind, D.lastSource, 'auto']);
  assert.equal(s.logo, '', 'ほかの場所の画像は読みに行かない');
  assert.deepEqual(s.customPalette, ['#123abc', D.customPalette[1], D.customPalette[2], '#FFFFFF']);
  assert.deepEqual(s.output, { rotate: 0, flipH: false, flipV: false, size: 1, x: -0.5, y: 0.25 });
  assert.equal(s.net.url, D.net.url, 'ws:// でないアドレスは使わない');
  assert.deepEqual([s.osc.host, s.osc.port, s.osc.rate], [D.osc.host, D.osc.port, 60]);
  assert.deepEqual([s.dmx.out, s.dmx.type, s.dmx.host, s.dmx.universe, s.dmx.count, s.dmx.start, s.dmx.max, s.dmx.pulse], [D.dmx.out, D.dmx.type, D.dmx.host, 0, 128, 1, 1, 0]);
  // ふつうの値はそのまま
  const ok = VJ.storage.fromJSON(JSON.stringify({ v: 1, master: 0.6, sensitivity: -2, maxScale: 0.75, react: 0.9, gateDb: -45, fpsCap: 30, crossfade: 0.5, paletteIdx: 3, lang: 'en',
    net: { enabled: false, url: '' }, osc: { enabled: true, host: '192.168.1.9', port: 8000, rate: 15 }, output: { rotate: 270, flipH: true, flipV: false, size: 0.8, x: 0.1, y: -0.1 } }));
  assert.deepEqual([ok.master, ok.sensitivity, ok.maxScale, ok.react, ok.gateDb, ok.fpsCap, ok.crossfade, ok.paletteIdx, ok.lang], [0.6, -2, 0.75, 0.9, -45, 30, 0.5, 3, 'en']);
  assert.deepEqual([ok.net.url, ok.osc.host, ok.osc.port, ok.osc.rate], ['', '192.168.1.9', 8000, 15], '空にしたアドレスは空のまま');
  assert.deepEqual(ok.output, { rotate: 270, flipH: true, flipV: false, size: 0.8, x: 0.1, y: -0.1 });
  // 既定値そのものは、確かめても変わらない
  assert.deepEqual(VJ.storage.fromJSON('{}'), VJ.storage.fromJSON(JSON.stringify(VJ.storage.fromJSON('{}'))));
});

test('置き場所：OneDrive・Dropbox などの同期されるフォルダの中かを見分ける（設定の保存場所 .vj-profile が同期され続けるので注意を出す）', () => {
  const yes = ['/C:/Users/a/OneDrive/デスクトップ/vj/momosai-vj.html', '/C:/Users/a/OneDrive - 学校/vj/momosai-vj.html', 'C:\\Users\\a\\Dropbox\\vj\\momosai-vj.html',
    '/Users/a/Library/Mobile Documents/com~apple~CloudDocs/vj/momosai-vj.html', '/Users/a/Library/CloudStorage/OneDrive-Personal/vj/momosai-vj.html', '/Users/a/Google Drive/vj/momosai-vj.html', '/D:/iCloudDrive/vj/momosai-vj.html'];
  const no = ['/C:/momosai-vj/momosai-vj.html', '/C:/Users/a/Desktop/vj/momosai-vj.html', '/Users/a/Documents/vj/momosai-vj.html', '/C:/OneDriveBackup.html', '/home/a/boxes/vj/momosai-vj.html', ''];
  for (const p of yes) assert.equal(VJ.compat.syncedPath(p), true, p);
  for (const p of no) assert.equal(VJ.compat.syncedPath(p), false, p);
});

test('保存：ロゴ・メディアの画像（大きい）は別に保存し、変わったときだけ書く。読み込むと戻る。古い保存もそのまま読める', () => {
  const store = new Map(), writes = [];
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); writes.push(k); }, removeItem: (k) => store.delete(k) };
  const prev = globalThis.localStorage;
  globalThis.localStorage = ls;
  const LOGO = 'data:image/png;base64,' + 'L'.repeat(5000), IMG = 'data:image/webp;base64,' + 'I'.repeat(9000);
  const bigWrites = () => writes.filter((k) => /\/(logo|ovimg)$/.test(k)).length;
  try {
    const s = VJ.storage.reset();
    s.logo = LOGO;
    s.overlay.image = IMG;
    assert.ok(VJ.storage.save(s));
    const main = store.get(VJ.storage.KEY);
    assert.ok(main.length < 4000, `本体の設定は小さいまま（${main.length} 文字）`);
    assert.deepEqual([JSON.parse(main).logo, JSON.parse(main).overlay.image], ['', '']);
    assert.deepEqual([s.logo, s.overlay.image], [LOGO, IMG], '保存しても、使っている設定の中身は変えない');
    assert.equal(bigWrites(), 2);
    // キー操作などで何度保存しても、画像が同じなら書き直さない
    for (let i = 0; i < 5; i++) { s.sensitivity = i; VJ.storage.save(s); }
    assert.equal(bigWrites(), 2);
    let back = VJ.storage.load();
    assert.deepEqual([back.logo, back.overlay.image, back.sensitivity], [LOGO, IMG, 4]);
    // 読み込んだ直後の保存でも書き直さない（出力ウィンドウ・再読み込み）
    VJ.storage.save(back);
    assert.equal(bigWrites(), 2);
    // 変えたら書く・消したら消す
    back.logo = LOGO + 'x';
    back.overlay.image = '';
    VJ.storage.save(back);
    assert.equal(bigWrites(), 3);
    assert.equal(store.has(VJ.storage.KEY + '/ovimg'), false);
    back = VJ.storage.load();
    assert.deepEqual([back.logo, back.overlay.image], [LOGO + 'x', '']);
    // 書き出した設定ファイルには画像も入る（別の PC へ移せる）
    assert.equal(VJ.storage.fromFile(VJ.storage.toJSON(back)).logo, LOGO + 'x');
    // 古い保存（設定の中に画像が入っている）：そのまま読めて、次の保存で分ける
    VJ.storage.reset();
    assert.equal(store.size, 0);
    store.set(VJ.storage.KEY, JSON.stringify(Object.assign({}, VJ.defaultSettings, { logo: LOGO, overlay: Object.assign({}, VJ.defaultSettings.overlay, { image: IMG }) })));
    const old = VJ.storage.load();
    assert.deepEqual([old.logo, old.overlay.image], [LOGO, IMG]);
    VJ.storage.save(old);
    assert.ok(store.get(VJ.storage.KEY).length < 4000);
    assert.equal(store.get(VJ.storage.KEY + '/logo'), LOGO);
    assert.deepEqual([VJ.storage.load().logo, VJ.storage.load().overlay.image], [LOGO, IMG]);
    // 保存に失敗したら false（次の保存でもう一度書く）
    const set0 = ls.setItem;
    ls.setItem = () => { throw new Error('quota'); };
    old.logo = LOGO + 'y';
    assert.equal(VJ.storage.save(old), false);
    ls.setItem = set0;
    assert.equal(VJ.storage.save(old), true);
    assert.equal(VJ.storage.load().logo, LOGO + 'y');
    VJ.storage.reset();
    assert.equal(store.size, 0);
  } finally {
    globalThis.localStorage = prev;
  }
});
