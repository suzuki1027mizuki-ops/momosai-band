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

test('フラッシュの上限：設定で 2 / 4 / 6 / 10 回・制限なしにでき、拍ごとの軽いフラッシュは 1 回分を残す', () => {
  const count = (lim, step, reserve) => { let ok = 0; for (let i = 0; i < 20; i++) if (lim.allow(i * step, reserve)) ok++; return ok; };
  for (const [n, want] of [[2, 2], [3, 3], [4, 4], [6, 6], [10, 10]]) {
    const lim = new VJ.safety.FlashLimiter();
    lim.setLimit(n);
    assert.equal(count(lim, 0.05), want, `limit ${n}`);
  }
  const free = new VJ.safety.FlashLimiter();
  free.setLimit(0);
  assert.equal(count(free, 0.05), 20, '制限なし');
  assert.equal(free.gap(), 0);
  const def = new VJ.safety.FlashLimiter();
  assert.equal(def.cfg.maxPerSec, 3);
  assert.equal(def.cfg.minGap, 0.2);
  def.setLimit(3);
  assert.equal(def.cfg.minGap, 0.2, '3 回のときは今までと同じ間隔');
  assert.deepEqual([0, 0.25, 0.5].map((t) => def.allow(t, 1)), [true, true, false], '拍ごとのフラッシュは 3 回のうち 2 回まで');
  assert.ok(def.allow(0.75), 'キメの分が残っている');
  assert.ok(!VJ.safety.overSafe(3) && !VJ.safety.overSafe(2));
  assert.ok(VJ.safety.overSafe(4) && VJ.safety.overSafe(0));
  // 設定の値は 0〜30 の整数に
  assert.equal(VJ.storage.fromJSON(JSON.stringify({ flashLimit: 6.4, intensity: 9 })).flashLimit, 6);
  // 激しさは 0〜3 と -1（自動）
  assert.equal(VJ.storage.fromJSON(JSON.stringify({ flashLimit: -2, intensity: -1 })).intensity, -1);
  assert.equal(VJ.storage.fromJSON(JSON.stringify({ intensity: -7 })).intensity, -1);
  assert.equal(VJ.storage.fromJSON(JSON.stringify({ flashLimit: 'x' })).flashLimit, 3);
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

test('コントローラ：フラッシュの上限の設定が効く（照明のチェイスも同じ間隔）・フラッシュ OFF なら上限に関係なく光らない', () => {
  const run = (over) => {
    const s = Object.assign({}, VJ.defaultSettings, { auto: false }, over);
    const c = new VJ.ShowController(s);
    let n = 0;
    for (let i = 0; i < 60; i++) if (c.flash(0.8, 'key')) { n++; c.update(fakeFeatures(), 1 / 60, (i + 1) / 60); } else c.update(fakeFeatures(), 1 / 60, (i + 1) / 60);
    return [n, c];
  };
  assert.equal(run({})[0], 3);
  assert.equal(run({ flashLimit: 6 })[0], 6);
  assert.ok(run({ flashLimit: 0 })[0] >= 30);
  assert.equal(run({ flashLimit: 10, noFlash: true })[0], 0);
  const [, c6] = run({ flashLimit: 6 });
  assert.ok(Math.abs(c6.limiter.gap() - 1 / 6) < 1e-9);
  c6.applySettings(Object.assign({}, c6.settings, { flashLimit: 3 }));
  assert.ok(Math.abs(c6.limiter.gap() - 1 / 3) < 1e-9, '設定を戻すと 3 回に戻る');
});

test('激しさ：激しい・最大ではキックで寄る・スネアで揺れる・拍ごとに軽く光る・オートの切替が速い。ふつう以下と司会のタイプではしない', () => {
  const run = (over, frames) => {
    const s = Object.assign({}, VJ.defaultSettings, { auto: false, autoFlash: true }, over);
    const c = new VJ.ShowController(s);
    c._applyScene('ripple');
    let t = 0, flashes = 0, punch = 0, shake = 0, rgb = 0;
    for (let i = 0; i < (frames || 120); i++) {
      t += 1 / 60;
      // 120BPM：キック（0.5 秒ごと）とスネア（その間）
      const k = i % 30 === 0, sn = i % 30 === 15;
      const prev = c.state.flash;
      c.update(fakeFeatures({ onsetFlags: (k ? 1 : 0) | (sn ? 2 : 0), kick: k ? 0.9 : 0, snare: sn ? 0.9 : 0 }), 1 / 60, t);
      if (c.state.flash > prev + 0.1) flashes++;
      const fr = c.frame(fakeFeatures(), 1 / 60, null);
      punch = Math.max(punch, fr.punch); shake = Math.max(shake, Math.hypot(fr.shakeX, fr.shakeY)); rgb = Math.max(rgb, fr.rgb);
    }
    return { flashes, punch, shake, rgb, c };
  };
  const calm = run({ intensity: 1 });
  assert.equal(calm.flashes, 0, 'ふつう：キメ以外では光らない（以前と同じ）');
  assert.equal(calm.punch + calm.shake + calm.rgb, 0);
  const hot = run({ intensity: 2 });
  assert.ok(hot.flashes >= 3 && hot.flashes <= 4, '激しい：拍ごとに光る（2 秒で 1 秒あたり 2 回まで） ' + hot.flashes);
  assert.ok(hot.punch > 0.02 && hot.shake > 0.005 && hot.rgb > 0.005, JSON.stringify(hot));
  const max = run({ intensity: 3 });
  assert.ok(max.punch > hot.punch && max.shake > hot.shake);
  assert.ok(max.c.react() > hot.c.react() && hot.c.react() > calm.c.react());
  assert.ok(max.c.switchK() < hot.c.switchK() && hot.c.switchK() < calm.c.switchK());
  // 自動フラッシュ OFF・司会のタイプでは拍のフラッシュも寄り・揺れもしない
  assert.equal(run({ intensity: 3, autoFlash: false }).flashes, 0);
  const mc = run({ intensity: 3, profile: 'speech' });
  assert.equal(mc.flashes + mc.punch + mc.shake, 0);
  assert.ok(run({ intensity: 3, profile: 'calm' }).punch < hot.punch * 0.5, 'しっとり系では弱め');
  const off = run({ intensity: 3, noFlash: true });
  assert.equal(off.flashes + off.punch + off.shake + off.rgb, 0, 'フラッシュを一切使わない会場では寄り・揺れもしない');
  // キメでも揺れる（スネアが来る前から向きがある）
  const s2 = Object.assign({}, VJ.defaultSettings, { auto: false, autoFlash: true, intensity: 2 });
  const c2 = new VJ.ShowController(s2);
  c2.update(fakeFeatures({ onsetFlags: 8, accent: 1 }), 1 / 60, 1);
  const fr2 = c2.frame(fakeFeatures(), 1 / 60, null);
  assert.ok(Math.hypot(fr2.shakeX, fr2.shakeY) > 0.005 && fr2.punch > 0.03);
  c2.toggleTestPattern();
  c2.update(fakeFeatures({ onsetFlags: 8, accent: 1 }), 1 / 60, 2);
  const fr3 = c2.frame(fakeFeatures(), 1 / 60, null);
  assert.equal(fr3.punch + fr3.shakeX + fr3.shakeY + fr3.rgb, 0, 'テストパターンは動かさない');
});

test('激しさの自動：盛り上がりを追って 控えめ〜最大 の間を動く。上がるのは速く、下がるのはゆっくり。話し声・無音では控えめ', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, autoFlash: true, intensity: -1 });
  const c = new VJ.ShowController(s);
  c._applyScene('ripple');
  let t = 0;
  const run = (sec, over) => { for (let i = 0; i < sec * 60; i++) { t += 1 / 60; c.update(fakeFeatures(over), 1 / 60, t); } };
  run(20, { intensity: 0.1 });
  assert.equal(c.state.intLv, 0, '静かなところは控えめ');
  assert.ok(Math.abs(c.react() - 0.8) < 0.02 && c.punchAmount() === 0 && c.intensity().beat === 0, '控えめと同じ強さ');
  // サビに入ったら数秒で最大へ
  run(4, { intensity: 0.9 });
  assert.equal(c.state.intLv, 3, '盛り上がったら最大 ' + c.autoLv);
  assert.ok(c.react() > 1.4 && c.punchAmount() > 1.4 && c.intensity().beat === 2);
  assert.ok(c.switchK() < 0.6, 'オートの切替も速く');
  // 下がるのはゆっくり：2 秒ではまだ激しい側。十分たてば中くらいの盛り上がり → ふつう〜激しいの間
  run(2, { intensity: 0.45 });
  assert.ok(c.state.intLv >= 2, 'すぐには下がらない ' + c.autoLv);
  run(20, { intensity: 0.45 });
  assert.ok(c.autoLv > 1.2 && c.autoLv < 1.5, '中くらい ' + c.autoLv);
  assert.ok(c.react() > 1.0 && c.react() < 1.25, '段階の間はなめらかに ' + c.react());
  // 話し声・無音では控えめへ
  run(20, { intensity: 0.9, speech: true });
  assert.equal(c.state.intLv, 0);
  // 手動に戻すと設定どおり
  s.intensity = 3;
  run(0.1, { intensity: 0.1 });
  assert.equal(c.state.intLv, 3);
  assert.ok(c.punchAmount() > 1.5);
});

test('パレットの自動：曲の区切りで盛り上がりに合った色へゆっくり移る。曲に色の指定があるとき・無音・話し声では変えない', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, autoFlash: false, paletteAuto: true, intensity: 1, paletteIdx: 0, setlistText: 'A | 1 | ocean\nB | 2' });
  const c = new VJ.ShowController(s);
  c._applyScene('ripple');
  let t = 0;
  const step = (over) => { t += 1 / 60; c.update(fakeFeatures(over), 1 / 60, t); };
  const run = (sec, over) => { for (let i = 0; i < sec * 60; i++) step(over); };
  const id = () => VJ.palettes[c.state.paletteIdx].id;
  // 26 秒たつまではキメが来ても変えない
  run(20, { intensity: 0.9 });
  step({ onsetFlags: 8, accent: 1, intensity: 0.9 });
  assert.equal(id(), 'neon');
  run(7, { intensity: 0.9 });
  const before = Array.from(c.palFloat);
  step({ onsetFlags: 8, accent: 1, intensity: 0.9 });
  assert.ok(['fire', 'acid', 'sunset'].includes(id()), '盛り上がっているときの色 ' + id());
  assert.equal(s.paletteIdx, c.state.paletteIdx, '設定にも反映');
  // その場では色は跳ばず、1.5 秒かけて移る
  assert.ok(c.palFloat.every((v, i) => Math.abs(v - before[i]) < 0.02), 'すぐには変わらない');
  run(1.6, { intensity: 0.9 });
  const want = VJ.paletteFloat(VJ.paletteColors(c.state.paletteIdx));
  assert.ok(c.palFloat.every((v, i) => Math.abs(v - want[i]) < 1e-3), '移り終わる');
  // 静かなところでは落ち着いた色。キメが無くても小節の頭で変わる。モノクロ・カスタムは使わない
  const seen = new Set();
  for (let k = 0; k < 12; k++) {
    run(32, { intensity: 0.2 });
    step({ onsetFlags: 64, beatConf: 0.8, intensity: 0.2 });
    seen.add(id());
  }
  assert.ok([...seen].every((x) => ['ocean', 'sakura', 'sunset'].includes(x)), [...seen].join());
  assert.ok(seen.size >= 2, '同じ色にとどまらない');
  // 無音・話し声の間は変えない
  const cur = id();
  run(40, { intensity: 0.2, active: false });
  step({ onsetFlags: 8, active: false });
  run(40, { intensity: 0.9, speech: true });
  step({ onsetFlags: 8, speech: true, intensity: 0.9 });
  assert.equal(id(), cur);
  // 曲に色の指定がある（1 曲目 = ocean）：その曲の間は変えない。指定の無い 2 曲目ではまた変わる
  c.nextSong();
  assert.equal(id(), 'ocean');
  run(40, { intensity: 0.9 });
  step({ onsetFlags: 8, accent: 1, intensity: 0.9 });
  assert.equal(id(), 'ocean');
  c.nextSong();
  run(40, { intensity: 0.9 });
  step({ onsetFlags: 8, accent: 1, intensity: 0.9 });
  assert.notEqual(id(), 'ocean');
  // 手で選んだら、そこからまた 26 秒は変えない
  c.setPalette(5);
  step({ onsetFlags: 8, accent: 1, intensity: 0.9 });
  assert.equal(id(), 'mono');
});

test('オーバーレイ：重ねるシーン・画像・隅の文字をフレームに載せる。O で切替、テストパターン中は出さない', () => {
  const overlay = Object.assign({}, VJ.defaultSettings.overlay, { scene: 'stars', sceneOpacity: 0.4, sceneBlend: 'add', image: 'data:image/png;base64,AAAA', imageFit: 'cover', imageBlend: 'screen', imageOpacity: 0.7, clock: true, band: true, song: true, text: '#fes', corner: 'bl', textSize: 1.5, textOpacity: 0.8 });
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, overlay, overlayOn: true, bandName: 'BAND', setlistText: 'A | 1\nB | 2' });
  const c = new VJ.ShowController(s);
  c._applyScene('ripple');
  const texts = [];
  const getText = (main, sub, align) => { texts.push([main, sub, align]); return { tex: {} }; };
  const step = (t) => { c.update(fakeFeatures(), 1 / 60, t); return c.frame(fakeFeatures(), 1 / 60, getText); };
  let fr = step(1);
  // 重ねるシーン：自分の状態を持って毎フレーム動く（星空の u_fly が進む）
  assert.equal(fr.overlay.scene.id, 'stars');
  assert.ok(Math.abs(fr.overlay.mix - 0.4 * 0.6) < 1e-9, '重ねる強さは濃さ × 0.6 まで（光過敏対策） ' + fr.overlay.mix);
  assert.equal(fr.overlay.mode, 'add');
  // フラッシュの上限を自分で上げているときは、そのままの濃さ
  s.flashLimit = 6;
  assert.ok(Math.abs(step(1.5).overlay.mix - 0.4) < 1e-9);
  s.flashLimit = 3;
  const fly0 = fr.overlay.uniforms.u_fly;
  fr = step(2);
  assert.ok(fr.overlay.uniforms.u_fly > fly0, '重ねたシーンも進む');
  assert.equal(fr.scene.id, 'ripple', 'いまのシーンはそのまま');
  // 画像
  assert.deepEqual([fr.ovImage.alpha, fr.ovImage.fit, fr.ovImage.mode], [0.7, 'cover', 'screen']);
  // 文字：曲が始まる前は 時計・バンド名 が上、自由な文字が下。左の隅なら左にそろえる
  assert.equal(c.overlayText(new Date(2026, 9, 9, 7, 5))[0], '#fes');
  assert.equal(c.overlayText(new Date(2026, 9, 9, 7, 5))[1], '07:05　BAND');
  assert.deepEqual([fr.text3.corner, fr.text3.alpha, fr.text3.size], ['bl', 0.8, 1.5]);
  assert.equal(texts[texts.length - 1][2], 'left');
  c.nextSong();
  assert.equal(c.overlayText(new Date(2026, 9, 9, 19, 30))[0], 'M1 A　#fes');
  // 下の行が無ければ、上の行を大きく出す
  overlay.song = false; overlay.text = '';
  assert.deepEqual(c.overlayText(new Date(2026, 9, 9, 19, 30)), ['19:30　BAND', '']);
  // いまのシーンと同じシーンは重ねない
  c._applyScene('stars');
  assert.equal(step(3).overlay, null);
  c._applyScene('ripple');
  assert.ok(step(4).overlay);
  // O（toggleOverlay）でまとめて消す・出す
  c.toggleOverlay();
  fr = step(5);
  assert.equal(s.overlayOn, false);
  assert.deepEqual([fr.overlay, fr.ovImage, fr.text3], [null, null, null]);
  c.toggleOverlay();
  fr = step(6);
  assert.ok(fr.overlay && fr.ovImage && fr.text3);
  // テストパターン（位置合わせ）の間は出さない
  c.toggleTestPattern();
  fr = step(7);
  assert.deepEqual([fr.overlay, fr.ovImage, fr.text3], [null, null, null]);
  c.toggleTestPattern();
  // 濃さ 0・シーンなしでは描かない
  overlay.sceneOpacity = 0; overlay.imageOpacity = 0; overlay.textOpacity = 0;
  fr = step(8);
  assert.deepEqual([fr.overlay, fr.ovImage, fr.text3], [null, null, null]);
  // 設定の読み込み：無い項目・おかしな値は既定に
  const ld = VJ.storage.fromJSON(JSON.stringify({ overlay: { scene: 'eq', sceneOpacity: 7, imageFit: 'zoom', image: 'javascript:alert(1)', corner: 'xx', textSize: 'big' } })).overlay;
  assert.deepEqual([ld.scene, ld.sceneOpacity, ld.imageFit, ld.image, ld.corner, ld.textSize, ld.sceneBlend], ['eq', 1, 'contain', '', 'tr', 1, 'screen']);
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

test('オート＋MC のときはタイトル：MC 中に操作者が選んだシーンは、話し声が終わるまでタイトルに戻さない', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: true, speechTitle: true, setlistText: '' });
  const c = new VJ.ShowController(s);
  c._applyScene('ripple');
  let t = 0;
  const step = (f) => { t += 1 / 60; c.update(fakeFeatures(f), 1 / 60, t); };
  for (let i = 0; i < 60; i++) step();
  step({ speech: true });
  assert.equal(c.state.sceneId, 'title', '話し声でタイトルへ');
  c.selectScene('aurora', { immediate: true });
  for (let i = 0; i < 120; i++) step({ speech: true });
  assert.equal(c.state.sceneId, 'aurora', '選んだシーンのまま');
  // 演奏 → 次の MC ではまたタイトルへ
  for (let i = 0; i < 60 * 5; i++) step();
  step({ speech: true });
  assert.equal(c.state.sceneId, 'title');
});

test('クロスフェードの途中でまた切り替えても、見えている絵が急に入れ替わらない', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, crossfade: 1, setlistText: '' });
  const c = new VJ.ShowController(s);
  let t = 0;
  const step = (n) => { for (let i = 0; i < n; i++) { t += 1 / 60; c.update(fakeFeatures(), 1 / 60, t); } return c.frame(fakeFeatures(), 1 / 60, null); };
  c._applyScene('ripple');
  step(60);
  c.selectScene('aurora', { immediate: true });
  const a = step(18); // 0.3 秒：ripple がまだ多く見えている
  assert.equal(a.xfade.scene.id, 'ripple');
  const m = a.xfade.mix;
  assert.ok(m > 0.6 && m < 0.9, 'mix ' + m);
  c.selectScene('tunnel', { immediate: true });
  const b = step(0);
  assert.equal(b.xfade.scene.id, 'ripple', '多く見えている方が消えていく側のまま');
  assert.ok(Math.abs(b.xfade.mix - m) < 0.02, `${m} -> ${b.xfade.mix}`);
  // 半分を過ぎてから切り替えたら、新しく入ってきた方が消えていく側になる
  step(60);
  c.selectScene('aurora', { immediate: true });
  const d = step(42); // 0.7 秒：aurora の方が多い
  const m2 = d.xfade.mix;
  assert.equal(d.xfade.scene.id, 'tunnel');
  c.selectScene('stars', { immediate: true });
  const e = step(0);
  assert.equal(e.xfade.scene.id, 'aurora');
  assert.ok(Math.abs(e.xfade.mix - (1 - m2)) < 0.02, `${1 - m2} -> ${e.xfade.mix}`);
  step(70);
  assert.equal(c.frame(fakeFeatures(), 1 / 60, null).xfade, null, 'フェードは終わる');
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

test('MIDI ラーン：学習した操作に割り当てが変わり、設定に保存される。CC のボタン・ストロボも使える', () => {
  const s = Object.assign({}, VJ.defaultSettings, { auto: false, midiMap: {} });
  const c = new VJ.ShowController(s);
  c.update(fakeFeatures(), 1 / 60, 5);
  // 学習中のメッセージは実行しない
  let got = null;
  VJ.midi.learn('scene:orb', (k) => { got = k; VJ.midi.assign(s, k, 'scene:orb'); });
  assert.equal(VJ.midi.handle(c, [0x90, 37, 100], s), 'learned');
  assert.equal(got, 'n37');
  assert.equal(c.state.sceneId, 'title');
  assert.equal(s.midiMap.n37, 'scene:orb');
  assert.equal(s.midiMap.n36, 'scene:ripple', '他の既定の割り当ては残る');
  assert.ok(VJ.midi.handle(c, [0x91, 37, 100], s), 'チャンネルは問わない');
  assert.equal(c.state.sceneId, 'orb');
  // 同じ操作を別のキーに学習し直すと、古いキーは外れる
  VJ.midi.learn('scene:orb', (k) => VJ.midi.assign(s, k, 'scene:orb'));
  VJ.midi.handle(c, [0xb0, 20, 127], s);
  assert.equal(s.midiMap.c20, 'scene:orb');
  assert.equal(s.midiMap.n37, undefined);
  // CC のボタン：64 以上に上がった瞬間だけ
  c.selectScene('tunnel', { immediate: true });
  assert.equal(VJ.midi.handle(c, [0xb0, 20, 127], s), false, '押しっぱなしでは繰り返さない');
  assert.equal(c.state.sceneId, 'tunnel');
  VJ.midi.handle(c, [0xb0, 20, 0], s);
  assert.ok(VJ.midi.handle(c, [0xb0, 20, 100], s));
  assert.equal(c.state.sceneId, 'orb');
  // ストロボ（押している間）
  VJ.midi.assign(s, 'n50', 'strobe');
  VJ.midi.handle(c, [0x90, 50, 100], s);
  assert.equal(c.state.strobe, true);
  VJ.midi.handle(c, [0x80, 50, 0], s);
  assert.equal(c.state.strobe, false);
  // 押している途中でロックしても、離せば止まる（ロック中は新たには押せない）
  VJ.midi.handle(c, [0x90, 50, 100], s);
  c.lock();
  VJ.midi.handle(c, [0x80, 50, 0], s);
  assert.equal(c.state.strobe, false, 'ロック中でもストロボを離せる');
  VJ.midi.handle(c, [0x90, 50, 100], s);
  assert.equal(c.state.strobe, false, 'ロック中は押せない');
  c.unlock();
  // 操作の一覧：全シーンと主な操作がある
  const ids = VJ.midi.actions().map((a) => a.id);
  for (const sc of VJ.scenes.list) if (!sc.hidden) assert.ok(ids.includes('scene:' + sc.id), sc.id);
  for (const a of ['flash', 'blackout', 'nextSong', 'master', 'sens', 'tap']) assert.ok(ids.includes(a), a);
  assert.equal(VJ.midi.keyLabel('n36'), 'ノート 36（C1）');
  assert.equal(VJ.midi.keyLabel('c7'), 'CC 7');
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
