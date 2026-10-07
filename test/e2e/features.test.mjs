// 追加機能の E2E：表示調整・ロゴ・テロップ・音楽タイプ・フラッシュ無効・動きの大きさ・テストパターン・
// タップテンポ・プレイリスト・画面共有の音声・前回の続き・フレームレート上限・自動開始・出力ウィンドウ
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, openApp, DIST, FIXTURES } from '../helpers/browser.mjs';
import { regionFlashes } from '../helpers/flash.mjs';

let browser, page, errors;
before(async () => {
  browser = await launch({ wav: FIXTURES + '/drums.wav' });
  ({ page, errors } = await openApp(browser, DIST, 'test=1&scale=1&pr=1', { width: 192, height: 108 }));
});
after(async () => { await browser.close(); });

const run = (opts) => page.evaluate((o) => VJ.testing.runOffline(o).then((r) => ({ luma: r.luma, scenes: r.scenes, denied: r.denied, bpm: r.bpm })), opts);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const BASE = { auto: false, autoFlash: false };

test('表示の調整：縮小すると外側が黒・回転すると論理サイズが縦横入れ替わる', async () => {
  const r = await run({ samples: 'demo', offset: 38, seconds: 1, sceneId: 'aurora', settings: Object.assign({}, BASE, { output: { rotate: 0, size: 0.5, x: 0, y: 0 } }), grid: [8, 4] });
  const last = r.luma[r.luma.length - 1];
  const corner = [0, 7, 24, 31].map((i) => last[i]);
  const center = [10, 11, 12, 13, 18, 19, 20, 21].map((i) => last[i]);
  assert.ok(Math.max(...corner) < 0.002, 'corners black ' + corner);
  assert.ok(mean(center) > 0.01, 'center visible ' + mean(center));
  const dims = await page.evaluate(async () => {
    await VJ.testing.runOffline({ samples: 'demo', seconds: 0.2, sceneId: 'ripple', settings: { output: { rotate: 90, size: 1 } } });
    VJ.app.renderer.setOutput({ rotate: 90 });
    VJ.app.renderer._resize();
    const i = VJ.app.renderer.info();
    VJ.app.renderer.setOutput(VJ.app.settings.output);
    VJ.app.renderer._resize();
    return i;
  });
  assert.deepEqual(dims.logical, [dims.size[1], dims.size[0]]);
});

test('ロゴ：タイトルでバンド名の代わり・隅の透かし', async () => {
  const logo = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 100); return c.toDataURL(); });
  const r = await run({ samples: 'demo', seconds: 0.6, sceneId: 'title', settings: Object.assign({}, BASE, { logo, logoMode: 'title' }), grid: [4, 3], logoWait: 300 });
  const last = r.luma[r.luma.length - 1];
  assert.ok(last[5] > 0.5 && last[6] > 0.5, 'white logo in center ' + last);
  const r2 = await run({ samples: 'demo', seconds: 0.6, sceneId: 'stars', settings: Object.assign({}, BASE, { logo, logoMode: 'corner', logoCorner: 'br' }), grid: [8, 6], logoWait: 300 });
  const l2 = r2.luma[r2.luma.length - 1];
  assert.ok(l2[7] > 0.3, 'logo at bottom-right ' + l2[7]); // 行 0 = 画面下（readPixels は下から）
  assert.ok(l2[40] < 0.2, 'no logo at top-left ' + l2[40]);
});

test('テロップ：Q で表示・もう一度で消える／空のテロップは表示しない', async () => {
  const actions = { 20: [['toggleMessage', 0]], 80: [['toggleMessage', 0]], 120: [['toggleMessage', 1]] };
  const r = await run({ samples: 'demo', seconds: 2.5, sceneId: 'stars', settings: Object.assign({}, BASE, { messages: ['テスト', '', ''] }), grid: [1, 3], actions });
  const bottom = r.luma.map((f) => f[0]);
  assert.ok(bottom[60] > bottom[10] * 3 + 0.01, `message shown ${bottom[10]} -> ${bottom[60]}`);
  assert.ok(bottom[140] < bottom[60] * 0.5, `message hidden ${bottom[140]}`);
});

test('音楽タイプ「しっとり」・「フラッシュを使わない」ではキメでも光らない', async () => {
  for (const settings of [{ profile: 'calm', autoFlash: true }, { noFlash: true, autoFlash: true }]) {
    const actions = { 100: [['flash', 0.85, 'key']] };
    const r = await run({ samples: 'demo', offset: 30, seconds: 8, sceneId: 'kaleido', settings: Object.assign({ auto: false }, settings), grid: [4, 3], actions });
    const rf = regionFlashes(r.luma, 60);
    assert.ok(Math.max(...rf) <= 1, JSON.stringify(settings) + ' ' + rf);
  }
  // 手動のフラッシュは「しっとり」でも使える（フラッシュ無効のときだけ使えない）
  const flashes = await page.evaluate(() => {
    const out = [];
    for (const s of [{ profile: 'calm' }, { noFlash: true }]) {
      const c = new VJ.ShowController(Object.assign({}, VJ.app.settings, s));
      out.push(c.flash(0.8, 'key'));
    }
    return out;
  });
  assert.deepEqual(flashes, [true, false]);
});

test('動きの大きさ：小さくするとキックでの変化が小さくなる', async () => {
  const sw = async (react) => {
    const r = await run({ song: { bpm: 120, seed: 1, humanize: 0, lead: 1.0, sections: [{ bars: 2, drums: 'click' }] }, seconds: 3, sceneId: 'ripple', settings: Object.assign({}, BASE, { react }), grid: [1, 1] });
    const L = r.luma.map((f) => f[0]);
    return Math.max(...L.slice(60)) - Math.min(...L.slice(40, 60));
  };
  const lo = await sw(0.3), hi = await sw(1.5);
  assert.ok(hi > lo * 1.5, `react 0.3: ${lo} / 1.5: ${hi}`);
});

test('ドラムの無い曲でもシーンが反応し、テンポが取れる', async () => {
  const r = await run({ song: { bpm: 100, seed: 3, sections: [{ bars: 12, drums: 'none', keys: 'arp' }] }, seconds: 20, sceneId: 'ripple', settings: Object.assign({}, BASE, { profile: 'auto' }), grid: [1, 1] });
  assert.ok(Math.abs(r.bpm - 100) < 3, 'bpm ' + r.bpm);
  const L = r.luma.slice(600).map((f) => f[0]);
  assert.ok(Math.max(...L) - Math.min(...L) > 0.005, 'reacts to notes');
});

test('テストパターン（G）とタップテンポ（Enter）・数字 7〜9 のシーン', async () => {
  await page.click('#btn-start');
  await page.waitForFunction(() => VJ.app.engine.status === 'running', null, { timeout: 15000 });
  await page.keyboard.press('KeyG');
  assert.equal(await page.evaluate(() => VJ.app.show.state.sceneId), 'test');
  await page.keyboard.press('KeyG');
  assert.notEqual(await page.evaluate(() => VJ.app.show.state.sceneId), 'test');
  // 同じ数字をもう一度押すとすぐ切り替わる。Shift+数字は 2 段目のシーン
  for (const [key, id] of [['Digit7', 'eq'], ['Digit8', 'stars'], ['Digit9', 'scope']]) {
    await page.keyboard.press(key); await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => VJ.app.show.state.sceneId), id);
  }
  for (const [key, id] of [['Digit1', 'orb'], ['Digit5', 'waves'], ['Digit9', 'voiceprint']]) {
    await page.keyboard.down('Shift'); await page.keyboard.press(key); await page.keyboard.press(key); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => VJ.app.show.state.sceneId), id);
  }
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(500); }
  const f = await page.evaluate(() => ({ bpm: VJ.app.extractor.features.bpm, manual: VJ.app.extractor.features.tempoManual }));
  assert.ok(f.manual && Math.abs(f.bpm - 120) < 15, JSON.stringify(f));
});

test('音声ファイルを複数選ぶと順番に再生し、「次の曲」で進む', async () => {
  const wav = fs.readFileSync(FIXTURES + '/click.wav');
  await page.evaluate(() => VJ.panel.toggle(true));
  await page.check('input[name=src][value=file]');
  await page.setInputFiles('#file', [
    { name: 'a.wav', mimeType: 'audio/wav', buffer: wav },
    { name: 'b.wav', mimeType: 'audio/wav', buffer: wav },
  ]);
  await page.click('#btn-start');
  await page.waitForFunction(() => /1\/2/.test(document.getElementById('audio-status').textContent), null, { timeout: 15000 });
  assert.equal(await page.isVisible('#btn-skip'), true);
  await page.click('#btn-skip');
  await page.waitForFunction(() => /2\/2/.test(document.getElementById('audio-status').textContent), null, { timeout: 15000 });
});

test('PC で再生中の音：音声が共有されなかったときは手順を表示', async () => {
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas');
      return c.captureStream(1); // 映像だけ（音声なし）
    };
  });
  await page.check('input[name=src][value=display]');
  await page.click('#btn-start');
  await page.waitForFunction(() => VJ.app.engine.status === 'error', null, { timeout: 15000 });
  assert.match(await page.textContent('#audio-status'), /システム音声を共有/);
});

test('フレームレート上限 30fps で描画が間引かれる（解析は毎フレーム）', async () => {
  const r = await page.evaluate(async () => {
    VJ.app.settings.fpsCap = 30;
    const f0 = VJ.app.frameNo, r0 = VJ.app.renderer.frame;
    await new Promise((res) => setTimeout(res, 1500));
    const out = { frames: VJ.app.frameNo - f0, renders: VJ.app.renderer.frame - r0 };
    VJ.app.settings.fpsCap = 0;
    return out;
  });
  // ヘッドレスは描画が遅いので比率だけ見る（全フレーム描画しないこと）
  assert.ok(r.renders <= r.frames, JSON.stringify(r));
});

test('前回の続きから再開・起動時の自動開始', async () => {
  const p2 = await openApp(browser, DIST, 'test=1', { width: 320, height: 180 });
  await p2.page.evaluate(() => {
    localStorage.setItem('momosai-vj/v1/session', JSON.stringify({ songIdx: 2, endState: false, sceneId: 'aurora', paletteIdx: 2, t: Date.now() }));
    const s = JSON.parse(localStorage.getItem('momosai-vj/v1') || '{}');
    Object.assign(s, VJ.app.settings, { autoStart: true, lastSource: 'demo', monitor: false });
    localStorage.setItem('momosai-vj/v1', JSON.stringify(s));
  });
  await p2.page.reload();
  await p2.page.waitForFunction(() => window.VJ && VJ.app && VJ.app.renderer);
  await p2.page.waitForSelector('#resume-box:not([hidden])');
  await p2.page.click('#btn-resume');
  const st = await p2.page.evaluate(() => ({ song: VJ.app.show.state.songIdx, scene: VJ.app.show.state.sceneId, pal: VJ.app.show.state.paletteIdx }));
  assert.deepEqual(st, { song: 2, scene: 'aurora', pal: 2 });
  await p2.page.waitForFunction(() => VJ.app.engine.status === 'running' && VJ.app.engine.opts.source === 'demo', null, { timeout: 15000 });
  await p2.page.evaluate(() => { localStorage.clear(); });
  await p2.page.close();
});

test('出力ウィンドウ（2 画面）：操作側のキーで出力側が切り替わり、閉じると元に戻る', async () => {
  const p = await openApp(browser, DIST, 'test=1', { width: 480, height: 270 });
  const ctrl = p.page;
  const [out] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.app.renderer && VJ.link.role === 'output', null, { timeout: 30000 });
  await ctrl.waitForFunction(() => VJ.link.role === 'control' && VJ.link.lastStatus, null, { timeout: 15000 });
  assert.equal(await ctrl.evaluate(() => VJ.app.paused), true);
  assert.equal(await out.evaluate(() => document.getElementById('panel').hidden), true);
  // 操作側でデモ音源を開始 → 出力側で動く
  await ctrl.check('input[name=src][value=demo]');
  await ctrl.uncheck('#monitor');
  await ctrl.click('#btn-start');
  await out.waitForFunction(() => VJ.app.engine.status === 'running', null, { timeout: 20000 });
  await ctrl.waitForFunction(() => /入力中/.test(document.getElementById('audio-status').textContent), null, { timeout: 10000 });
  // キー操作
  await ctrl.evaluate(() => VJ.panel.toggle(false));
  await ctrl.keyboard.press('Digit7'); await ctrl.keyboard.press('Digit7');
  await out.waitForFunction(() => VJ.app.show.state.sceneId === 'eq', null, { timeout: 5000 });
  await ctrl.keyboard.press('KeyB');
  await out.waitForFunction(() => VJ.app.show.state.blackout === true, null, { timeout: 5000 });
  // 設定の変更（明るさ）が出力側に届く
  await ctrl.evaluate(() => { VJ.panel.toggle(true); });
  await ctrl.evaluate(() => { const el = document.getElementById('opt-master'); el.value = '0.5'; el.dispatchEvent(new Event('input')); });
  await out.waitForFunction(() => VJ.app.show.state.master === 0.5, null, { timeout: 5000 });
  // メーターが操作側に表示される
  await ctrl.waitForFunction(() => VJ.app.engine.meter.l > -60, null, { timeout: 10000 });
  const frames = await out.evaluate(async () => { const f0 = VJ.app.renderer.frame; await new Promise((r) => setTimeout(r, 800)); return VJ.app.renderer.frame - f0; });
  assert.ok(frames > 3, 'output renders ' + frames);
  // 閉じると元に戻る
  await out.close();
  await ctrl.waitForFunction(() => VJ.link.role === 'solo' && !VJ.app.paused, null, { timeout: 5000 });
  assert.equal(await ctrl.evaluate(() => VJ.app.show.state.sceneId), 'eq');
  await ctrl.close();
});

test('チェックボックスやスライダーを触った直後でもショーのキーが効く（スライダーの矢印は微調整に使える）', async () => {
  await page.evaluate(() => { VJ.panel.toggle(true); document.querySelectorAll('#panel details').forEach((d) => { d.open = true; }); });
  // マウスでチェックボックスを押した直後：数字も Space もショーに効く
  await page.click('#opt-latsq');
  await page.waitForTimeout(50);
  await page.keyboard.press('Digit3'); await page.keyboard.press('Digit3');
  assert.equal(await page.evaluate(() => VJ.app.show.state.sceneId), 'horizon');
  const before = await page.evaluate(() => VJ.app.settings.latencySquare);
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => VJ.app.settings.latencySquare), before, 'Space はチェックボックスを切り替えない');
  // スライダーを触った直後：数字キーはショーに、矢印キーはスライダーに
  await page.click('#opt-react');
  await page.keyboard.press('Digit4'); await page.keyboard.press('Digit4');
  assert.equal(await page.evaluate(() => VJ.app.show.state.sceneId), 'aurora');
  const song0 = await page.evaluate(() => VJ.app.show.state.songIdx);
  const v0 = await page.evaluate(() => +document.getElementById('opt-react').value);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => VJ.app.show.state.songIdx), song0, '→ で曲が進まない');
  assert.ok(await page.evaluate(() => +document.getElementById('opt-react').value) > v0, 'スライダーが動く');
  // キーボード（Tab）で選んだボタンは Space で押せる
  await page.evaluate(() => { document.getElementById('btn-tap').focus(); });
  const taps = await page.evaluate(() => { let n = 0; const orig = VJ.app.show.tap.bind(VJ.app.show); VJ.app.show.tap = () => { n++; return orig(); }; window.__taps = () => n; return 0; });
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.__taps()), taps + 1, 'ボタンが押される');
  await page.evaluate(() => document.activeElement.blur());
});

test('2 画面のとき操作ウィンドウを再読み込みしても、出力ウィンドウにつなぎ直す', async () => {
  const p = await openApp(browser, DIST, 'test=1', { width: 480, height: 270 });
  const ctrl = p.page;
  const [out] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.link.role === 'output', null, { timeout: 30000 });
  await ctrl.waitForFunction(() => VJ.link.role === 'control' && VJ.link.lastStatus, null, { timeout: 15000 });
  await ctrl.reload();
  await ctrl.waitForFunction(() => window.VJ && VJ.link && VJ.link.role === 'control', null, { timeout: 15000 });
  await ctrl.evaluate(() => VJ.panel.toggle(false));
  await ctrl.keyboard.press('Digit8'); await ctrl.keyboard.press('Digit8');
  await out.waitForFunction(() => VJ.app.show.state.sceneId === 'stars', null, { timeout: 5000 });
  await out.close();
  await ctrl.close();
});

test('出力ウィンドウを再読み込みしても、曲の位置と音声入力が戻る', async () => {
  const p = await openApp(browser, DIST, 'test=1', { width: 480, height: 270 });
  const ctrl = p.page;
  await ctrl.evaluate(() => { VJ.app.settings.setlistText = 'A | 1\nB | 2\nC | 3'; VJ.app.settings.monitor = false; VJ.app.applySettings(); });
  const [out] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.link.role === 'output', null, { timeout: 30000 });
  await ctrl.waitForFunction(() => VJ.link.lastStatus, null, { timeout: 15000 });
  await ctrl.evaluate(() => VJ.app.startAudio({ source: 'demo', monitor: false }));
  await ctrl.evaluate(() => VJ.panel.toggle(false));
  await ctrl.keyboard.press('ArrowRight');
  await ctrl.keyboard.press('ArrowRight');
  await out.waitForFunction(() => VJ.app.show.state.songIdx === 1 && VJ.app.engine.status === 'running', null, { timeout: 15000 });
  await ctrl.waitForFunction(() => VJ.link.lastStatus.state.songIdx === 1 && VJ.link.lastStatus.engineStatus === 'running', null, { timeout: 5000 });
  await out.reload();
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.app.show.state.songIdx === 1 && VJ.app.engine.status === 'running', null, { timeout: 20000 });
  // 閉じた直後にすぐ開き直しても壊れない
  await ctrl.evaluate(() => VJ.panel.toggle(true));
  await ctrl.click('#btn-output-stop');
  const [out2] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out2.waitForFunction(() => window.VJ && VJ.app && VJ.link.role === 'output', null, { timeout: 30000 });
  await ctrl.waitForFunction(() => VJ.link.role === 'control' && VJ.app.show instanceof VJ.link.RemoteShow && !(VJ.link.local.show instanceof VJ.link.RemoteShow), null, { timeout: 5000 });
  await out2.close();
  await ctrl.waitForFunction(() => VJ.link.role === 'solo' && !(VJ.app.show instanceof VJ.link.RemoteShow), null, { timeout: 5000 });
  await ctrl.close();
});

test('自分が開いていないページからの偽の通知では、操作対象を切り替えない', async () => {
  const fs2 = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(path.dirname(DIST), '..', 'test', 'artifacts');
  fs2.mkdirSync(dir, { recursive: true });
  const opener = path.join(dir, 'opener.html');
  fs2.writeFileSync(opener, '<!doctype html><meta charset="utf-8"><body>opener</body>');
  const ctx = await browser.newContext();
  const x = await ctx.newPage();
  await x.goto('file://' + opener);
  const [vj] = await Promise.all([ctx.waitForEvent('page'), x.evaluate((u) => { window.vj = window.open(u + '?test=1', 'vj'); }, 'file://' + DIST)]);
  await vj.waitForFunction(() => window.VJ && VJ.app && VJ.app.renderer, null, { timeout: 30000 });
  await x.evaluate(() => {
    for (let i = 0; i < 5; i++) window.vj.postMessage({ t: 'status', role: 'output', state: { sceneId: 'glitch' }, patch: { master: 0.3, bandName: 'HACK' }, meter: {}, diag: {} }, '*');
  });
  await vj.waitForTimeout(500);
  const st = await vj.evaluate(() => ({ role: VJ.link.role, master: VJ.app.settings.master, band: VJ.app.settings.bandName, paused: VJ.app.paused }));
  assert.equal(st.role, 'solo');
  assert.equal(st.paused, false);
  assert.notEqual(st.band, 'HACK');
  await ctx.close();
});

test('コンソールエラーなし', () => {
  assert.deepEqual(errors.filter((e) => !/getDisplayMedia|NoAudioShared/.test(e)), []);
});
