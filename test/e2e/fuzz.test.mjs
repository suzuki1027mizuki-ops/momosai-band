// ランダム操作（キー連打・設定変更・入力切替・画面サイズ変更）を続けても壊れないこと
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, DIST, FIXTURES } from '../helpers/browser.mjs';

let browser, page, errors;
before(async () => {
  browser = await launch({ wav: FIXTURES + '/drums.wav' });
  ({ page, errors } = await openApp(browser, DIST, 'test=1', { width: 320, height: 180 }));
});
after(async () => { await browser.close(); });

const KEYS = ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'ArrowRight', 'ArrowLeft',
  'Space', 'KeyB', 'KeyC', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyT', 'Enter', 'KeyQ', 'KeyW', 'KeyE', 'KeyG', 'KeyD', 'KeyH', 'KeyL', 'Escape', 'KeyS'];

test('ランダム操作 1500 回：例外なし・描画が続く・状態が壊れない', async () => {
  await page.evaluate(() => {
    VJ.app.settings.messages = ['テロップ1', 'テロップ2', ''];
    VJ.app.settings.setlistText = '@band FUZZ\nA | 1,2 | neon\nB | 4\nC | | fire | notitle\n@end END';
    VJ.app.applySettings();
  });
  await page.evaluate(() => VJ.app.startAudio({ source: 'demo', monitor: false }));
  let rnd = 12345;
  const r = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  for (let i = 0; i < 1500; i++) {
    const x = r();
    if (x < 0.75) {
      const k = KEYS[Math.floor(r() * KEYS.length)];
      if (r() < 0.2) await page.keyboard.down('Shift');
      await page.keyboard.press(k);
      await page.keyboard.up('Shift');
    } else if (x < 0.9) {
      await page.evaluate((v) => {
        const s = VJ.app.settings;
        const pick = (a) => a[Math.floor(v * 997) % a.length];
        const k = Math.floor(v * 13);
        if (k === 0) s.profile = pick(VJ.profiles.map((p) => p.id));
        else if (k === 1) s.react = 0.3 + v * 1.2;
        else if (k === 2) s.output = { rotate: pick([0, 90, 180, 270]), flipH: v > 0.5, flipV: v > 0.8, size: 0.3 + v * 0.7, x: v - 0.5, y: 0.5 - v };
        else if (k === 3) s.noFlash = v > 0.5;
        else if (k === 4) s.fpsCap = v > 0.5 ? 30 : 0;
        else if (k === 5) s.gateDb = -80 + v * 50;
        else if (k === 6) s.paletteIdx = Math.floor(v * 8);
        else if (k === 7) s.autoScenes = { ripple: v > 0.5, glitch: false };
        else if (k === 8) s.logoMode = pick(['title', 'corner', 'both', 'off']);
        else if (k === 9) s.countdownTo = '23:59';
        else if (k === 10) s.setlistText = v > 0.5 ? '' : '1 | 9\n2 | 7,8';
        else if (k === 11) s.master = 0.2 + v * 0.8;
        else s.auto = v > 0.3;
        VJ.app.applySettings();
      }, r());
    } else if (x < 0.95) {
      await page.setViewportSize({ width: 200 + Math.floor(r() * 300), height: 120 + Math.floor(r() * 200) });
    } else if (x < 0.98) {
      await page.evaluate(() => VJ.app.startAudio({ source: Math.random() < 0.5 ? 'demo' : 'mic', monitor: false }).catch(() => {}));
    } else {
      await page.waitForTimeout(150);
    }
  }
  // L のロックが掛かっていたら解除
  await page.keyboard.down('KeyL'); await page.waitForTimeout(1700); await page.keyboard.up('KeyL');
  await page.waitForTimeout(500);
  const st = await page.evaluate(async () => {
    const f0 = VJ.app.renderer.frame, n0 = VJ.app.frameNo;
    await new Promise((res) => setTimeout(res, 1000));
    const f = VJ.app.lastFeatures;
    const nums = ['level', 'low', 'mid', 'high', 'kick', 'snare', 'hat', 'accent', 'intensity', 'centroid', 'bpm', 'beatPhase', 'beatConf', 'barPhase'];
    const bad = nums.filter((k) => !Number.isFinite(f[k]));
    const s = VJ.app.show.state;
    return { renders: VJ.app.renderer.frame - f0, frames: VJ.app.frameNo - n0, errors: VJ.app.errors, bad, scene: s.sceneId, black: s.black, flash: s.flash, master: s.master, lost: VJ.app.renderer.lost, status: VJ.app.engine.status };
  });
  console.log('fuzz', JSON.stringify(st));
  assert.equal(st.errors, 0, 'frame errors');
  assert.deepEqual(st.bad, []);
  assert.ok(st.frames > 5, 'loop alive');
  assert.ok(Number.isFinite(st.black) && Number.isFinite(st.flash) && st.master >= 0.2 && st.master <= 1);
  assert.equal(st.lost, false);
  assert.deepEqual(errors, []);
});
