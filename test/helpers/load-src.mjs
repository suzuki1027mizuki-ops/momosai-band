// index.html の <script src> の順番どおりに、DOM に依存しないソースを Node に読み込む。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function scriptList() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
}

const DEFAULT_INCLUDE = ['src/core/', 'src/dsp/', 'src/audio/synth.js', 'src/show/', 'src/scenes/', 'src/ui/midi.js', 'src/ui/keys.js'];

export function loadVJ(include = DEFAULT_INCLUDE) {
  delete globalThis.VJ;
  for (const s of scriptList()) {
    if (!include.some((p) => s.startsWith(p))) continue;
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), { filename: s });
  }
  return globalThis.VJ;
}

/** 音声を「描画フレーム」相当のチャンクで流し、オンセットのログと特徴量の推移を返す */
export function analyze(VJ, samples, sr, opts = {}) {
  const fx = new VJ.dsp.FeatureExtractor({ sampleRate: sr, config: opts.config || (opts.profile ? VJ.makeDspConfig({ profile: opts.profile, gateDb: -70 }) : undefined) });
  fx.onsetLog = [];
  if (opts.sens) fx.setSensitivity(opts.sens);
  const fps = opts.fps || 60;
  const rnd = VJ.util.rng(opts.seed || 11);
  const latest = new Float32Array(8192);
  const frames = [];
  let i = 0;
  while (i < samples.length) {
    let n;
    if (opts.chunk === 'random') n = 100 + Math.floor(rnd() * 1900);
    else if (typeof opts.chunk === 'number') n = opts.chunk;
    else n = Math.round(sr / fps);
    const chunk = samples.subarray(i, Math.min(samples.length, i + n));
    fx.process(chunk);
    i += chunk.length;
    if (opts.frames !== false) {
      // latest: 直近 8192 サンプル
      const end = i, start = Math.max(0, end - 8192);
      latest.fill(0);
      latest.set(samples.subarray(start, end), 8192 - (end - start));
      const f = fx.computeFrame(latest, i / sr, chunk.length / sr);
      if (opts.keepFrames) frames.push({ t: i / sr, level: f.level, low: f.low, mid: f.mid, high: f.high, kick: f.kick, intensity: f.intensity, active: f.active, impactN: f.impactN, flags: f.onsetFlags, bpm: f.bpm, conf: f.beatConf, melodic: f.melodic });
    }
  }
  return { log: fx.onsetLog, fx, frames };
}

/** 正解との照合。検出は正解の -10ms〜+tol 以内なら一致 */
export function score(truth, detected, tol = 0.03) {
  const used = new Array(detected.length).fill(false);
  let tp = 0;
  const delays = [];
  for (const t of truth) {
    let best = -1, bd = Infinity;
    for (let j = 0; j < detected.length; j++) {
      if (used[j]) continue;
      const d = detected[j] - t;
      if (d >= -0.01 && d <= tol && Math.abs(d) < bd) { bd = Math.abs(d); best = j; }
    }
    if (best >= 0) { used[best] = true; tp++; delays.push(detected[best] - t); }
  }
  const fp = detected.length - tp;
  return {
    tp, fp, fn: truth.length - tp,
    recall: truth.length ? tp / truth.length : 1,
    precision: detected.length ? tp / detected.length : 1,
    meanDelay: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0,
    maxDelay: delays.length ? Math.max(...delays) : 0,
  };
}

export function times(log, type, sr) {
  return log.filter((o) => o.type === type).map((o) => o.sample / sr);
}
