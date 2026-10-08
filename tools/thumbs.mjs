// シーンの見本画像（パネル・スマホ・早見表・セットリストの表で使う）を作る：node tools/thumbs.mjs
//   dist をビルドして Chromium（swiftshader）で開き、各シーンをデモ音源で数秒描いた最後のフレームを
//   160×90 の WebP にして src/ui/thumbs.js（VJ.thumbs）に書き出す。シーンを追加・変更したら作り直す。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, openApp, DIST } from '../test/helpers/browser.mjs';
import { ROOT } from '../test/helpers/load-src.mjs';

const W = 160, H = 90;
// 声のシーンは歌で描く（バンド演奏だと見本として分かりにくい）
const VOICE = ['orb', 'melody', 'voiceprint'];
const SECONDS = 10;

execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs')], { stdio: 'inherit' });
const browser = await launch();
const { page, errors } = await openApp(browser, DIST, 'test=1&scale=1&pr=1', { width: W * 2, height: H * 2 });
const ids = await page.evaluate(() => VJ.scenes.list.filter((s) => !s.hidden).map((s) => s.id));
const out = {};
for (const id of ids) {
  const last = SECONDS * 60 - 1;
  const url = await page.evaluate(async ({ id, src, last, W, H }) => {
    const r = await VJ.testing.runOffline({ samples: src, seconds: 10, sceneId: id, settings: { auto: false, autoFlash: false, noFlash: true, paletteIdx: 0, logo: '' }, pngAt: [last] });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = r.pngs[last]; });
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, W, H);
    return c.toDataURL('image/webp', 0.6);
  }, { id, src: VOICE.includes(id) ? 'demo-sing' : 'demo', last, W, H });
  if (!url.startsWith('data:image/webp')) throw new Error(`${id}: WebP にできませんでした`);
  out[id] = url;
  console.log(`${id}: ${(url.length / 1024).toFixed(1)} KB`);
}
await browser.close();
if (errors.length) { console.error(errors); process.exit(1); }

const body = Object.entries(out).map(([id, url]) => `    ${id}: '${url}',`).join('\n');
const js = `/* シーンの見本画像（${W}×${H} WebP）。自動生成：node tools/thumbs.mjs（シーンを追加・変更したら作り直す） */
(function (VJ) {
  'use strict';
  VJ.thumbs = {
${body}
  };
})(globalThis.VJ = globalThis.VJ || {});
`;
fs.writeFileSync(path.join(ROOT, 'src/ui/thumbs.js'), js);
const kb = (Buffer.byteLength(js) / 1024).toFixed(0);
console.log(`wrote src/ui/thumbs.js (${ids.length} scenes, ${kb} KB)`);
