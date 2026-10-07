// 英語の表示（日本語が残っていないか）と、Chrome 以外のブラウザ（機能が足りない環境）での起動
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, DIST } from '../helpers/browser.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

async function open(ctxOpts, query = '', init) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, ctxOpts || {}));
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + DIST + (query ? '?' + query : ''));
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.app.renderer && VJ.panel.app);
  return { ctx, page, errors };
}

/** 見えている文字・title・placeholder のうち、日本語を含むもの（入力された文字は除く） */
const japaneseLeft = (page) => page.evaluate(() => {
  const JP = /[぀-ヿ㐀-鿿！-｠]/;
  const out = new Set();
  const skip = (el) => el.closest('textarea, script, style, [data-i18n-skip]');
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!el || skip(el) || el.closest('[hidden]')) continue;
    if (JP.test(n.nodeValue)) out.add(n.nodeValue.trim().slice(0, 80));
  }
  for (const el of document.querySelectorAll('[title], [placeholder]')) {
    if (skip(el)) continue;
    for (const a of ['title', 'placeholder']) if (el.getAttribute(a) && JP.test(el.getAttribute(a))) out.add(`${a}: ${el.getAttribute(a)}`);
  }
  return [...out];
});

test('英語：パネル・キー一覧・診断表示・トースト・状態表示に日本語が残らない', async () => {
  const { ctx, page, errors } = await open({}, 'test=1');
  await page.selectOption('#opt-lang', 'en');
  // 曲名は入力された文字なので英語の曲名にしておく
  await page.fill('#setlist', '1. Opening | 1,2 | neon\n2. Ballad | 4 | ocean');
  await page.evaluate(() => { document.querySelectorAll('details').forEach((d) => (d.open = true)); });
  await page.check('input[name=src][value=demo]');
  await page.selectOption('#demo-kind', 'speech');
  await page.click('#btn-start');
  await page.waitForTimeout(6000);
  // キー一覧・診断表示・いろいろなトースト
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('KeyH');
  await page.keyboard.press('KeyD');
  await page.evaluate(() => { VJ.panel.renderMidiMap(); VJ.panel.renderIo(); });
  const toasts = [];
  for (const k of ['Digit1', 'Space', 'KeyB', 'KeyB', 'KeyA', 'KeyC', 'ArrowUp', 'KeyQ', 'KeyT', 'KeyG', 'KeyG', 'ArrowRight']) {
    await page.keyboard.press(k);
    toasts.push(await page.textContent('#toast'));
  }
  await page.waitForTimeout(500);
  const left = await japaneseLeft(page);
  const hud = await page.textContent('#hud');
  assert.deepEqual(left, [], 'Japanese left: ' + left.join(' | '));
  const JP = /[぀-ヿ㐀-鿿]/;
  assert.ok(!JP.test(hud), 'HUD: ' + hud);
  for (const t of toasts) assert.ok(!JP.test(t), 'toast: ' + t);
  assert.match(await page.textContent('#speech-view'), /Speech \(MC\) detected/);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  // 日本語に戻すと元どおり
  await page.selectOption('#opt-lang', 'ja');
  assert.match(await page.textContent('#btn-show'), /ショー開始/);
  assert.match(await page.textContent('#keys-full'), /フラッシュ/);
  // 英語のときにコードが書いた文字（MIDI の状態など）も日本語に戻る。受信ポートの番号は消えない
  const ms = await page.textContent('#midi-status');
  assert.ok(!ms.trim() || JP.test(ms), 'midi-status: ' + ms);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('英語：ブラウザの言語が英語なら自動で英語になり、設定に保存される', async () => {
  const { ctx, page } = await open({ locale: 'en-US' });
  assert.equal(await page.evaluate(() => VJ.i18n.lang), 'en');
  assert.match(await page.textContent('#btn-show'), /Start show/);
  assert.match(await page.inputValue('#setlist'), /Opening/, '初めて開いたときは英語の見本');
  await page.selectOption('#opt-lang', 'ja');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  assert.equal(await page.evaluate(() => VJ.i18n.lang), 'ja', '保存した言語が優先');
  await ctx.close();
});

test('Firefox 相当（MIDI・USB-DMX・画面共有の音・スリープ防止などが無い）でも起動・入力・表示ができ、使えない機能を知らせる', async () => {
  const init = () => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0' });
    for (const k of ['requestMIDIAccess', 'serial', 'wakeLock', 'keyboard']) {
      try { Object.defineProperty(Navigator.prototype, k, { get: () => undefined, configurable: true }); } catch (e) { /* noop */ }
    }
    try { delete window.getScreenDetails; } catch (e) { /* noop */ }
    try { Object.defineProperty(window, 'getScreenDetails', { value: undefined, configurable: true }); } catch (e) { /* noop */ }
    try { Object.defineProperty(MediaDevices.prototype, 'getDisplayMedia', { value: undefined, configurable: true }); } catch (e) { /* noop */ }
  };
  const { ctx, page, errors } = await open({}, '', init);
  const info = await page.evaluate(() => ({ browser: VJ.compat.browser, warn: document.getElementById('warnings').textContent, display: document.querySelector('input[name=src][value=display]').disabled }));
  assert.equal(info.browser, 'firefox');
  assert.match(info.warn, /Firefox/);
  assert.match(info.warn, /MIDI/);
  assert.equal(info.display, true, '画面共有の音は選べない');
  await page.check('input[name=src][value=mic]');
  await page.click('#btn-start');
  await page.waitForFunction(() => VJ.app.engine.status === 'running', null, { timeout: 15000 });
  await page.evaluate(() => { document.querySelectorAll('details').forEach((d) => (d.open = true)); });
  await page.click('#btn-midi');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#midi-status'), /MIDI/);
  await page.click('#btn-show');
  await page.waitForTimeout(1500);
  const f0 = await page.evaluate(() => VJ.app.frameNo);
  await page.waitForTimeout(800);
  assert.ok((await page.evaluate(() => VJ.app.frameNo)) > f0, '描画が続いている');
  assert.deepEqual(errors, []);
  await ctx.close();
});
