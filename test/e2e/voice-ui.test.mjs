// 声・MC・クロスフェード・シーンの調整・MIDI の学習（画面）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, DIST, saveDataUrl } from '../helpers/browser.mjs';
import { regionFlashes } from '../helpers/flash.mjs';

let browser, page, errors;
before(async () => {
  browser = await launch();
  ({ page, errors } = await openApp(browser, DIST, 'test=1&scale=1&pr=1', { width: 192, height: 108 }));
});
after(async () => { await browser.close(); });

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

test('MC：オート＋「MC のあいだはタイトル」で、話し声になるとタイトル、演奏に戻ると元のシーンへ', async () => {
  const scenes = await page.evaluate(() => {
    const sr = 48000;
    const band = VJ.synth.song({ sampleRate: sr, bpm: 120, seed: 2, sections: [{ bars: 6, drums: '8beat', bass: true, guitar: 'chord' }] }).samples;
    const sp = VJ.voiceSynth.speak({ sr, sec: 12, seed: 3 }).samples;
    const x = new Float32Array(band.length * 2 + sp.length);
    x.set(band); x.set(sp, band.length); x.set(band, band.length + sp.length);
    return VJ.testing.runOffline({ samples: x, sceneId: 'ripple', settings: { auto: true, speechTitle: true, autoFlash: true, setlistText: '', profile: 'auto' } })
      .then((r) => ({ scenes: r.scenes, bandSec: band.length / sr, spSec: sp.length / sr }));
  });
  const at = (sec) => scenes.scenes[Math.min(scenes.scenes.length - 1, Math.round(sec * 60))];
  assert.notEqual(at(scenes.bandSec - 0.5), 'title', '演奏中はタイトルにならない');
  assert.equal(at(scenes.bandSec + scenes.spSec - 1), 'title', '話し声のあいだはタイトル');
  assert.notEqual(at(scenes.bandSec * 2 + scenes.spSec - 0.2), 'title', '演奏に戻るとシーンに戻る');
});

test('クロスフェード：切替の途中は 2 つのシーンが混ざり、急な明るさの変化にならない', async () => {
  const actions = {};
  for (let i = 0; i < 6; i++) actions[60 + i * 50] = [['selectScene', ['aurora', 'tunnel', 'bokeh', 'circle', 'waves', 'glitch'][i], { immediate: true }]];
  const r = await page.evaluate((a) => VJ.testing.runOffline({ samples: 'demo', seconds: 7, sceneId: 'ripple', settings: { auto: false, autoFlash: true, crossfade: 1 }, grid: [4, 3], actions: a, pngAt: [85] }), actions);
  saveDataUrl(r.pngs[85], 'e2e-crossfade.png');
  const rf = regionFlashes(r.luma, 60);
  assert.ok(Math.max(...rf) <= 3, rf.join(' '));
  // 全体の明るさの 1 フレームの変化は小さい（カットなら大きく跳ねる）
  const L = r.luma.map(mean);
  let maxJump = 0;
  for (let i = 61; i < L.length; i++) maxJump = Math.max(maxJump, Math.abs(L[i] - L[i - 1]));
  assert.ok(maxJump < 0.05, 'max jump ' + maxJump);
});

test('シーンの調整：値で描画が変わり、パネルのスライダーで設定に保存される', async () => {
  const lum = (params) => page.evaluate((p) => VJ.testing.runOffline({ samples: 'demo', seconds: 6, sceneId: 'eq', settings: { auto: false, autoFlash: false, sceneParams: { eq: p } }, grid: [4, 3] })
    .then((r) => r.luma.slice(-120).map((f) => f.reduce((a, b) => a + b, 0) / f.length)), params);
  const lo = mean(await lum([0.5, 0.5])), hi = mean(await lum([1.5, 1.15]));
  assert.ok(hi > lo * 1.3, `low ${lo} high ${hi}`);
  // パネル
  const p2 = await openApp(browser, DIST, '', { width: 1280, height: 900 });
  await p2.page.evaluate(() => { document.getElementById('scene-adjust').open = true; VJ.app.show.selectScene('eq', { immediate: true }); });
  await p2.page.waitForFunction(() => document.getElementById('sp-scene').value === 'eq' && document.querySelectorAll('#sp-params input').length === 2);
  await p2.page.evaluate(() => { const i = document.querySelector('#sp-params input[data-i="1"]'); i.value = '0.6'; i.dispatchEvent(new Event('input')); });
  assert.deepEqual(await p2.page.evaluate(() => VJ.app.settings.sceneParams.eq), [1, 0.6]);
  await p2.page.click('#sp-reset');
  assert.equal(await p2.page.evaluate(() => VJ.app.settings.sceneParams.eq), undefined);
  // MIDI の学習（画面）：学習を押してから来たメッセージが割り当てになる
  await p2.page.evaluate(() => { document.querySelectorAll('details').forEach((d) => (d.open = true)); VJ.panel.renderMidiMap(); VJ.midi.access = VJ.midi.access || {}; });
  await p2.page.evaluate(() => { VJ.panel.enableMidi = async () => true; });
  await p2.page.click('#midi-map button[data-act="scene:orb"]');
  await p2.page.waitForFunction(() => document.querySelector('#midi-map button[data-act="scene:orb"]').classList.contains('wait'));
  await p2.page.evaluate(() => VJ.midi.handle(VJ.app.show, [0x90, 60, 100], VJ.app.settings));
  await p2.page.waitForFunction(() => /ノート 60/.test(document.getElementById('midi-map').textContent));
  await p2.page.evaluate(() => VJ.midi.handle(VJ.app.show, [0x90, 60, 100], VJ.app.settings));
  assert.equal(await p2.page.evaluate(() => VJ.app.show.state.sceneId), 'orb');
  assert.deepEqual(p2.errors, []);
  await p2.page.close();
});

test('声のシーン：歌・話し声に反応して動き、声の輪の中央にバンド名が出る', async () => {
  for (const id of ['orb', 'melody', 'voiceprint']) {
    const quiet = await page.evaluate((s) => VJ.testing.runOffline({ samples: new Float32Array(48000 * 3), sceneId: s, settings: { auto: false } , grid: [4, 3] }).then((r) => r.luma.slice(-60)), id);
    const sing = await page.evaluate((s) => VJ.testing.runOffline({ samples: 'demo-sing', seconds: 8, sceneId: s, settings: { auto: false }, grid: [4, 3] }).then((r) => r.luma.slice(-240)), id);
    const diff = mean(sing.map((f, i) => mean(f.map((v, k) => Math.abs(v - quiet[i % quiet.length][k])))));
    assert.ok(diff > 0.002, `${id} does not react: ${diff}`);
  }
  // バンド名の文字は「声の輪」にも渡る
  const hasTitle = await page.evaluate(() => {
    const show = new VJ.ShowController(Object.assign({}, VJ.app.settings, { auto: false }));
    show._applyScene('orb');
    const f = VJ.app.ensureExtractor().features;
    return !!show.frame(f, 1 / 60, VJ.app.getText).titleTex;
  });
  assert.ok(hasTitle);
  assert.deepEqual(errors, []);
});
