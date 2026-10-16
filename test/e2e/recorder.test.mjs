// 本番の記録（src/show/recorder.js）：デモ音源で動かして ⑥ から CSV を書き出す。再読み込みしても今日の記録が残る。2 画面でも書き出せる
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, openApp, DIST } from '../helpers/browser.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

/** ⑥ の「本番の記録を書き出す」で保存された CSV の行（見出しを除く） */
async function exportCsv(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-log')]);
  assert.match(dl.suggestedFilename(), /^momosai-vj-log-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  assert.ok(text.startsWith('﻿時刻,入力,'), '見出しつき（BOM 付き）');
  return text.trim().split('\r\n').slice(1);
}

test('本番の記録：1 秒ごとの行と出来事（暗転など）を CSV で書き出す。再読み込みしても今日の記録は残る', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1000, height: 700 });
  await page.evaluate(() => new Promise((res) => { const rq = indexedDB.deleteDatabase('momosai-vj-log'); rq.onsuccess = rq.onerror = rq.onblocked = () => res(); }));
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  await page.check('input[name=src][value=demo]');
  await page.uncheck('#monitor');
  await page.click('#btn-start');
  await page.waitForFunction(() => VJ.app.engine.running, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { VJ.app.show.toggleBlackout(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { VJ.app.show.toggleBlackout(); });
  await page.waitForTimeout(2500);
  const rows = await exportCsv(page);
  assert.ok(rows.length >= 5, `行 ${rows.length}`);
  assert.ok(rows.some((r) => /,demo/.test(r)), '入力が記録される');
  assert.ok(rows.some((r) => /暗転/.test(r)), '出来事（暗転）が記録される');
  const fps = rows.slice(1, -1).map((r) => +r.split(',')[12]).filter((x) => x > 0);
  assert.ok(fps.length >= 2, '描画の fps が入る（重い PC では小さいこともあるので、値が入っていることだけ確かめる）');
  assert.match(await page.textContent('#log-status'), /行を書き出しました/);
  // 再読み込み：保存した分は残る（入力を始めなくても、書き出せる）
  await page.reload();
  await page.waitForFunction(() => window.VJ && VJ.app && VJ.panel.app);
  const again = await exportCsv(page);
  assert.ok(again.length >= rows.length - 1, `再読み込みのあと ${again.length} / 前 ${rows.length}`);
  assert.ok(again.some((r) => /暗転/.test(r)));
  assert.deepEqual(errors, []);
  await page.close();
});

test('本番の記録：2 画面のときは、記録している出力ウィンドウに頼んで、操作ウィンドウから書き出す', async () => {
  const { page: ctrl, errors } = await openApp(browser, DIST, 'test=1', { width: 1000, height: 700 });
  const [out] = await Promise.all([ctrl.context().waitForEvent('page'), ctrl.click('#btn-output')]);
  await out.waitForFunction(() => window.VJ && VJ.app && VJ.link.role === 'output', null, { timeout: 30000 });
  await ctrl.waitForFunction(() => VJ.link.lastStatus, null, { timeout: 15000 });
  await ctrl.evaluate(() => VJ.app.startAudio({ source: 'demo', monitor: false }));
  await out.waitForFunction(() => VJ.app.engine.status === 'running', null, { timeout: 15000 });
  await ctrl.evaluate(() => { VJ.app.show.nextSong(); });
  await out.waitForTimeout(3000);
  const rows = await exportCsv(ctrl);
  assert.ok(rows.some((r) => /,demo/.test(r)), '出力ウィンドウの記録が届く');
  assert.ok(rows.length >= 3);
  await out.close();
  await ctrl.close();
  assert.deepEqual(errors, []);
});

test('起動時の自己診断：画面のリフレッシュレートが 60Hz 未満・Chrome が古いと、本番前チェックに注意が出る', async () => {
  const { page, errors } = await openApp(browser, DIST, 'test=1', { width: 1000, height: 700 });
  const check = async () => { await page.evaluate(() => VJ.guide.renderPrecheck()); return page.textContent('#precheck'); };
  await page.evaluate(() => { document.getElementById('precheck').hidden = false; });
  // ふだん（ヘッドレスは 60Hz）：出ない
  assert.doesNotMatch(await check(), /リフレッシュレート|が古いです/);
  // 30Hz のディスプレイ・古い Chrome のふり
  // 描画は 60 フレームごとに見積もり直すので、書き換えと本番前チェックを同じ瞬間に
  await page.evaluate(() => { VJ.app.renderer.vsync = 33.3; VJ.compat.chromeVersion = 100; VJ.guide.renderPrecheck(); });
  const txt = await page.textContent('#precheck');
  assert.match(txt, /リフレッシュレートが 30Hz くらい/);
  assert.match(txt, /Chrome \/ Edge が古いです（100）。116 以降/);
  assert.deepEqual(errors, []);
  await page.close();
});
