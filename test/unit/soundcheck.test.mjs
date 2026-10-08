// サウンドチェック：音の大きさ・割れ・会場の雑音・音楽のタイプの見立て（合成音源で）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVJ } from '../helpers/load-src.mjs';

const VJ = loadVJ();
const SR = 48000;
const SC = VJ.soundcheck;

/** 描画フレームの刻み（800 サンプル）で解析して集計する。gain で大きさ、noise で雑音（一様乱数の振幅）を変える */
function measure(x, { gain = 1, noise = 0, seed = 1 } = {}) {
  const fx = new VJ.dsp.FeatureExtractor({ sampleRate: SR, config: VJ.makeDspConfig({ profile: 'auto', gateDb: -70 }) });
  const acc = new SC.SoundCheckAcc();
  const latest = new Float32Array(8192);
  const rnd = VJ.util.rng(seed);
  const n = 800;
  let pkDecay = -120;
  for (let i = 0; i + n <= x.length; i += n) {
    const c = new Float32Array(n);
    let pk = 0, e = 0;
    for (let k = 0; k < n; k++) {
      const v = Math.max(-1, Math.min(1, x[i + k] * gain + (rnd() * 2 - 1) * noise));
      c[k] = v; e += v * v; pk = Math.max(pk, Math.abs(v));
    }
    fx.process(c);
    latest.copyWithin(0, n); latest.set(c, 8192 - n);
    const f = fx.computeFrame(latest, (i + n) / SR, n / SR);
    pkDecay = Math.max(VJ.util.linToDb(pk), pkDecay - 1.5);
    const db = VJ.util.powToDb(e / n);
    acc.push(f, { l: db, r: db, lPeak: pkDecay, rPeak: pkDecay, mono: false });
  }
  return JSON.parse(JSON.stringify(acc.summary())); // 2 画面のときは JSON で渡るので、その形で
}
const cut = (x, a, b) => x.subarray(Math.round(a * SR), Math.round(b * SR));
const song = (o) => VJ.synth.song(Object.assign({ sampleRate: SR }, o)).samples;
const levels = (r) => r.items.map((i) => i.level);
const has = (r, level, re) => r.items.some((i) => i.level === level && re.test(i.text));

test('音楽のタイプの見立て：バンド→おまかせ・4 つ打ち→ダンス・ドラムなし→アコースティック・アカペラ／合唱→歌・話し声→司会', () => {
  const cases = [
    ['band', cut(VJ.synth.demoSong(SR).samples, 8, 28), 'auto'],
    ['four', song({ bpm: 128, seed: 4, sections: [{ bars: 10, drums: 'four', bass: true, guitar: 'chord' }] }), 'dance'],
    ['8beat', song({ bpm: 150, seed: 6, sections: [{ bars: 12, drums: '8beat', bass: true, guitar: 'chug' }] }), 'auto'],
    ['nodrum', song({ bpm: 90, seed: 8, sections: [{ bars: 8, drums: 'none', bass: true, guitar: 'chord' }] }), 'acoustic'],
    ['sing', VJ.voiceSynth.sing({ sr: SR }).samples, 'voice'],
    ['choir', VJ.voiceSynth.choir({ sr: SR }).samples, 'voice'],
    ['speak', VJ.voiceSynth.speak({ sr: SR, sec: 16 }).samples, 'speech'],
  ];
  for (const [name, x, want] of cases) {
    const [got] = SC.guessProfile(measure(x));
    assert.equal(got, want, name);
  }
});

test('ちょうどよい大きさ・静かな会場：問題なし。いまのタイプが合っていればおすすめは無し', () => {
  const quiet = measure(new Float32Array(SR * 5), { noise: 0.0003 });
  const music = measure(cut(VJ.synth.demoSong(SR).samples, 8, 28));
  const r = SC.analyze(quiet, music, { gateDb: -70, profile: 'auto' });
  assert.equal(r.worst, 'ok', r.items.map((i) => i.text).join(' / '));
  assert.deepEqual(r.rec, {});
  assert.ok(has(r, 'ok', /静か/));
});

test('小さすぎ・割れ・雑音に近い・ざわざわした会場を見分け、「無音とみなす音量」をすすめる', () => {
  const band = cut(VJ.synth.demoSong(SR).samples, 8, 28);
  const noisy = measure(new Float32Array(SR * 5), { noise: 0.01 }); // 約 -45 dBFS のざわざわ
  // 小さすぎ（会場の雑音より小さい）
  const low = SC.analyze(noisy, measure(band, { gain: 0.02 }), { gateDb: -70, profile: 'auto' });
  assert.ok(has(low, 'warn', /小さめ/));
  assert.ok(has(low, 'warn', /雑音に近い/));
  assert.equal(low.rec.gateDb, undefined, '演奏と雑音が分けられないときは変えない');
  // 大きすぎて割れる
  const loud = SC.analyze(noisy, measure(band, { gain: 4, noise: 0.01 }), { gateDb: -70, profile: 'auto' });
  assert.equal(loud.worst, 'bad');
  assert.ok(has(loud, 'bad', /割れ/));
  // ふつうの大きさ＋ざわざわ：雑音より少し上をすすめる（演奏の小さいところより下）
  const ok = SC.analyze(noisy, measure(band, { noise: 0.01 }), { gateDb: -70, profile: 'auto' });
  assert.ok(ok.rec.gateDb > -45 && ok.rec.gateDb <= -38, 'gate ' + ok.rec.gateDb);
  assert.ok(!levels(ok).includes('bad'));
  // すでに十分高くしてあればすすめない
  assert.equal(SC.analyze(noisy, measure(band, { noise: 0.01 }), { gateDb: ok.rec.gateDb, profile: 'auto' }).rec.gateDb, undefined);
});

test('音が入っていない・短すぎる・雑音を測らなかった', () => {
  const silent = SC.analyze(null, measure(new Float32Array(SR * 6), { noise: 0.00001 }), { gateDb: -70, profile: 'auto' });
  assert.equal(silent.worst, 'bad');
  assert.ok(has(silent, 'bad', /ほとんど入っていません/));
  assert.ok(has(silent, 'info', /測りませんでした/));
  assert.ok(has(SC.analyze(null, measure(new Float32Array(SR / 4)), { gateDb: -70, profile: 'auto' }), 'bad', /測れませんでした/));
  // 4 つ打ちの曲で「おまかせ」ならダンスをすすめる
  const four = measure(song({ bpm: 128, seed: 4, sections: [{ bars: 10, drums: 'four', bass: true, guitar: 'chord' }] }));
  assert.equal(SC.analyze(null, four, { gateDb: -70, profile: 'auto' }).rec.profile, 'dance');
});
