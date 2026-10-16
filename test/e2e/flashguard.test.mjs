// 重ねた映像（動画・画面の取り込み・カメラ）の点滅の見張り（src/show/safety.js の OverlayGuard と src/gfx/renderer.js）。
// 画面の取り込みの代わりに、白黒が入れ替わるキャンバスの映像を使い、実際に表示された画面の明るさを数える
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, DIST } from '../helpers/browser.mjs';
import { regionFlashes } from '../helpers/flash.mjs';

let browser, page, errors;
before(async () => {
  browser = await launch();
  ({ page, errors } = await openApp(browser, DIST, 'test=1', { width: 480, height: 270 }));
  await page.evaluate(async () => {
    // 取り込みの代わり：mode = 'strobe'（1 秒に 6 回の白黒の点滅）/ 'calm'（ゆっくり明るさが変わる）
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const g = c.getContext('2d');
    window.__mode = 'strobe';
    const t0 = performance.now();
    setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      const v = window.__mode === 'strobe' ? (Math.floor(s * 12) % 2 ? 255 : 0) : Math.round(110 + 40 * Math.sin(s * 1.5));
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, 0, 320, 180);
    }, 10);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(30);
    const s = VJ.app.settings;
    s.auto = false; s.autoFlash = false;
    s.overlay.imageOpacity = 1; s.overlay.imageFit = 'cover'; s.overlay.imageBlend = 'normal';
    VJ.panel.toggle(false);
    VJ.app.applySettings();
    VJ.app.show.selectScene('title', { immediate: true });
    await VJ.media.startCapture();
    s.overlayOn = true;
    VJ.app.applySettings();
  });
  await page.waitForFunction(() => VJ.app.renderer.ovVid && VJ.app.renderer.ovVid.ready, null, { timeout: 10000 });
});
after(async () => { await browser.close(); });

/** 4 秒間、表示された画面の 4x3 の領域の明るさを毎フレーム読む。on：見張りを使うか */
const measure = (on) => page.evaluate(async (on) => {
  const r = VJ.app.renderer;
  r.ovGuardOn = on;
  r.ovGuard.reset(); r.ovGuard.g = 1; r.ovGuard.alerts = 0;
  await new Promise((res) => setTimeout(res, 1500));
  const luma = [], ts = [];
  let minGain = 1;
  VJ.app.onFrame = (t) => { luma.push(Array.from(r.readLumaGrid(4, 3))); ts.push(t); minGain = Math.min(minGain, r._ovGain); };
  await new Promise((res) => setTimeout(res, 4000));
  VJ.app.onFrame = null;
  const iv = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  return { luma, fps: luma.length / ((ts[ts.length - 1] - ts[0]) / 1000), frame: iv[Math.floor(iv.length / 2)], state: r.ovGuardState(), alerts: r.ovGuard.alerts, minGain };
}, on);

test('強く点滅する映像（1 秒に 6 回）を重ねても、画面は 1 秒に 3 フラッシュ以下。見張りを止めると超える。描画は重くならない', async () => {
  await page.evaluate(() => { window.__mode = 'strobe'; });
  const off = await measure(false);
  const on = await measure(true);
  const fOff = Math.max(...regionFlashes(off.luma, Math.round(off.fps)));
  const fOn = Math.max(...regionFlashes(on.luma, Math.round(on.fps)));
  console.log('flashguard', JSON.stringify({ off: { flashes: fOff, fps: off.fps, frame: off.frame }, on: { flashes: fOn, fps: on.fps, frame: on.frame, state: on.state, minGain: on.minGain } }));
  assert.ok(fOff > 3, `見張りなしでは超える（テストが点滅を作れている）：${fOff}`);
  assert.ok(fOn <= 3, `見張りありでは 3 以下：${fOn}`);
  assert.equal(on.state, 'dim');
  assert.ok(on.minGain < 0.2, `濃さを下げた：${on.minGain}`);
  assert.ok(on.frame <= off.frame * 1.5 + 2, `描画の間隔（中央値）：見張りあり ${on.frame}ms / なし ${off.frame}ms`);
});

test('ゆっくり明るさが変わる映像では、濃さを下げない', async () => {
  await page.evaluate(() => { window.__mode = 'calm'; });
  const r = await measure(true);
  assert.equal(r.minGain, 1);
  assert.equal(r.state, '');
  assert.equal(r.alerts, 0);
});

test('「制限なし」なら下げずに知らせる。パネルのメディアの状態に出る', async () => {
  await page.evaluate(() => { window.__mode = 'strobe'; VJ.app.settings.flashLimit = 0; VJ.app.applySettings(); });
  const r = await measure(true);
  assert.equal(r.minGain, 1);
  assert.equal(r.state, 'strong');
  await page.evaluate(() => { VJ.panel.toggle(true); VJ.panel.renderMediaStatus(true); });
  assert.match(await page.textContent('#ov-status'), /強い点滅があります/);
  await page.evaluate(() => { VJ.app.settings.flashLimit = 3; VJ.app.applySettings(); });
  assert.deepEqual(errors, []);
});
