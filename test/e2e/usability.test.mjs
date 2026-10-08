// 使いやすさの機能（画面）：シーンを絵で選ぶ・早見表・出演バンド・セットリストの表・サウンドチェック・ガイド・本番前チェック・
// 2 画面のプレビュー・英語表示
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, DIST } from '../helpers/browser.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const startDemo = async (page) => {
  await page.check('input[name=src][value=demo]');
  await page.click('#btn-start');
  await page.waitForFunction(() => VJ.app.engine.running, null, { timeout: 15000 });
};

test('シーンを絵で選ぶ：押すと次のビートで切替・もう一度ですぐ。今のシーンに印。早見表に全シーンの見本画像とキー', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  const n = await page.locator('#scene-grid button[data-scene] img').count();
  assert.equal(n, await page.evaluate(() => VJ.scenes.list.filter((d) => !d.hidden).length));
  await startDemo(page);
  await page.click('#scene-grid button[data-scene="bokeh"]');
  await page.click('#scene-grid button[data-scene="bokeh"]');
  await page.waitForFunction(() => VJ.app.show.state.sceneId === 'bokeh');
  await page.waitForFunction(() => document.querySelector('#scene-grid button[data-scene="bokeh"]').classList.contains('on'));
  // 早見表
  const sheet = await page.evaluate(() => VJ.scenePick.sheetHtml());
  for (const name of await page.evaluate(() => VJ.scenePick.list().map((d) => VJ.sceneName(d)))) assert.ok(sheet.includes(name), name);
  assert.equal((sheet.match(/<img /g) || []).length, n);
  await page.evaluate(() => { VJ.scenePick.printSheet(); });
  await page.waitForFunction(() => { const f = document.getElementById('print-frame'); return f && f.contentDocument && f.contentDocument.querySelectorAll('.c').length > 10; });
  assert.deepEqual(errors, []);
  await page.close();
});

test('出演バンド：追加しても切り替わらず、その場で準備できる。本番中の切替は 2 回押し・その場の確認。再読み込みしても残る', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  await page.fill('#band', 'First Band');
  await page.fill('#setlist', 'One | 1\nTwo | 2');
  // 「＋ バンドを追加」：切り替えずに、その場で名前・開演時刻・セットリスト
  await page.click('#band-add');
  assert.equal(await page.evaluate(() => VJ.app.settings.bandIdx), 0);
  await page.fill('#band-list [data-bf="bandName"]', 'Second Band');
  await page.fill('#band-list [data-bf="countdownTo"]', '18:30');
  await page.fill('#band-list [data-bf="setlistText"]', 'Alpha | 3');
  await page.click('#band-list [data-act="edit-close"]');
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => VJ.bands.list(VJ.app.settings).map((b) => [b.name, b.songs, b.start, b.current])),
    [['First Band', 2, '', true], ['Second Band', 1, '18:30', false]]);
  assert.equal(await page.inputValue('#band'), 'First Band');
  // 本番前：行を押すとすぐ切り替わる
  await page.click('#band-list .band-row[data-i="1"] .bn');
  assert.equal(await page.inputValue('#band'), 'Second Band');
  assert.equal(await page.inputValue('#opt-countdown'), '18:30');
  await page.click('#band-list .band-row[data-i="0"] .bn');
  assert.equal(await page.evaluate(() => VJ.app.show.setlist.songs.length), 2);
  // 本番中（1 曲目）の N：1 回目は確認だけ。向きが変わったら数え直し。同じ向きで 2 回目に切替
  await page.evaluate(() => { VJ.panel.toggle(false); document.activeElement && document.activeElement.blur(); });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('KeyN');
  assert.match(await page.textContent('#toast'), /もう一度/);
  await page.keyboard.press('Shift+KeyN');
  assert.equal(await page.evaluate(() => VJ.app.settings.bandIdx), 0, 'N のあとの Shift+N では切り替えない');
  await page.keyboard.press('KeyN');
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => VJ.app.settings.bandIdx === 1);
  assert.equal(await page.evaluate(() => VJ.app.show.bandName()), 'Second Band');
  assert.deepEqual(await page.evaluate(() => [VJ.app.show.state.songIdx, VJ.app.show.state.sceneId]), [-1, 'title']);
  // 本番前（曲が始まっていない・音なし）なら 1 回で戻れる
  await page.keyboard.press('Shift+KeyN');
  await page.waitForFunction(() => VJ.app.settings.bandIdx === 0);
  // 本番中に一覧の行を押すと、その場で確かめる（確認ダイアログは出さない）
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => VJ.panel.toggle(true));
  await page.click('#band-list .band-row[data-i="1"] .bn');
  await page.waitForSelector('#band-list .band-confirm');
  assert.equal(await page.evaluate(() => VJ.app.settings.bandIdx), 0);
  await page.click('#band-list [data-cf="no"]');
  assert.equal(await page.evaluate(() => [VJ.app.settings.bandIdx, VJ.app.show.state.songIdx].join()), '0,0');
  await page.click('#band-list .band-row[data-i="1"] .bn');
  await page.click('#band-list [data-cf="yes"]');
  await page.waitForFunction(() => VJ.app.settings.bandIdx === 1);
  // 本番中に追加：切り替えない。✎ で開き直すと入力した内容が入っている
  await page.keyboard.press('ArrowRight');
  await page.click('#band-add');
  await page.fill('#band-list [data-bf="bandName"]', 'Third Band');
  await page.fill('#band-list [data-bf="setlistText"]', 'X | 1\nY | 2\nZ | 3');
  await page.click('#band-list [data-act="edit-close"]');
  assert.equal(await page.evaluate(() => VJ.app.settings.bandIdx), 1);
  await page.click('#band-list .band-row[data-i="2"] [data-act="edit"]');
  assert.equal(await page.inputValue('#band-list [data-bf="bandName"]'), 'Third Band');
  await page.click('#band-list [data-act="edit-close"]');
  // 保存されて、再読み込みしても残る
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  assert.deepEqual(await page.evaluate(() => VJ.bands.list(VJ.app.settings).map((b) => [b.name, b.songs])), [['First Band', 2], ['Second Band', 1], ['Third Band', 3]]);
  assert.equal(await page.inputValue('#band'), 'Second Band');
  assert.deepEqual(errors, []);
  await page.close();
});

test('セットリストの表：曲の追加・曲名・シーン（見本画像から）・パレット・並べ替えが文字の欄と演出に反映される', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await page.fill('#setlist', 'Intro | 1\nOutro | 2');
  await page.waitForTimeout(400);
  await page.click('#setlist-preview button[data-act="add"]');
  await page.keyboard.type('Encore');
  await page.click('#setlist-preview button[data-act="pick"][data-i="2"]');
  await page.click('#setlist-preview .sl-picker button[data-scene="fireworks"]');
  await page.click('#setlist-preview .sl-picker button[data-scene="petals"]');
  await page.click('#setlist-preview .sl-picker button[data-act="done"]');
  await page.selectOption('#setlist-preview select[data-i="2"]', '6');
  await page.click('#setlist-preview button[data-act="up"][data-i="2"]');
  await page.uncheck('#setlist-preview input[data-f="showtitle"][data-i="0"]');
  await page.waitForTimeout(500);
  // 編集した曲の行だけ書き直す（編集していない「Outro」の行は書いたまま）
  assert.equal(await page.inputValue('#setlist'), '1. Intro | 1 |  | notitle\n2. Encore | s3,s8 | sakura\nOutro | 2');
  assert.deepEqual(await page.evaluate(() => VJ.app.show.setlist.songs.map((s) => [s.title, s.scenes, s.palette, s.notitle])),
    [['Intro', ['ripple'], null, true], ['Encore', ['fireworks', 'petals'], 6, false], ['Outro', ['tunnel'], null, false]]);
  // 文字の欄を書き換えると表も変わる
  await page.fill('#setlist', 'Only | 4');
  await page.waitForFunction(() => document.querySelectorAll('#setlist-preview .sl-song').length === 1);
  // 表で曲名を入力中に、スマホなどからバンドが切り替わっても、古い表で別のバンドのセットリストを書き換えない
  await page.evaluate(() => { const s = VJ.app.settings; VJ.bands.add(s, 'Other'); s.bands[1].setlistText = 'P | 1\nQ | 2\nR | 3'; VJ.bandsUI.render(); });
  await page.click('#setlist-preview input[data-f="title"][data-i="0"]');
  await page.evaluate(() => VJ.bandsUI.switchTo(1));
  await page.keyboard.type('XYZ');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => VJ.app.settings.setlistText), 'P | 1\nQ | 2\nR | 3');
  assert.equal(await page.evaluate(() => VJ.app.settings.bands[0].setlistText), 'Only | 4');
  assert.deepEqual(errors, []);
  await page.close();
});

test('サウンドチェック：静か → 演奏を測って結果とおすすめを出し、「おすすめの設定にする」で設定が変わる', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  // 音声入力がまだのときは案内
  await page.click('#btn-sc');
  assert.match(await page.textContent('#toast'), /音声入力を開始/);
  await startDemo(page);
  await page.evaluate(() => { VJ.soundcheckUI.cfg = { quiet: 1.5, music: 6, musicMin: 1 }; VJ.app.settings.profile = 'calm'; });
  await page.click('#btn-sc');
  await page.waitForSelector('#sc-box .sc-items', { timeout: 30000 });
  const text = await page.textContent('#sc-box');
  assert.match(text, /音の大きさ OK/);
  assert.match(text, /音楽のタイプは「/, 'calm 以外がすすめられる');
  await page.click('#sc-apply');
  assert.notEqual(await page.evaluate(() => VJ.app.settings.profile), 'calm');
  assert.equal(await page.evaluate(() => VJ.soundcheckUI.last && typeof VJ.soundcheckUI.last.worst), 'string');
  assert.deepEqual(errors, []);
  await page.close();
});

test('はじめてのガイドと本番前チェック：手順が自動で進み、閉じても ? で開ける。本番前チェックに要対応・注意が出る', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await page.evaluate(() => { VJ.app.settings.guide = true; VJ.guide.render(); });
  assert.equal(await page.locator('#guide li').count(), 5);
  await page.click('#btn-precheck');
  await page.waitForFunction(() => /要対応/.test(document.getElementById('precheck').textContent));
  assert.match(await page.textContent('#precheck'), /音声入力が始まっていません/);
  await startDemo(page);
  await page.waitForFunction(() => document.querySelector('#guide li:nth-child(1)').classList.contains('done'));
  await page.waitForFunction(() => !/音声入力が始まっていません/.test(document.getElementById('precheck').textContent));
  assert.ok(await page.evaluate(() => document.querySelector('#guide li:nth-child(5)').classList.contains('done')), '本番前チェックを開いた');
  await page.click('#guide-close');
  assert.equal(await page.isVisible('#guide'), false);
  assert.equal(await page.evaluate(() => VJ.app.settings.guide), false);
  await page.click('#btn-guide');
  assert.equal(await page.isVisible('#guide'), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('パネルの折りたたみ：見出しを押すと開閉・再読み込みしても残る・すべて開く / 閉じる・ガイドから飛ぶと開く。Space はフラッシュのまま', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  const sec = (n) => `#panel .psec[data-sec="${n}"]`;
  assert.equal(await page.locator('#panel .psec').count(), 7);
  assert.ok(await page.isVisible('#setlist'));
  await page.click(`${sec(3)} .psec-btn`);
  assert.equal(await page.isVisible('#setlist'), false);
  assert.equal(await page.getAttribute(`${sec(3)} .psec-btn`, 'aria-expanded'), 'false');
  assert.ok(await page.isVisible(`${sec(3)} h2`), '見出しは見えたまま');
  // マウスで押した見出しにはフォーカスが残らず、Space はフラッシュになる
  await page.waitForTimeout(50);
  await page.evaluate(() => { const orig = VJ.app.show.flash.bind(VJ.app.show); window.__fl = []; VJ.app.show.flash = (k, src) => { window.__fl.push(src); return orig(k, src); }; });
  await page.keyboard.press('Space');
  assert.deepEqual(await page.evaluate(() => window.__fl), ['key'], 'Space でフラッシュ');
  assert.equal(await page.isVisible('#setlist'), false, 'Space で見出しが開かない');
  await page.waitForTimeout(400); // 保存（0.3 秒後）
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  assert.equal(await page.isVisible('#setlist'), false, '再読み込みしても閉じたまま');
  assert.ok(await page.isVisible('#btn-start'));
  await page.click('#psec-close-all');
  for (const id of ['#btn-start', '#opt-profile', '#out-size', '#opt-flashlimit', '#btn-show', '#net-on']) assert.equal(await page.isVisible(id), false, id);
  // ガイドの手順を押すと、その見出しが開く
  await page.evaluate(() => { VJ.app.settings.guide = true; VJ.guide.render(); });
  await page.click('#guide li[data-sec="6"]');
  assert.ok(await page.isVisible('#btn-show'));
  assert.equal(await page.isVisible('#btn-start'), false);
  await page.click('#psec-open-all');
  for (const id of ['#btn-start', '#setlist', '#opt-flashlimit', '#net-on']) assert.ok(await page.isVisible(id), id);
  assert.deepEqual(await page.evaluate(() => VJ.app.settings.panelFold), {});
  assert.deepEqual(errors, []);
  await page.close();
});

test('フラッシュの上限：推奨を超えると警告（パネル・本番前チェック）。照明のチェイスも同じ上限。激しさは保存される', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1280, height: 900 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  assert.equal(await page.inputValue('#opt-flashlimit'), '3');
  assert.equal(await page.inputValue('#opt-intensity'), '2');
  assert.equal(await page.isVisible('#flashlimit-warn'), false);
  await page.selectOption('#opt-flashlimit', '6');
  assert.ok(await page.isVisible('#flashlimit-warn'));
  assert.equal(await page.evaluate(() => VJ.app.show.limiter.cfg.maxPerSec), 6);
  assert.ok(Math.abs(await page.evaluate(() => VJ.app.show.limiter.gap()) - 1 / 6) < 1e-9, '照明のチェイスの間隔');
  await page.click('#btn-precheck');
  await page.waitForFunction(() => /1 秒に 6 回/.test(document.getElementById('precheck').textContent));
  assert.match(await page.textContent('#precheck'), /推奨は 3 回まで/);
  await page.selectOption('#opt-flashlimit', '0');
  assert.equal(await page.evaluate(() => VJ.app.show.limiter.cfg.maxPerSec), Infinity, '制限なし');
  await page.waitForFunction(() => /制限なし/.test(document.getElementById('precheck').textContent));
  // フラッシュを一切使わないなら、上限は選べず警告も出ない
  await page.check('#opt-noflash');
  assert.ok(await page.isDisabled('#opt-flashlimit'));
  assert.equal(await page.isVisible('#flashlimit-warn'), false);
  await page.uncheck('#opt-noflash');
  await page.selectOption('#opt-flashlimit', '3');
  assert.equal(await page.isVisible('#flashlimit-warn'), false);
  await page.selectOption('#opt-intensity', '3');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  assert.equal(await page.inputValue('#opt-intensity'), '3');
  assert.equal(await page.evaluate(() => VJ.app.show.switchK()), 0.5);
  assert.deepEqual(errors, []);
  await page.close();
});

test('2 画面：操作ウィンドウに出力の映像が小さく出る。プレビューを切ると送らない', async () => {
  const { page: ctrl, errors } = await openApp(browser, DIST, 'test=1', { width: 1100, height: 800 });
  const [out] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.link.role === 'output', null, { timeout: 30000 });
  await ctrl.waitForFunction(() => /^data:image\/jpeg;base64,/.test(document.getElementById('remote-preview').src || ''), null, { timeout: 15000 });
  await ctrl.uncheck('#remote-preview-on');
  await out.waitForFunction(() => VJ.link.wantPreview === false);
  assert.equal(await ctrl.isVisible('#remote-preview'), false);
  await ctrl.check('#remote-preview-on');
  await out.waitForFunction(() => VJ.link.wantPreview === true);
  // 本番前チェックは 2 画面でも動く（名前の無いバンドでも）
  await ctrl.click('#btn-precheck');
  await ctrl.waitForFunction(() => /出演/.test(document.getElementById('precheck').textContent));
  // 出演中でないバンドをその場で編集すると、出力側にも届く（タイトルの「次は ○○」・スマホのため）
  await ctrl.click('#band-add');
  await ctrl.fill('#band-list [data-bf="bandName"]', 'Out Band');
  await ctrl.click('#band-list [data-act="edit-close"]');
  await out.waitForFunction(() => VJ.app.settings.bands.length === 2 && VJ.bands.nameOf(VJ.app.settings, 1) === 'Out Band', null, { timeout: 5000 });
  await out.evaluate(() => { VJ.bandsUI.step(1); });
  await ctrl.waitForFunction(() => VJ.app.settings.bandIdx === 1 && document.getElementById('band').value === 'Out Band');
  await out.waitForFunction(() => VJ.app.show.bandName() === 'Out Band');
  await out.close();
  await ctrl.waitForFunction(() => VJ.link.role === 'solo', null, { timeout: 10000 });
  assert.deepEqual(errors, []);
  await ctrl.close();
});

test('英語：新しい部品（ガイド・出演バンド・セットリストの表・サウンドチェック・本番前チェック）に日本語が残らない', async () => {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + DIST + '?test=1');
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  await page.evaluate(() => { VJ.app.settings.guide = true; VJ.guide.render(); });
  await page.click('#band-add');
  await page.fill('#setlist', 'Song A | 1,s3 | neon\nSong B');
  await startDemo(page);
  await page.evaluate(() => { VJ.soundcheckUI.cfg = { quiet: 1, music: 3, musicMin: 1 }; });
  await page.click('#btn-sc');
  await page.waitForSelector('#sc-box .sc-items', { timeout: 30000 });
  await page.click('#btn-precheck');
  await page.click('#setlist-preview button[data-act="pick"][data-i="0"]');
  await page.waitForTimeout(800);
  const left = await page.evaluate(() => {
    const JP = /[぀-ヿ㐀-鿿！-｠]/;
    const out = [];
    for (const id of ['guide', 'band-list', 'setlist-preview', 'sc-box', 'precheck', 'scene-grid', 'panel']) {
      const w = document.createTreeWalker(document.getElementById(id), NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (JP.test(n.nodeValue) && !n.parentElement.closest('[data-i18n-skip]')) out.push(id + ': ' + n.nodeValue.trim());
    }
    return out;
  });
  assert.deepEqual(left, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});
