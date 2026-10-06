// 実際の流れ（偽マイク → 解析 → 描画）と操作・事故対応の E2E。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, DIST, FIXTURES } from '../helpers/browser.mjs';

let browser, page, errors;

before(async () => {
  browser = await launch({ wav: FIXTURES + '/drums.wav' });
  ({ page, errors } = await openApp(browser, DIST, 'test=1', { width: 480, height: 270 }));
});
after(async () => { await browser.close(); });

test('マイク入力を開始するとメーターが動き、ヒットが検出される', async () => {
  await page.click('#btn-start');
  await page.waitForFunction(() => VJ.app.engine.status === 'running', null, { timeout: 15000 });
  await page.waitForTimeout(3500);
  const s = await page.evaluate(() => ({
    status: document.getElementById('audio-status').textContent,
    kick: VJ.app.extractor.features.kickN, snare: VJ.app.extractor.features.snareN,
    meter: VJ.app.engine.meter.l, settings: VJ.app.engine.trackSettings, diag: VJ.app.engine.diagnostics(),
    stored: JSON.parse(localStorage.getItem('momosai-vj/v1') || '{}'),
  }));
  assert.match(s.status, /入力中/);
  assert.ok(s.kick >= 3 && s.snare >= 2, `kick ${s.kick} snare ${s.snare}`);
  assert.ok(s.meter > -40, 'meter ' + s.meter);
  // 低遅延のため音声処理はすべて OFF になっている
  assert.equal(s.settings.echoCancellation, false);
  assert.equal(s.settings.noiseSuppression, false);
  assert.equal(s.settings.autoGainControl, false);
  // 新規サンプルの位置合わせが取れている（取りこぼし・二重処理なし）
  assert.ok(s.diag.align > 50 && s.diag.alignMiss === 0, JSON.stringify(s.diag));
  // 使ったデバイスが保存される
  assert.ok(s.stored.deviceLabel, 'device saved');
});

test('キー操作：数字でシーン（次のビートで）・→ で曲名・L でロック・長押しで解除', async () => {
  await page.keyboard.press('Digit2');
  await page.waitForFunction(() => VJ.app.show.state.sceneId === 'tunnel', null, { timeout: 2000 });
  await page.keyboard.press('ArrowRight');
  let st = await page.evaluate(() => ({ song: VJ.app.show.currentSong(), text: VJ.app.show.state.text }));
  assert.ok(st.song && st.text && st.text.main === st.song.title);
  await page.keyboard.press('KeyL');
  await page.keyboard.press('Digit5');
  await page.waitForTimeout(1200);
  st = await page.evaluate(() => ({ scene: VJ.app.show.state.sceneId, locked: VJ.app.show.state.locked }));
  assert.equal(st.locked, true);
  assert.notEqual(st.scene, 'kaleido');
  await page.keyboard.down('KeyL');
  await page.waitForTimeout(1700);
  await page.keyboard.up('KeyL');
  st = await page.evaluate(() => VJ.app.show.state.locked);
  assert.equal(st, false);
  // 入力欄に文字を打ってもショーは反応しない
  await page.evaluate(() => VJ.panel.toggle(true));
  await page.click('#band');
  await page.keyboard.type('B1');
  st = await page.evaluate(() => ({ black: VJ.app.show.state.blackout, scene: VJ.app.show.state.sceneId }));
  assert.equal(st.black, false);
  await page.keyboard.press('Escape');
});

test('ショー開始でパネルが隠れ、離脱確認とスリープ防止が有効になる', async () => {
  await page.click('#btn-show');
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({ panel: document.getElementById('panel').hidden, showing: VJ.guard.showing, wake: VJ.guard.wakeLockOk }));
  assert.equal(s.panel, true);
  assert.equal(s.showing, true);
  await page.keyboard.press('KeyM');
  assert.equal(await page.evaluate(() => document.getElementById('panel').hidden), false);
  await page.keyboard.press('KeyM');
});

test('ブラウザ内の遅延：音がグラフに入ってから画面に反映されるまで 中央値 40ms 以下', async () => {
  const r = await page.evaluate(() => VJ.testing.measureLatency({ count: 16 }));
  console.log('latency', JSON.stringify({ median: r.median, mean: r.mean, sd: r.sd, max: r.max, n: r.n, frame: r.frameInterval }));
  assert.ok(r.n >= 12, `detected ${r.n}/${r.expected}`);
  assert.ok(r.median <= 40, 'median ' + r.median);
  assert.ok(r.sd <= 15, 'sd ' + r.sd);
});

test('デバイスが抜けても自動で再接続し、描画は止まらない', async () => {
  await page.evaluate(() => VJ.app.startAudio({ source: 'mic' }));
  await page.waitForFunction(() => VJ.app.engine.status === 'running');
  const r = await page.evaluate(async () => {
    const f0 = VJ.app.frameNo;
    const tr = VJ.app.engine.stream.getAudioTracks()[0];
    tr.stop();
    tr.dispatchEvent(new Event('ended'));
    const lostSeen = VJ.app.engine.status;
    await new Promise((res) => setTimeout(res, 2500));
    return { lostSeen, status: VJ.app.engine.status, reconnects: VJ.app.engine.diag.reconnects, frames: VJ.app.frameNo - f0 };
  });
  assert.equal(r.lostSeen, 'lost');
  assert.equal(r.status, 'running');
  assert.ok(r.reconnects >= 1);
  assert.ok(r.frames > 20, 'frames ' + r.frames);
});

test('AudioContext が止まっても見張りが再開させる', async () => {
  const r = await page.evaluate(async () => {
    await VJ.app.engine.ctx.suspend();
    await new Promise((res) => setTimeout(res, 1500));
    return VJ.app.engine.ctx.state;
  });
  assert.equal(r, 'running');
});

test('連続運転（デモ音源 45 秒）：エラーなし・メモリが増え続けない', async () => {
  await page.evaluate(() => VJ.app.startAudio({ source: 'demo', monitor: false }));
  await page.waitForTimeout(3000);
  const m0 = await page.evaluate(() => { if (window.gc) window.gc(); return { heap: performance.memory.usedJSHeapSize, f: VJ.app.frameNo, e: VJ.app.errors }; });
  await page.waitForTimeout(45000);
  const m1 = await page.evaluate(() => ({ heap: performance.memory.usedJSHeapSize, f: VJ.app.frameNo, e: VJ.app.errors, scale: VJ.app.renderer.scale }));
  console.log('soak', JSON.stringify({ heapMB: ((m1.heap - m0.heap) / 1048576).toFixed(2), frames: m1.f - m0.f, scale: m1.scale }));
  assert.equal(m1.e, m0.e, 'errors during soak');
  assert.ok(m1.f - m0.f > 300, 'frames ' + (m1.f - m0.f));
  assert.ok(m1.heap - m0.heap < 5 * 1048576, 'heap grew ' + (m1.heap - m0.heap));
  assert.deepEqual(errors, []);
});

test('マイクが拒否されたら、許可の手順を表示する', async () => {
  // ヘッドレスでは許可ダイアログを出せないので、拒否（NotAllowedError）を返すように差し替える
  const b2 = await launch({ fakeUi: false });
  try {
    const ctx = await b2.newContext();
    await ctx.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    const p = await ctx.newPage();
    await p.goto('file://' + DIST + '?test=1');
    await p.waitForFunction(() => window.VJ && VJ.app && VJ.app.renderer);
    await p.click('#btn-start');
    await p.waitForFunction(() => VJ.app.engine.status === 'error', null, { timeout: 15000 });
    const msg = await p.evaluate(() => document.getElementById('audio-status').textContent);
    assert.match(msg, /許可/);
  } finally {
    await b2.close();
  }
});
