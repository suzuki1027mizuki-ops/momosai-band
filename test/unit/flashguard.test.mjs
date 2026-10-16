// 重ねた映像の点滅の見張り（src/show/safety.js の FlashMeter・OverlayGuard）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ } from '../helpers/load-src.mjs';
import { regionFlashes } from '../helpers/flash.mjs';

const VJ = loadVJ();
const { FlashMeter, OverlayGuard } = VJ.safety;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('点滅の数え方：テスト（test/helpers/flash.mjs）と同じ判定を、時刻で区切って数える（いろいろな映像 40 通り）', () => {
  const FPS = 64; // 1/64 秒は 2 進数でちょうど表せる（時刻の比べ方で丸めの差が出ないように）
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed), N = 12, frames = 400;
    // 領域ごとに：止まる・ゆっくり変わる・ときどき跳ぶ・点滅する、をまぜる
    const kind = Array.from({ length: N }, () => Math.floor(r() * 4));
    const rate = Array.from({ length: N }, () => 2 + Math.floor(r() * 10));
    const luma = [];
    for (let i = 0; i < frames; i++) {
      luma.push(Array.from({ length: N }, (_, g) => {
        const k = kind[g];
        if (k === 0) return 0.3;
        if (k === 1) return 0.4 + 0.3 * Math.sin(i / 20 + g);
        if (k === 2) return r() < 0.05 ? r() : 0.2 + 0.05 * r();
        return Math.floor(i / rate[g]) % 2 ? 0.9 * r() + 0.1 : 0.05;
      }));
    }
    const want = Math.max(...regionFlashes(luma, FPS)) * 2;
    const m = new FlashMeter(N);
    let got = 0;
    luma.forEach((f, i) => { m.push(i / FPS, f); got = Math.max(got, m.transitions()); });
    assert.equal(got, want, `seed ${seed}`);
  }
});

/** 映像を流して、[最後の濃さの倍率, 状態, 最小の倍率] を返す。frame(i) は 12 領域の輝度 */
function run(guard, frame, seconds, alpha = 1, fps = 30) {
  let minG = 1;
  for (let i = 0; i < seconds * fps; i++) {
    guard.push(i / fps, frame(i), alpha);
    minG = Math.min(minG, guard.gain(1 / fps));
  }
  return [guard.g, guard.state(), minG];
}
const strobe = (hz, fps = 30) => (i) => new Array(12).fill(Math.floor((i * hz * 2) / fps) % 2 ? 0.9 : 0.05);
const steady = () => new Array(12).fill(0.4);

test('見張り：強い点滅（1 秒に 5 回）を重ねると、揺れ幅が判定の 10% を下回るまで濃さを下げ、落ち着いたら 2 秒かけて戻す', () => {
  const g = new OverlayGuard();
  const [gEnd, st, minG] = run(g, strobe(5), 2);
  assert.ok(minG <= 0.1 + 1e-9, `下げた倍率 ${minG}`);
  assert.equal(st, 'dim');
  assert.ok(gEnd * 0.85 < 0.1, '揺れ幅（0.85）× 倍率 が 10% 未満');
  assert.equal(g.alerts, 1);
  // 落ち着いた：1 秒たって数が減ってから、2 秒かけて戻る
  let t0 = 2;
  for (let i = 0; i < 30 * 1.2; i++) { g.push(t0 + i / 30, steady(), 1); g.gain(1 / 30); }
  t0 += 1.2;
  assert.ok(g.g < 0.9, 'すぐには戻さない');
  for (let i = 0; i < 30 * 2.2; i++) { g.push(t0 + i / 30, steady(), 1); g.gain(1 / 30); }
  assert.equal(g.g, 1);
  assert.equal(g.state(), '');
});

test('見張り：薄く重ねた映像（濃さ 0.1）・ゆっくり変わる映像・1 秒に 1 回の点滅では下げない', () => {
  assert.equal(run(new OverlayGuard(), strobe(5), 3, 0.1)[2], 1, '濃さを掛けると揺れは 0.085 で、点滅に数えない');
  assert.equal(run(new OverlayGuard(), (i) => new Array(12).fill(0.4 + 0.3 * Math.sin(i / 15)), 3)[2], 1, 'ゆっくり変わる');
  assert.equal(run(new OverlayGuard(), strobe(1), 3)[2], 1, '1 秒に 1 回（2 回の変化）は上限の手前');
});

test('見張り：上限 2 回なら 2 回の点滅で下げる。「一切使わない」ならより強く下げる。「制限なし」なら下げずに知らせるだけ', () => {
  const g2 = new OverlayGuard(); g2.setLimit(2, false);
  assert.ok(run(g2, strobe(2), 2)[2] < 1, '上限 2：1 秒に 2 回で下げる');
  const g3 = new OverlayGuard(); g3.setLimit(3, false);
  assert.equal(run(g3, strobe(1.5), 2)[2], 1, '上限 3：1 秒に 1.5 回では下げない');
  const gn = new OverlayGuard(); gn.setLimit(3, true);
  const [, , minN] = run(gn, strobe(5), 2);
  assert.ok(minN <= 0.05 + 1e-9, `一切使わない：${minN}`);
  const gu = new OverlayGuard(); gu.setLimit(0, false);
  const [gEnd, st, minU] = run(gu, strobe(5), 2);
  assert.deepEqual([gEnd, st, minU], [1, 'strong', 1]);
});
