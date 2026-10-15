// 利用者が入れた文字（バンド名・曲名・メディアやキューの名前など）に HTML が入っていても、部品として動かず、
// 文字のまま表示される（src/ui/dom.js の html`…`）。設定ファイルを読み込むと、どれにも入りうる
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, DIST } from '../helpers/browser.mjs';

let browser, page, errors;
before(async () => {
  browser = await launch();
  ({ page, errors } = await openApp(browser, DIST, 'test=1', { width: 480, height: 270 }));
});
after(async () => { await browser.close(); });

const EVIL = '<img src=x onerror="window.__xss=1">"\'&<b>';

test('名前に HTML を入れても、一覧・セットリストの表・キュー・本番前チェックで部品にならない', async () => {
  await page.evaluate((evil) => {
    const s = VJ.app.settings;
    s.bandName = evil;
    s.setlistText = `@band ${evil}\n${evil} | 1 | | m:${evil}\n@end ${evil}`;
    s.bands = [{}, { bandName: evil, setlistText: `${evil} | 1` }];
    s.mediaLib = [{ id: 'Lx', name: evil, kind: 'image', key: 'k1' }];
    s.cues = [{ name: evil, scene: '', palette: -1, media: '', ovScene: '' }];
    VJ.panel.replaceSettings(s);
    for (const id of ['medialib-box', 'cue-edit-box']) document.getElementById(id).open = true;
    VJ.bandsUI.render();
    VJ.mediaLibUI.render(true);
    VJ.cuesUI.render(true);
    VJ.setlistEd.render(true);
    document.getElementById('btn-precheck').click();
  }, EVIL);
  await new Promise((r) => setTimeout(r, 300));
  const r = await page.evaluate(() => ({
    xss: window.__xss,
    imgs: document.querySelectorAll('[onerror], img[src=x]').length,
    bold: [...document.querySelectorAll('#panel b')].filter((b) => !b.textContent).length, // 名前の最後の <b> から空の b ができていない
    band: document.getElementById('band-list').textContent,
    cue: document.getElementById('cue-grid').textContent,
    ml: [...document.querySelectorAll('#ml-list input[data-f=name]')].map((i) => i.value),
    titles: [...document.querySelectorAll('[data-f=title]')].map((i) => i.value),
    precheck: document.getElementById('precheck').textContent,
  }));
  assert.equal(r.xss, undefined, 'onerror が動いていない');
  assert.equal(r.imgs, 0, '名前から img が作られていない');
  assert.equal(r.bold, 0, '名前から b が作られていない');
  assert.ok(r.band.includes('<img src=x'), '出演バンドの一覧に文字のまま出る');
  assert.ok(r.cue.includes('<img src=x'), 'キューのボタンに文字のまま出る');
  assert.deepEqual(r.ml, [EVIL], 'メディアの名前の欄に、そのままの値が入る');
  assert.ok(r.titles.includes(EVIL), 'セットリストの表の曲名の欄に、そのままの値が入る');
  assert.ok(r.precheck.length > 0, '本番前チェックが出る');
  assert.deepEqual(errors, []);
});
