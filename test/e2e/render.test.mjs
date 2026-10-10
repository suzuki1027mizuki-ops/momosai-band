// 描画まわりの E2E：配布用 dist/momosai-vj.html を file:// で開いて検証する。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, DIST, saveDataUrl } from '../helpers/browser.mjs';
import { regionFlashes } from '../helpers/flash.mjs';

let browser, page, errors;
const SCENES = ['title', 'ripple', 'tunnel', 'horizon', 'aurora', 'kaleido', 'glitch', 'eq', 'stars', 'scope',
  'orb', 'melody', 'fireworks', 'bokeh', 'waves', 'smoke', 'circle', 'petals', 'voiceprint'];
const BAND = { bpm: 140, seed: 5, sections: [{ bars: 4, drums: '8beat', bass: true, guitar: 'chug' }, { bars: 1, drums: 'none', gain: 0 }, { bars: 8, drums: 'four', bass: true, guitar: 'chord', crash: true }, { bars: 4, drums: 'roll' }] };

before(async () => {
  browser = await launch();
  ({ page, errors } = await openApp(browser, DIST, 'test=1&scale=1&pr=1', { width: 192, height: 108 }));
});
after(async () => { await browser.close(); });

const run = (opts) => page.evaluate((o) => VJ.testing.runOffline(o).then((r) => ({ luma: r.luma, pngs: r.pngs, scenes: r.scenes, denied: r.denied })), opts);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

test('起動：エラーなし・全シーンのシェーダが通る・版数が埋め込まれている', async () => {
  const info = await page.evaluate(() => ({ r: VJ.app.renderer.info(), v: VJ.version, scenes: VJ.scenes.list.map((s) => s.id), panel: !document.getElementById('panel').hidden }));
  assert.deepEqual(info.r.failed, []);
  assert.match(info.v, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(info.scenes.sort(), [...SCENES, 'test'].sort());
  assert.ok(info.panel);
  assert.deepEqual(errors, []);
});

test('各シーンが真っ黒でなく、シーン同士で見た目が違う（PNG を test/artifacts に保存）', async () => {
  const sig = {};
  for (const id of SCENES) {
    const r = await run({ samples: 'demo', seconds: 24, sceneId: id, settings: { auto: false, autoFlash: false }, grid: [8, 4], pngAt: [1300] });
    saveDataUrl(r.pngs[1300], `e2e-${id}.png`);
    const last = r.luma.slice(-200);
    const m = mean(last.map(mean));
    assert.ok(m > 0.003, `${id} too dark: ${m}`);
    sig[id] = r.luma[1300];
    assert.ok(r.scenes.every((s) => s === id), `${id} switched unexpectedly`);
  }
  for (let i = 0; i < SCENES.length; i++) {
    for (let j = i + 1; j < SCENES.length; j++) {
      const a = sig[SCENES[i]], b = sig[SCENES[j]];
      const d = mean(a.map((v, k) => Math.abs(v - b[k])));
      assert.ok(d > 0.002, `${SCENES[i]} vs ${SCENES[j]} too similar: ${d}`);
    }
  }
});

test('反応：無音のあとキックが来ると明るくなり、その後減衰する（波紋）', async () => {
  const r = await run({ song: { bpm: 120, seed: 1, humanize: 0, lead: 2.0, sections: [{ bars: 2, drums: 'click' }] }, seconds: 3.5, sceneId: 'ripple', settings: { auto: false, autoFlash: false }, grid: [1, 1] });
  const L = r.luma.map((f) => f[0]);
  const quiet = Math.max(...L.slice(60, 115));
  const hitFrame = Math.round(2.0 * 60);
  const peak = Math.max(...L.slice(hitFrame, hitFrame + 12));
  assert.ok(peak > quiet * 3 && peak - quiet > 0.004, `quiet ${quiet} peak ${peak}`);
  // ヒット直後（2 フレーム以内）に変化が始まる
  const early = Math.max(...L.slice(hitFrame, hitFrame + 3));
  assert.ok(early > quiet * 1.5, `early ${early} vs quiet ${quiet}`);
});

test('暗転（B）で真っ黒になる・フラッシュは連打しても 1 秒に 3 回まで', async () => {
  const actions = {};
  actions[30] = [['setBlackout', true]];
  const r = await run({ samples: 'demo', seconds: 3, sceneId: 'horizon', settings: { auto: false, autoFlash: false }, grid: [1, 1], actions });
  const L = r.luma.map((f) => f[0]);
  assert.ok(L[20] > 0.02, 'visible before blackout ' + L[20]);
  assert.ok(L[30 + 35] < 0.002, 'black after fade ' + L[65]);

  const a2 = {};
  for (let i = 0; i < 10; i++) a2[60 + i * 6] = [['flash', 0.85, 'key']];
  const r2 = await run({ samples: 'demo', seconds: 3, sceneId: 'ripple', settings: { auto: false, autoFlash: false }, grid: [1, 1], actions: a2 });
  assert.equal(r2.denied, 7);
  const rf = regionFlashes(r2.luma, 60);
  assert.ok(Math.max(...rf) <= 3, 'flashes ' + rf);
});

test('光過敏：全シーン × 自動フラッシュ ON・140BPM で、どの領域も 1 秒に 3 フラッシュ以下', async () => {
  for (const id of SCENES) {
    const r = await run({ song: BAND, seconds: 30, sceneId: id, settings: { auto: false, autoFlash: true }, grid: [4, 3] });
    const rf = regionFlashes(r.luma, 60);
    assert.ok(Math.max(...rf) <= 3, `${id}: ${rf.join(' ')}`);
  }
});

test('光過敏：激しさ「最大」（寄る・揺れる・拍ごとのフラッシュ）でも、フラッシュの上限が既定なら全シーンで 1 秒に 3 フラッシュ以下', async () => {
  for (const id of SCENES) {
    const r = await run({ song: BAND, seconds: 16, sceneId: id, settings: { auto: false, autoFlash: true, intensity: 3 }, grid: [4, 3] });
    const rf = regionFlashes(r.luma, 60);
    assert.ok(Math.max(...rf) <= 3, `${id}: ${rf.join(' ')}`);
  }
});

test('光過敏：オーバーレイでシーンを重ねても（激しいシーンどうし・濃さ 100%）、どの領域も 1 秒に 3 フラッシュ以下', async () => {
  // 重ねる強さに上限が無いと、トンネル + 万華鏡・グリッチ + 万華鏡で 3.5 回になる（実測）
  const ov = (scene, sceneBlend) => ({ image: '', imageFit: 'contain', imageBlend: 'normal', imageOpacity: 1, scene, sceneBlend, sceneOpacity: 1, clock: false, band: false, song: false, text: '', corner: 'tr', textSize: 1, textOpacity: 0.9 });
  for (const [id, scene, blend] of [['tunnel', 'kaleido', 'add'], ['glitch', 'kaleido', 'screen'], ['kaleido', 'glitch', 'add']]) {
    const r = await run({ song: BAND, seconds: 30, sceneId: id, settings: { auto: false, autoFlash: true, overlayOn: true, overlay: ov(scene, blend) }, grid: [4, 3] });
    const rf = regionFlashes(r.luma, 60);
    assert.ok(Math.max(...rf) <= 3, `${id} + ${scene}: ${rf.join(' ')}`);
  }
});

test('激しさ：キックで画面が寄る（同じ音・同じ動きの大きさでも「ふつう」と「激しい」で絵が変わる）', async () => {
  const song = { bpm: 120, seed: 1, humanize: 0, lead: 1.0, sections: [{ bars: 2, drums: 'click' }] };
  // 動きの大きさ（react × 激しさの倍率）はそろえて、寄り・揺れ・色ずれだけを比べる
  const a = await run({ song, seconds: 1.3, sceneId: 'horizon', settings: { auto: false, autoFlash: false, intensity: 1, react: 0.8 }, grid: [8, 6] });
  const b = await run({ song, seconds: 1.3, sceneId: 'horizon', settings: { auto: false, autoFlash: false, intensity: 2, react: 0.64 }, grid: [8, 6] });
  const diff = (k) => mean(a.luma[k].map((v, i) => Math.abs(v - b.luma[k][i])));
  assert.ok(diff(55) < 1e-4, 'キックの前は同じ ' + diff(55));
  const hit = Math.max(diff(60), diff(61), diff(62));
  assert.ok(hit > 0.003, 'キックの直後は寄った分だけ違う ' + hit);
});

test('シーンの切り替え：どの種類（ワイプ・円・ブラインド・ズーム・スライド・グリッチ・モザイク）でも、続けて切り替えて 1 秒に 3 フラッシュ以下。途中は 2 つのシーンが混ざる', async () => {
  const types = await page.evaluate(() => VJ.ShowController.TRANSITIONS);
  assert.deepEqual(types, ['fade', 'wipe', 'iris', 'blinds', 'zoom', 'slide', 'glitch', 'mosaic']);
  const order = ['aurora', 'tunnel', 'bokeh', 'eq', 'waves', 'glitch', 'kaleido', 'horizon'];
  for (const type of types) {
    const actions = {};
    for (let i = 0; i < 8; i++) actions[30 + i * 40] = [['selectScene', order[i], { immediate: true }]];
    const r = await run({ samples: 'demo', seconds: 6, sceneId: 'ripple', settings: { auto: false, autoFlash: true, crossfade: 0.5, transition: type }, grid: [4, 3], actions, pngAt: [30 + 40 * 3 + 15] });
    const rf = regionFlashes(r.luma, 60);
    assert.ok(Math.max(...rf) <= 3, `${type}: ${rf.join(' ')}`);
    saveDataUrl(r.pngs[30 + 40 * 3 + 15], `e2e-transition-${type}.png`);
  }
});

test('光過敏：オートモードでシーンが切り替わっても基準内', async () => {
  const r = await run({ samples: 'demo', seconds: 70, sceneId: 'ripple', settings: { auto: true, autoFlash: true, setlistText: '' }, grid: [4, 3] });
  const rf = regionFlashes(r.luma, 60);
  assert.ok(Math.max(...rf) <= 3, rf.join(' '));
  assert.ok(new Set(r.scenes).size >= 2, 'auto switched: ' + [...new Set(r.scenes)].join(','));
});

test('WebGL コンテキストが失われても復旧して描画を続ける', async () => {
  const ok = await page.evaluate(async () => {
    const gl = VJ.app.renderer.gl;
    const ext = gl.getExtension('WEBGL_lose_context');
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    const lostSeen = VJ.app.renderer.lost;
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 1500));
    const f0 = VJ.app.renderer.frame;
    await new Promise((r) => setTimeout(r, 500));
    return { lostSeen, lost: VJ.app.renderer.lost, advanced: VJ.app.renderer.frame - f0, failed: VJ.app.renderer.info().failed };
  });
  assert.equal(ok.lostSeen, true);
  assert.equal(ok.lost, false);
  assert.ok(ok.advanced > 0, 'frames advanced ' + ok.advanced);
  assert.deepEqual(ok.failed, []);
});

test('シェーダが壊れたシーンは飛ばされ、他は動く（?forceShaderFail=glitch）', async () => {
  const p2 = await openApp(browser, DIST, 'test=1&forceShaderFail=glitch', { width: 160, height: 90 });
  const r = await p2.page.evaluate(() => {
    const before = VJ.app.show.state.sceneId;
    VJ.app.show.selectScene('glitch', { immediate: true });
    return { failed: VJ.app.renderer.info().failed, before, after: VJ.app.show.state.sceneId, ok: VJ.app.renderer.available('tunnel') };
  });
  assert.deepEqual(r.failed, ['glitch']);
  assert.equal(r.after, r.before);
  assert.ok(r.ok);
  await p2.page.close();
});
