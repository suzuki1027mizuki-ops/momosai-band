// シーン開発用のチェック：node tools/check-scenes.mjs [シーンID ...]（省略で全シーン）
//   1. dist をビルドして Chromium（swiftshader）で開く
//   2. シーンごとに、バンド演奏・歌・話し声で描いて PNG を test/artifacts/scene-<id>-<音>.png に保存
//   3. 光過敏チェック（自動フラッシュ ON・140BPM の激しい曲・4×3 領域）：1 秒 3 フラッシュ以下か
//   4. 真っ黒でないか、1 フレームの描画時間（目安）
// 終了コード：問題があれば 1
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { launch, openApp, DIST, saveDataUrl } from '../test/helpers/browser.mjs';
import { regionFlashes } from '../test/helpers/flash.mjs';
import { ROOT } from '../test/helpers/load-src.mjs';

execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs')], { stdio: 'inherit' });
const BAND = { bpm: 140, seed: 5, sections: [{ bars: 4, drums: '8beat', bass: true, guitar: 'chug' }, { bars: 1, drums: 'none', gain: 0 }, { bars: 8, drums: 'four', bass: true, guitar: 'chord', crash: true }, { bars: 4, drums: 'roll' }] };
const browser = await launch();
const { page, errors } = await openApp(browser, DIST, 'test=1&scale=1&pr=1', { width: 320, height: 180 });
const all = await page.evaluate(() => VJ.scenes.list.map((s) => s.id));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all;
const failed = await page.evaluate(() => VJ.app.renderer.info().failed);
let bad = 0;
if (failed.length) { console.log('シェーダのエラー:', failed); bad++; }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
for (const id of ids) {
  if (!all.includes(id)) { console.log(`${id}: 登録されていません`); bad++; continue; }
  const out = [];
  for (const [label, src] of [['band', { samples: 'demo', seconds: 24 }], ['sing', { samples: 'demo-sing', seconds: 24 }], ['speech', { samples: 'demo-speech', seconds: 24 }]]) {
    const t0 = Date.now();
    const r = await page.evaluate((o) => VJ.testing.runOffline(o).then((x) => ({ luma: x.luma, pngs: x.pngs })), Object.assign({ sceneId: id, settings: { auto: false, autoFlash: false }, grid: [4, 3], pngAt: [400, 1300] }, src));
    const ms = (Date.now() - t0) / r.luma.length;
    saveDataUrl(r.pngs[1300], `scene-${id}-${label}.png`);
    saveDataUrl(r.pngs[400], `scene-${id}-${label}-early.png`);
    const m = mean(r.luma.slice(-300).map(mean));
    out.push(`${label} 明るさ ${m.toFixed(3)} (${ms.toFixed(1)}ms/f)`);
    if (m < 0.003) { out.push('  ← 暗すぎ'); bad++; }
  }
  const r = await page.evaluate((o) => VJ.testing.runOffline(o).then((x) => ({ luma: x.luma })), { song: BAND, seconds: 30, sceneId: id, settings: { auto: false, autoFlash: true }, grid: [4, 3] });
  const rf = regionFlashes(r.luma, 60);
  const mx = Math.max(...rf);
  out.push(`光過敏 最大 ${mx}/秒${mx > 3 ? ' ← 基準超え' : ''}`);
  if (mx > 3) bad++;
  console.log(`${id}: ${out.join(' | ')}`);
}
if (errors.length) { console.log('コンソールのエラー:', errors.slice(0, 5)); bad++; }
await browser.close();
console.log(bad ? `問題 ${bad} 件` : 'OK');
process.exit(bad ? 1 : 0);
