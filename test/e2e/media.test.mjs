// メディアのオーバーレイ（画像の貼り付け・ファイルを落とす・動画ファイル・画面の取り込み・YouTube / ニコニコ）と、
// 2 画面のときの受け渡し。YouTube / ニコニコはネットにつながないので、埋め込みのページを偽物に差し替えて確かめる
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
  // 文字の欄でないところに URL を貼る → YouTube のメディア
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'https://youtu.be/dQw4w9WgXcQ?t=1m5s');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  assert.deepEqual(await page.evaluate(() => [VJ.app.settings.overlay.mediaKind, VJ.app.settings.overlay.webUrl]), ['web', 'https://youtu.be/dQw4w9WgXcQ?t=1m5s']);
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
  await page.evaluate(() => { VJ.app.settings.overlay.imageFit = 'stretch'; VJ.panel.setOverlayVideoFile(window.__video); });
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
  // 本番前チェック：動画の中の点滅は制限できない、の注意
  await page.click('#btn-precheck');
  await page.waitForFunction(() => /動画の中の点滅/.test(document.getElementById('precheck').textContent));
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

const FAKE_EMBED = `<!doctype html><body style="margin:0;background:#2a6"><script>
  window.addEventListener('message', (e) => parent.postMessage({ fake: 'got', d: e.data }, '*'));
  if (location.host === 'embed.nicovideo.jp') setTimeout(() => parent.postMessage({ eventName: 'loadComplete', playerId: '1' }, '*'), 200);
</script></body>`;

test('YouTube / ニコニコ：URL から埋め込みを作り、映像の場所・濃さ・暗転・テストパターンに合わせる。▶ などの命令が届く', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 720 });
  await page.route('https://www.youtube-nocookie.com/embed/**', (r) => r.fulfill({ contentType: 'text/html', body: FAKE_EMBED }));
  await page.route('https://embed.nicovideo.jp/watch/**', (r) => r.fulfill({ contentType: 'text/html', body: FAKE_EMBED }));
  await fresh(page);
  await page.evaluate(() => { window.__got = []; window.addEventListener('message', (e) => { if (e.data && e.data.fake === 'got') window.__got.push(e.data.d); }); });
  await page.check('input[name=ov-kind][value=web]');
  await page.fill('#ov-web', 'not a url');
  await page.click('#btn-ov-web');
  assert.equal(await page.evaluate(() => VJ.app.settings.overlay.webUrl), '', '読めない URL は入れない');
  await page.fill('#ov-web', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90');
  await page.click('#btn-ov-web');
  await page.waitForSelector('#web-overlay iframe');
  const src = await page.getAttribute('#web-overlay iframe', 'src');
  assert.match(src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  for (const k of ['autoplay=1', 'mute=1', 'loop=1', 'playlist=dQw4w9WgXcQ', 'enablejsapi=1', 'start=90']) assert.ok(src.includes(k), k);
  // 映像の場所（パネルの下のキャンバス全体）に、16:9 で
  await page.waitForFunction(() => document.getElementById('web-overlay').getBoundingClientRect().width > 0);
  const box = await page.evaluate(() => { const r = document.getElementById('web-overlay').getBoundingClientRect(); const c = document.getElementById('stage').getBoundingClientRect(); return { r: [r.left, r.top, r.width, r.height], c: [c.left, c.top, c.width, c.height], op: getComputedStyle(document.getElementById('web-overlay')).opacity }; });
  assert.deepEqual(box.r.map(Math.round), box.c.map(Math.round));
  assert.equal(+box.op, 1);
  // 命令（再生）が埋め込みに届く
  await page.waitForFunction(() => window.__got.some((d) => typeof d === 'string' && /"playVideo"/.test(d)), null, { timeout: 5000 });
  await page.click('#ov-play [data-mcmd=pause]');
  await page.waitForFunction(() => window.__got.some((d) => typeof d === 'string' && /"pauseVideo"/.test(d)));
  // 濃さ・暗転・テストパターン・O
  await page.evaluate(() => { VJ.app.settings.overlay.imageOpacity = 0.5; VJ.panel.applyShow(true); });
  await page.waitForFunction(() => Math.abs(+getComputedStyle(document.getElementById('web-overlay')).opacity - 0.5) < 0.02);
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => +getComputedStyle(document.getElementById('web-overlay')).opacity < 0.01, null, { timeout: 3000 });
  await page.keyboard.press('KeyB');
  await page.keyboard.press('KeyG');
  await page.waitForFunction(() => document.getElementById('web-overlay').hidden);
  await page.keyboard.press('KeyG');
  await page.waitForFunction(() => !document.getElementById('web-overlay').hidden);
  await page.keyboard.press('KeyO');
  await page.waitForFunction(() => document.getElementById('web-overlay').hidden, null, { timeout: 3000 });
  await page.keyboard.press('KeyO');
  // ニコニコ：読み込みの完了の知らせで、音を消して再生
  await page.evaluate(() => { window.__got.length = 0; VJ.panel.setWebUrl('https://www.nicovideo.jp/watch/sm9'); });
  await page.waitForFunction(() => /embed\.nicovideo\.jp\/watch\/sm9\?/.test((document.querySelector('#web-overlay iframe') || {}).src || ''));
  await page.waitForFunction(() => window.__got.some((d) => d && d.eventName === 'play' && d.playerId === '1') && window.__got.some((d) => d && d.eventName === 'mute' && d.data && d.data.mute === true), null, { timeout: 5000 });
  // ほかの種類にすると埋め込みは消える
  await page.check('input[name=ov-kind][value=image]');
  await page.waitForFunction(() => !document.getElementById('web-overlay'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('2 画面：動画ファイル・YouTube は出力ウィンドウで出す（操作ウィンドウでは出さない）。取り込みの画面は出力ウィンドウで選ぶ', async () => {
  const { page: ctrl, errors } = await openApp(browser, DIST, 'test=1', { width: 1100, height: 800 });
  await ctrl.context().route('https://www.youtube-nocookie.com/embed/**', (r) => r.fulfill({ contentType: 'text/html', body: FAKE_EMBED }));
  await fresh(ctrl);
  await makeVideo(ctrl);
  const [out] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.link.role === 'output', null, { timeout: 30000 });
  await ctrl.waitForFunction(() => VJ.link.role === 'control');
  await ctrl.evaluate(() => VJ.panel.setOverlayVideoFile(window.__video));
  await out.waitForFunction(() => VJ.media.status === 'playing' && VJ.app.renderer.ovVid && VJ.app.renderer.ovVid.ready, null, { timeout: 15000 });
  assert.equal(await ctrl.evaluate(() => !!document.querySelector('video')), false, '操作ウィンドウでは再生しない');
  await ctrl.waitForFunction(() => /再生中/.test(document.getElementById('ov-status').textContent), null, { timeout: 5000 });
  // YouTube
  await ctrl.evaluate(() => VJ.panel.setWebUrl('https://youtu.be/dQw4w9WgXcQ'));
  await out.waitForSelector('#web-overlay iframe');
  assert.equal(await ctrl.evaluate(() => !!document.getElementById('web-overlay')), false);
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
