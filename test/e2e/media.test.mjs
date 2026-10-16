// メディアのオーバーレイ（画像の貼り付け・ファイルを落とす・動画ファイル・画面の取り込み）と、
// 2 画面のときの受け渡し。YouTube・ニコニコの埋め込みはやめたので、古い設定の扱いだけを確かめる
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
  await page.evaluate(() => { document.getElementById('overlay-box').open = true; });
};

/** 見本の動画（test/fixtures/overlay.webm：2 秒・160×90・ffmpeg の testsrc2（明るい色の動く見本））を、ページの window.__video に */
const VIDEO_B64 = fs.readFileSync(path.join(FIXTURES, 'overlay.webm')).toString('base64');
const makeVideo = (page) => page.evaluate((b64) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  window.__video = new File([u], 'loop.webm', { type: 'video/webm' });
  return window.__video.size;
}, VIDEO_B64);

test('画像：Ctrl+V の貼り付け・ファイルを落とすとメディアに入る。文字の欄に文字を貼るときはそのまま', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await fresh(page);
  await page.evaluate(() => { VJ.app.settings.overlayOn = false; });
  const pasted = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = '#f80'; g.fillRect(0, 0, 64, 32);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  });
  assert.ok(pasted);
  await page.waitForFunction(() => /^data:image\//.test(VJ.app.settings.overlay.image));
  assert.deepEqual(await page.evaluate(() => [VJ.app.settings.overlay.mediaKind, VJ.app.settings.overlayOn]), ['image', true]);
  assert.ok(await page.isVisible('#ov-preview'));
  // 文字の欄に文字を貼る：オーバーレイは変わらない
  const before = await page.evaluate(() => VJ.app.settings.overlay.image);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'https://youtu.be/dQw4w9WgXcQ');
    document.getElementById('band').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  assert.equal(await page.evaluate(() => VJ.app.settings.overlay.mediaKind), 'image');
  // 文字の欄でないところに URL を貼っても、何も変えない（YouTube・ニコニコの埋め込みはやめた）
  const pastedUrl = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'https://youtu.be/dQw4w9WgXcQ?t=1m5s');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.equal(pastedUrl, false);
  assert.deepEqual(await page.evaluate(() => [VJ.app.settings.overlay.mediaKind, 'webUrl' in VJ.app.settings.overlay]), ['image', false]);
  // ファイルを落とす（画像）。落とした先のページへ移らない
  const prevented = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 40;
    c.getContext('2d').fillRect(0, 0, 40, 40);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'drop.png', { type: 'image/png' }));
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.getElementById('stage').dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.ok(prevented);
  await page.waitForFunction((b) => VJ.app.settings.overlay.mediaKind === 'image' && VJ.app.settings.overlay.image !== b, before);
  assert.deepEqual(errors, []);
  await page.close();
});

test('動画ファイル：メディアに入れると再生されて映像に重なる。再読み込みしても残る（この PC に保存）。▶ ⏸ ⏮', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await fresh(page);
  assert.ok((await makeVideo(page)) > 1000);
  // 明るさは描いた直後でないと読めないので、テスト用のオフライン描画で測る（メディアあり・なし）
  const lum = (on) => page.evaluate((on) => VJ.testing.runOffline({ samples: 'demo', seconds: 0.5, sceneId: 'stars', grid: [4, 3],
    settings: { auto: false, overlayOn: on, overlay: Object.assign({}, VJ.app.settings.overlay, { imageFit: 'stretch' }) } })
    .then((r) => { const f = r.luma[r.luma.length - 1]; return f.reduce((a, b) => a + b, 0) / f.length; }), on);
  const toasts = await page.evaluate(async () => {
    const got = [], t0 = VJ.app.ui.toast;
    VJ.app.ui.toast = (m, k) => { got.push([m, k || '']); return t0(m, k); };
    VJ.app.settings.overlay.imageFit = 'stretch';
    await VJ.panel.setOverlayVideoFile(window.__video);
    VJ.app.ui.toast = t0;
    return got;
  });
  // この PC に保存できたときは「保存できませんでした」の警告を出さない
  assert.ok(toasts.length && toasts.every(([m, k]) => k !== 'warn' && !/保存できません/.test(m)), JSON.stringify(toasts));
  await page.waitForFunction(() => VJ.media.status === 'playing' && VJ.app.renderer.ovVid && VJ.app.renderer.ovVid.ready, null, { timeout: 15000 });
  assert.match(await page.textContent('#ov-vname'), /loop\.webm/);
  await page.waitForFunction(() => /再生中/.test(document.getElementById('ov-status').textContent)); // 表示は 1 秒に 4 回
  const dark = await lum(false), lit = await lum(true);
  assert.ok(lit > dark + 0.03, `動画が重なって明るくなる ${dark} → ${lit}`);
  // 一時停止・最初から
  await page.click('#ov-play [data-mcmd=pause]');
  await page.waitForFunction(() => VJ.media.video && VJ.media.video.paused);
  await page.click('#ov-play [data-mcmd=restart]');
  await page.waitForFunction(() => VJ.media.video && !VJ.media.video.paused);
  // O で消すと止まり、また出すと動く
  await page.keyboard.press('KeyO');
  await page.waitForFunction(() => VJ.media.video.paused);
  await page.keyboard.press('KeyO');
  await page.waitForFunction(() => !VJ.media.video.paused);
  // 再読み込み：設定と、保存した動画から戻る
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.media && VJ.media.status === 'playing', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => VJ.app.settings.overlay.mediaKind), 'video');
  // 本番前チェック：映像の中の点滅（多いときは自動で濃さを下げるが、近似なので事前に確かめる）の注意
  await page.click('#btn-precheck');
  await page.waitForFunction(() => /映像の中の点滅/.test(document.getElementById('precheck').textContent));
  assert.deepEqual(errors, []);
  await page.close();
});

test('画面・タブの取り込み：選んだ画面が重なり、共有が終わると止まって案内が出る', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await fresh(page);
  await page.evaluate(() => {
    // 共有の代わり：明るいキャンバスの映像
    navigator.mediaDevices.getDisplayMedia = async (o) => {
      window.__gdm = o;
      const c = document.createElement('canvas'); c.width = 320; c.height = 180;
      const g = c.getContext('2d');
      setInterval(() => { g.fillStyle = '#ddd'; g.fillRect(0, 0, 320, 180); }, 30);
      const st = c.captureStream(30);
      window.__capTrack = st.getVideoTracks()[0];
      return st;
    };
  });
  await page.check('input[name=ov-kind][value=capture]');
  assert.ok(await page.isVisible('#btn-ov-capture'));
  await page.click('#btn-ov-capture');
  await page.waitForFunction(() => VJ.media.state().capture && VJ.app.renderer.ovVid && VJ.app.renderer.ovVid.ready, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__gdm.audio), false, '映像だけ（音は「PC で再生中の音」で別に）');
  assert.match(await page.textContent('#ov-status'), /取り込み中/);
  // 共有が終わった
  await page.evaluate(() => { window.__capTrack.stop(); window.__capTrack.dispatchEvent(new Event('ended')); });
  await page.waitForFunction(() => !VJ.media.state().capture);
  await page.waitForFunction(() => /取り込んでいません/.test(document.getElementById('ov-status').textContent));
  await page.click('#btn-precheck');
  await page.waitForFunction(() => /画面の取り込みが止まっています/.test(document.getElementById('precheck').textContent));
  assert.deepEqual(errors, []);
  await page.close();
});

test('YouTube・ニコニコの埋め込みはやめた：選べず、作らない。使っていた古い設定は画像に戻して、パネルの上で知らせる', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 720 });
  await fresh(page);
  assert.equal(await page.locator('input[name=ov-kind][value=web]').count(), 0, 'メディアの種類に無い');
  assert.equal(await page.locator('#ov-web').count(), 0);
  // 古い設定（YouTube を出していた・一覧に YouTube があった）を読み込む
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem(VJ.storage.KEY) || '{}');
    s.overlay = Object.assign({}, s.overlay, { mediaKind: 'web', webUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    s.overlayOn = true;
    s.mediaLib = [{ id: 'Lyt', name: 'MV', kind: 'web', url: 'https://youtu.be/dQw4w9WgXcQ' }];
    localStorage.setItem(VJ.storage.KEY, JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  assert.match(await page.textContent('#warnings'), /YouTube・ニコニコの埋め込みはなくなりました/);
  assert.deepEqual(await page.evaluate(() => [VJ.app.settings.overlay.mediaKind, VJ.app.settings.mediaLib.length]), ['image', 0]);
  assert.equal(await page.evaluate(() => document.querySelectorAll('iframe').length), 0, '埋め込みを作らない');
  // 次に開いたときは、もう知らせない（直した設定を保存した）
  await page.evaluate(() => VJ.panel.save());
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  assert.doesNotMatch(await page.textContent('#warnings'), /YouTube・ニコニコ/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('2 画面：動画ファイルは出力ウィンドウで出す（操作ウィンドウでは出さない）。取り込みの画面は出力ウィンドウで選ぶ', async () => {
  const { page: ctrl, errors } = await openApp(browser, DIST, 'test=1', { width: 1100, height: 800 });
  await fresh(ctrl);
  await makeVideo(ctrl);
  const [out] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.link.role === 'output', null, { timeout: 30000 });
  await ctrl.waitForFunction(() => VJ.link.role === 'control');
  await ctrl.evaluate(() => VJ.panel.setOverlayVideoFile(window.__video));
  await out.waitForFunction(() => VJ.media.status === 'playing' && VJ.app.renderer.ovVid && VJ.app.renderer.ovVid.ready, null, { timeout: 15000 });
  assert.equal(await ctrl.evaluate(() => !!document.querySelector('video')), false, '操作ウィンドウでは再生しない');
  await ctrl.waitForFunction(() => /再生中/.test(document.getElementById('ov-status').textContent), null, { timeout: 5000 });
  // 取り込み：出力ウィンドウで共有を選ぶ
  await out.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.getContext('2d').fillRect(0, 0, 10, 10); return c.captureStream(10); };
  });
  await ctrl.click('#overlay-box summary').catch(() => {});
  await ctrl.evaluate(() => { document.getElementById('overlay-box').open = true; });
  await ctrl.check('input[name=ov-kind][value=capture]');
  await ctrl.click('#btn-ov-capture');
  await out.waitForFunction(() => VJ.media.state().capture, null, { timeout: 10000 });
  await ctrl.waitForFunction(() => /取り込み中/.test(document.getElementById('ov-status').textContent), null, { timeout: 5000 });
  await out.close();
  assert.deepEqual(errors, []);
  await ctrl.close();
});
