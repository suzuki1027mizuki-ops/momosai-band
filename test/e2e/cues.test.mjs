// カメラのメディア・メディアの一覧と曲ごとのメディア（m:…）・キュー（Alt+1〜9）と、2 画面のときの受け渡し。
// カメラは Chromium の偽のカメラ（--use-fake-device-for-media-stream）を使う
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, openApp, DIST, FIXTURES } from '../helpers/browser.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const fresh = async (page) => {
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('momosai-vj-media'); });
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app && VJ.app.renderer);
  await page.evaluate(() => { for (const id of ['overlay-box', 'medialib-box', 'cue-edit-box']) document.getElementById(id).open = true; });
};

const VIDEO_B64 = fs.readFileSync(path.join(FIXTURES, 'overlay.webm')).toString('base64');
const makeVideo = (page) => page.evaluate((b64) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  window.__video = new File([u], 'loop.webm', { type: 'video/webm' });
}, VIDEO_B64);
/** 単色の画像ファイル（window.__img） */
const makeImage = (page, color) => page.evaluate(async (color) => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 36;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 64, 36);
  window.__img = new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'logo.png', { type: 'image/png' });
}, color);
const statusText = (page) => page.evaluate(() => document.getElementById('ov-status').textContent);

test('カメラ：選んで開くと映像に重なる。左右反転・止める（勝手に開き直さない）・外れたら開き直す・本番前チェック', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await fresh(page);
  await page.check('input[name=ov-kind][value=camera]');
  assert.ok(await page.isVisible('#btn-ov-camopen'));
  await page.click('#btn-ov-camopen');
  await page.waitForFunction(() => VJ.media.cam && VJ.app.renderer.ovVid && VJ.app.renderer.ovVid.ready, null, { timeout: 15000 });
  await page.waitForFunction(() => /カメラ：/.test(document.getElementById('ov-status').textContent));
  // 一覧（偽のカメラ）。許可したあとなので名前が出る
  await page.waitForFunction(() => document.getElementById('ov-cam').options.length >= 2);
  const camId = await page.evaluate(() => document.getElementById('ov-cam').options[1].value);
  assert.ok(camId);
  // 映像に重なる（偽のカメラの絵で明るくなる）
  const lum = (on) => page.evaluate((on) => VJ.testing.runOffline({ samples: 'demo', seconds: 0.5, sceneId: 'stars', grid: [4, 3],
    settings: { auto: false, overlayOn: on, overlay: Object.assign({}, VJ.app.settings.overlay, { imageFit: 'stretch', imageOpacity: 1 }) } })
    .then((r) => { const f = r.luma[r.luma.length - 1]; return f.reduce((a, b) => a + b, 0) / f.length; }), on);
  const dark = await lum(false), lit = await lum(true);
  assert.ok(lit > dark + 0.02, `カメラが重なって明るくなる ${dark} → ${lit}`);
  // カメラを選ぶ・左右反転
  await page.selectOption('#ov-cam', camId);
  await page.check('#ov-cammirror');
  await page.waitForFunction((id) => VJ.media.cam && VJ.media.cam.id === id, camId, { timeout: 10000 });
  assert.deepEqual(await page.evaluate(() => [VJ.app.settings.overlay.cameraId !== '', VJ.app.show.effectiveMedia().mirror]), [true, true]);
  // 止める：開き直さない。O で出し直すと開く
  await page.click('#btn-ov-camstop');
  await page.waitForFunction(() => !VJ.media.cam);
  await page.waitForTimeout(3500);
  assert.equal(await page.evaluate(() => !!VJ.media.cam), false, '止めたカメラは勝手に開かない');
  await page.waitForFunction(() => /止まっています/.test(document.getElementById('ov-status').textContent));
  await page.keyboard.press('KeyO');
  await page.waitForFunction(() => VJ.media._lastOn === false); // 描画のフレームが O の OFF を見るまで
  await page.keyboard.press('KeyO');
  await page.waitForFunction(() => !!VJ.media.cam, null, { timeout: 10000 });
  // 外れた（USB が抜けた）→ 案内を出して、つながれば開き直す
  await page.evaluate(() => { const tr = VJ.media.cam.stream.getVideoTracks()[0]; tr.stop(); tr.dispatchEvent(new Event('ended')); });
  await page.waitForFunction(() => !VJ.media.cam && VJ.media.status === 'lost');
  await page.waitForFunction(() => !!VJ.media.cam, null, { timeout: 10000 });
  // 本番前チェック
  await page.click('#btn-precheck');
  await page.waitForFunction(() => /カメラ：/.test(document.getElementById('precheck').textContent));
  // ほかの種類にすると閉じる
  await page.check('input[name=ov-kind][value=image]');
  await page.waitForFunction(() => !VJ.media.cam);
  assert.deepEqual(errors, []);
  await page.close();
});

test('メディアの一覧：入れる・曲ごとに切り替える（m:…）・曲の途中で選んだものが優先・名前の変更・削除・再読み込みで残る', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await fresh(page);
  await makeImage(page, '#f80');
  await makeVideo(page);
  await page.evaluate(() => { VJ.app.settings.setlistText = 'A | 1\nB | 2\nC | 3'; document.getElementById('setlist').value = VJ.app.settings.setlistText; VJ.panel.applyShow(true); });
  // いまの画像を一覧に入れる
  await page.evaluate(() => VJ.panel.setOverlayImageFile(window.__img));
  await page.waitForFunction(() => /^data:image\//.test(VJ.app.settings.overlay.image));
  await page.click('#btn-ml-add');
  await page.waitForFunction(() => VJ.app.settings.mediaLib.length === 1);
  // ファイル（動画）をまとめて入れる・ファイルを一覧の欄に落とす（画像）
  await page.evaluate(() => VJ.mediaLibUI.addFiles([window.__video]));
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(window.__img);
    document.getElementById('ml-list').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => VJ.app.settings.mediaLib.length === 3);
  const lib = await page.evaluate(() => VJ.app.settings.mediaLib.map((x) => [x.kind, x.name]));
  assert.deepEqual(lib, [['image', '画像'], ['video', 'loop'], ['image', 'logo']]);
  assert.equal(await page.locator('#ml-list .ml-row').count(), 3);
  assert.equal(await page.evaluate(() => VJ.app.settings.overlay.mediaKind), 'image', '入れても、出しているものは変えない');
  // 表で曲ごとのメディアを選ぶ → 文字の欄にも m:… が入る
  const ids = await page.evaluate(() => VJ.app.settings.mediaLib.map((x) => x.id));
  await page.selectOption('#setlist-preview select[data-f="media"][data-i="0"]', ids[1]);
  await page.selectOption('#setlist-preview select[data-f="media"][data-i="2"]', 'off');
  assert.match(await page.inputValue('#setlist'), /^1\. A \| 1 \| {2}\| m:loop$/m);
  assert.match(await page.inputValue('#setlist'), /^3\. C \| 3 \| {2}\| m:off$/m);
  // 曲を進めると切り替わる
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => VJ.media.status === 'playing' && VJ.media.video && VJ.app.renderer.ovVid && VJ.app.renderer.ovVid.ready, null, { timeout: 15000 });
  await page.waitForFunction(() => /曲の指定：loop/.test(document.getElementById('ov-status').textContent));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => VJ.media.effKind === 'image' && !VJ.media.video && VJ.app.renderer.ovImg);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => VJ.media.effKind === '' && !VJ.app.renderer.ovImg);
  await page.waitForFunction(() => /m:off/.test(document.getElementById('ov-status').textContent));
  // m:off の曲でも、一覧の ▶ で出す（次の曲まで優先）
  await page.click(`#ml-list button[data-act=show][data-id="${ids[2]}"]`);
  await page.waitForFunction(() => VJ.media.effKind === 'image' && VJ.media.status === 'ready');
  assert.deepEqual(await page.evaluate(() => [VJ.app.settings.overlay.mediaKind, VJ.app.show.effectiveMedia().name]), ['lib', 'logo']);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => VJ.media.effKind === '', null, { timeout: 3000 });
  // 名前を変えると、セットリストの m:… も書き換わる
  await page.fill(`#ml-list input[data-id="${ids[1]}"]`, 'MV');
  await page.press(`#ml-list input[data-id="${ids[1]}"]`, 'Enter');
  await page.waitForFunction(() => /m:MV/.test(document.getElementById('setlist').value));
  // 消す（確かめてから）→ 曲の指定は「見つからない」
  await page.click(`#ml-list button[data-act=del][data-id="${ids[1]}"]`);
  await page.click(`#ml-list button[data-act=del-yes][data-id="${ids[1]}"]`);
  await page.waitForFunction(() => VJ.app.settings.mediaLib.length === 2);
  await page.waitForFunction(() => /メディア「MV」が一覧にありません/.test(document.getElementById('setlist-preview').textContent));
  await page.click('#btn-precheck');
  await page.waitForFunction(() => /メディアの一覧にないメディア/.test(document.getElementById('precheck').textContent));
  // 再読み込み：一覧と中身（この PC に保存）が残る。動画の中身は消えている
  const keys = await page.evaluate(() => VJ.mediaLib.keys(VJ.app.settings));
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.app.renderer);
  assert.equal(await page.evaluate(() => VJ.app.settings.mediaLib.length), 2);
  const blobs = await page.evaluate((ks) => Promise.all(ks.map((k) => VJ.mediaStore.get(k).then((b) => !!b))), keys);
  assert.deepEqual(blobs, [true, true]);
  await page.evaluate((id) => { VJ.app.settings.overlay.mediaKind = 'lib'; VJ.app.settings.overlay.libId = id; VJ.app.settings.overlayOn = true; VJ.panel.syncOverlay(); VJ.panel.applyShow(true); }, ids[0]);
  await page.waitForFunction(() => VJ.media.effKind === 'image' && VJ.media.status === 'ready' && VJ.app.renderer.ovImg, null, { timeout: 5000 });
  assert.deepEqual(errors, []);
  await page.close();
});

test('キュー：いまの状態を入れる → Alt+数字・ボタンでまとめて切り替える。編集・消す', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await fresh(page);
  await makeImage(page, '#0af');
  await page.evaluate(() => VJ.mediaLibUI.addFiles([window.__img]));
  await page.waitForFunction(() => VJ.app.settings.mediaLib.length === 1);
  const id = await page.evaluate(() => VJ.app.settings.mediaLib[0].id);
  // いまの状態：トンネル・パレット 4・一覧の画像・重ねるシーン無し
  await page.evaluate((id) => {
    VJ.app.show.selectScene('tunnel', { immediate: true });
    VJ.app.show.setPalette(3);
    Object.assign(VJ.app.settings.overlay, { mediaKind: 'lib', libId: id });
    VJ.app.settings.overlayOn = true;
    VJ.app.settings.ovSceneOn = false;
    VJ.panel.applyShow(true);
  }, id);
  await page.click('#btn-cue-add');
  await page.waitForFunction(() => VJ.app.settings.cues.length === 1);
  assert.deepEqual(await page.evaluate(() => VJ.app.settings.cues[0]), { name: 'キュー 1', scene: 'tunnel', palette: 3, media: id, ovScene: 'off' });
  assert.match(await page.textContent('#cue-grid'), /キュー 1/);
  // 別の状態にしてから Alt+1
  await page.evaluate(() => { VJ.app.show.selectScene('ripple', { immediate: true }); VJ.app.show.setPalette(0); VJ.app.settings.overlayOn = false; VJ.app.settings.ovSceneOn = true; VJ.app.settings.overlay.scene = 'stars'; VJ.panel.applyShow(true); });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Alt+Digit1');
  await page.waitForFunction(() => VJ.app.show.state.sceneId === 'tunnel');
  assert.deepEqual(await page.evaluate(() => [VJ.app.show.state.paletteIdx, VJ.app.settings.overlayOn, VJ.app.settings.ovSceneOn, VJ.app.show.effectiveMedia().name]), [3, true, false, 'logo']);
  // 編集：名前・シーン（「そのまま」もある）
  await page.fill('#cue-edit input[data-cf=name][data-i="0"]', 'サビ');
  await page.press('#cue-edit input[data-cf=name][data-i="0"]', 'Enter');
  await page.selectOption('#cue-edit select[data-cf=scene][data-i="0"]', 'stars');
  await page.selectOption('#cue-edit select[data-cf=palette][data-i="0"]', '-1');
  assert.deepEqual(await page.evaluate(() => [VJ.app.settings.cues[0].name, VJ.app.settings.cues[0].scene, VJ.app.settings.cues[0].palette]), ['サビ', 'stars', -1]);
  await page.evaluate(() => VJ.app.show.setPalette(5));
  await page.click('#cue-grid button[data-cue="0"]');
  await page.waitForFunction(() => VJ.app.show.state.sceneId === 'stars');
  assert.equal(await page.evaluate(() => VJ.app.show.state.paletteIdx), 5, '色は「そのまま」');
  // 無いキュー
  await page.keyboard.press('Alt+Digit5');
  await page.waitForFunction(() => /キュー 5 はありません/.test(document.getElementById('toast').textContent));
  // 2 つ目を作って並べ替え・消す
  await page.click('#btn-cue-add');
  await page.waitForFunction(() => VJ.app.settings.cues.length === 2);
  await page.click('#cue-edit button[data-act=up][data-i="1"]');
  assert.equal(await page.evaluate(() => VJ.app.settings.cues[1].name), 'サビ');
  await page.click('#cue-edit button[data-act=del][data-i="1"]');
  await page.click('#cue-edit button[data-act=del-yes][data-i="1"]');
  assert.equal(await page.evaluate(() => VJ.app.settings.cues.length), 1);
  // 再読み込みで残る
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.app.renderer);
  assert.equal(await page.evaluate(() => VJ.app.settings.cues.length), 1);
  assert.equal(await page.locator('#cue-grid button').count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('2 画面：一覧の画像・曲ごとのメディアは出力ウィンドウで出す。出力ウィンドウでのキュー・カメラ', async () => {
  const { page: ctrl, errors } = await openApp(browser, DIST, 'test=1', { width: 1100, height: 800 });
  await fresh(ctrl);
  await makeImage(ctrl, '#fff');
  await ctrl.evaluate(() => VJ.mediaLibUI.addFiles([window.__img]));
  await ctrl.waitForFunction(() => VJ.app.settings.mediaLib.length === 1);
  await ctrl.evaluate(() => {
    VJ.app.settings.setlistText = 'A | 1 | | m:1\nB | 2';
    VJ.app.settings.cues = [{ name: 'C1', scene: 'aurora', palette: 2, media: 'off', ovScene: '' }];
    VJ.app.settings.overlayOn = false;
    VJ.panel.replaceSettings(VJ.app.settings);
  });
  const [out] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.link.role === 'output', null, { timeout: 30000 });
  await ctrl.waitForFunction(() => VJ.link.role === 'control');
  // 曲を進める（操作ウィンドウのキー）→ 出力ウィンドウで一覧の画像を出す
  await ctrl.evaluate(() => document.activeElement && document.activeElement.blur());
  await ctrl.keyboard.press('ArrowRight');
  await out.waitForFunction(() => VJ.media.effKind === 'image' && VJ.media.status === 'ready' && VJ.app.renderer.ovImg, null, { timeout: 10000 });
  await ctrl.waitForFunction(() => VJ.app.settings.overlayOn === true, null, { timeout: 5000 });
  await ctrl.evaluate(() => { document.getElementById('overlay-box').open = true; });
  await ctrl.waitForFunction(() => /曲の指定：logo/.test(document.getElementById('ov-status').textContent), null, { timeout: 5000 });
  assert.equal(await ctrl.evaluate(() => !!VJ.app.renderer.ovImg), false, '操作ウィンドウでは出さない');
  // 出力ウィンドウで Alt+1 → 操作ウィンドウで設定を変えて、出力ウィンドウに反映
  await out.keyboard.press('Alt+Digit1');
  await out.waitForFunction(() => VJ.app.show.state.sceneId === 'aurora' && VJ.app.show.state.paletteIdx === 2 && VJ.app.settings.overlayOn === false, null, { timeout: 5000 });
  await ctrl.waitForFunction(() => VJ.app.settings.overlayOn === false);
  // カメラは出力ウィンドウで開く
  await ctrl.evaluate(() => { VJ.app.settings.overlay.mediaKind = 'camera'; VJ.panel.syncOverlay(); });
  await ctrl.click('#btn-ov-camopen');
  await out.waitForFunction(() => !!VJ.media.cam, null, { timeout: 15000 });
  assert.equal(await ctrl.evaluate(() => !!VJ.media.cam), false);
  await ctrl.waitForFunction(() => /カメラ：/.test(document.getElementById('ov-status').textContent), null, { timeout: 5000 });
  await out.close();
  assert.deepEqual(errors, []);
  await ctrl.close();
});
