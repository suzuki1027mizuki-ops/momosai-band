// 自分たちの録音で解析を確かめる道具（tools/corpus.mjs）の中身。単体テストからも呼ぶ。
// 解析は本体と同じ（test/helpers/load-src.mjs の analyze：本体の FeatureExtractor を描画フレームごとに回す）。
// 限界：ブラウザの入力の処理（機器・OS の音量調整など）は通らない。数字は「解析そのもの」の確かめで、会場の音での
// 確かめは本番の記録（src/show/recorder.js）で行う。
import { analyze } from '../test/helpers/load-src.mjs';

/** WAV（PCM 16 / 24 / 32 ビット・浮動小数 32 / 64 ビット。WAVE_FORMAT_EXTENSIBLE も）→ { sr, channels: Float32Array[] } */
export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV（RIFF / WAVE）ではありません');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
    if (id === 'fmt ') {
      let format = body.readUInt16LE(0);
      if (format === 0xfffe && body.length >= 26) format = body.readUInt16LE(24); // EXTENSIBLE：サブフォーマットの先頭
      fmt = { format, channels: body.readUInt16LE(2), sr: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === 'data') data = body;
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('fmt / data のチャンクがありません');
  const { format, channels: nc, sr, bits } = fmt;
  const bps = bits / 8, n = Math.floor(data.length / (bps * nc));
  if (!((format === 1 && [16, 24, 32].includes(bits)) || (format === 3 && [32, 64].includes(bits)))) throw new Error(`この WAV の形式は読めません（format ${format}・${bits} ビット）。16 / 24 ビットの PCM か 32 ビットの浮動小数に変換してください`);
  const channels = Array.from({ length: nc }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const p = (i * nc + c) * bps;
      let v;
      if (format === 3) v = bits === 32 ? data.readFloatLE(p) : data.readDoubleLE(p);
      else if (bits === 16) v = data.readInt16LE(p) / 32768;
      else if (bits === 24) v = data.readIntLE(p, 3) / 8388608;
      else v = data.readInt32LE(p) / 2147483648;
      channels[c][i] = v;
    }
  }
  return { sr, channels };
}

/** 左右をパネルと同じ選び方で 1 本に（mix：平均 / left / right） */
export function toMono(channels, channel = 'mix') {
  if (channels.length < 2) return channels[0];
  if (channel === 'left') return channels[0];
  if (channel === 'right') return channels[1];
  const out = new Float32Array(channels[0].length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (channels[0][i] + channels[1][i]);
  return out;
}

/** Audacity のラベル（「開始\t終了\tラベル」。小数点はピリオド）→ [{ t, label }] */
export function readLabels(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const [a, , label = ''] = line.split('\t');
    const t = parseFloat(a);
    if (isFinite(t)) out.push({ t, label: label.trim().toLowerCase() });
  }
  return out.sort((x, y) => x.t - y.t);
}

/** 正解（秒）と検出（秒）を照らす。差が tol 秒以内なら一致（手で付けたラベルはずれるので、両側に同じ幅） */
export function matchOnsets(truth, detected, tol = 0.05) {
  const used = new Array(detected.length).fill(false);
  let tp = 0;
  for (const t of truth) {
    let best = -1, bd = Infinity;
    for (let j = 0; j < detected.length; j++) {
      const d = Math.abs(detected[j] - t);
      if (!used[j] && d <= tol && d < bd) { bd = d; best = j; }
    }
    if (best >= 0) { used[best] = true; tp++; }
  }
  return { tp, fp: detected.length - tp, fn: truth.length - tp, recall: truth.length ? tp / truth.length : 1, precision: detected.length ? tp / detected.length : 1 };
}

const KINDS = { kick: 'kick', snare: 'snare', hat: 'hat', accent: 'accent' };
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/**
 * 1 本の音声を解析する。labels：正解（readLabels。k / kick = キック、s / snare = スネア、b / beat = 拍）
 * → { seconds（1 秒ごとの行）, summary（検出の数・テンポ・話し声の割合と、正解があれば一致率・テンポの誤差） }
 */
export function analyzeSamples(VJ, samples, sr, opts = {}) {
  const r = analyze(VJ, samples, sr, { keepFrames: true, profile: opts.profile || 'auto' });
  const on = { kick: [], snare: [], hat: [], accent: [] };
  for (const o of r.log) if (KINDS[o.type]) on[o.type].push(o.sample / sr);
  const dur = samples.length / sr;
  const seconds = [];
  for (let s = 0; s < Math.ceil(dur); s++) {
    const fr = r.frames.filter((f) => f.t > s && f.t <= s + 1);
    const last = fr[fr.length - 1] || {};
    const count = (k) => on[k].filter((t) => t >= s && t < s + 1).length;
    seconds.push({
      t: s, level: fr.length ? Math.round((fr.reduce((a, f) => a + f.level, 0) / fr.length) * 1000) / 1000 : 0,
      kick: count('kick'), snare: count('snare'), hat: count('hat'), accent: count('accent'),
      bpm: last.bpm ? Math.round(last.bpm * 10) / 10 : '', conf: last.conf ? Math.round(last.conf * 100) / 100 : '',
      speech: last.speech ? 1 : 0, melodic: last.melodic ? 1 : 0,
    });
  }
  const after = r.frames.filter((f) => f.t > Math.min(5, dur / 2)); // 立ち上がりの数秒は除く
  const summary = {
    seconds: Math.round(dur * 10) / 10,
    kick: on.kick.length, snare: on.snare.length, hat: on.hat.length, accent: on.accent.length,
    bpm: Math.round(median(after.map((f) => f.bpm).filter(Boolean)) * 10) / 10,
    speechRatio: after.length ? Math.round((after.filter((f) => f.speech).length / after.length) * 100) / 100 : 0,
  };
  const labels = opts.labels || [];
  const pick = (names) => labels.filter((l) => names.includes(l.label)).map((l) => l.t);
  const kickTruth = pick(['k', 'kick']), snareTruth = pick(['s', 'snare']), beats = pick(['b', 'beat']);
  const tol = opts.tol || 0.05;
  const rnd = (x) => Math.round(x * 1000) / 1000;
  if (kickTruth.length) { const m = matchOnsets(kickTruth, on.kick, tol); summary.kickRecall = rnd(m.recall); summary.kickPrecision = rnd(m.precision); }
  if (snareTruth.length) { const m = matchOnsets(snareTruth, on.snare, tol); summary.snareRecall = rnd(m.recall); summary.snarePrecision = rnd(m.precision); }
  if (beats.length > 2) {
    const trueBpm = 60 / median(beats.slice(1).map((t, i) => t - beats[i]));
    summary.trueBpm = Math.round(trueBpm * 10) / 10;
    summary.bpmError = summary.bpm ? Math.round(((summary.bpm - trueBpm) / trueBpm) * 1000) / 10 : null; // %
  }
  return { seconds, summary };
}

/** 1 秒ごとの行 → CSV（BOM 付き：Excel で開ける） */
export function secondsCSV(rows) {
  const head = ['秒', '音量', 'キック', 'スネア', 'ハイハット', 'キメ', 'BPM', 'テンポの確度', '話し声', 'ドラムの無い曲'];
  const keys = ['t', 'level', 'kick', 'snare', 'hat', 'accent', 'bpm', 'conf', 'speech', 'melodic'];
  return '﻿' + [head.join(','), ...rows.map((r) => keys.map((k) => r[k]).join(','))].join('\r\n') + '\r\n';
}

/** 前回（baseline）と比べて、悪くなった数字。一致率は 0.02 以上下がったら、テンポの誤差は 1% 以上増えたら */
export function compareSummaries(now, base) {
  const worse = [];
  for (const [name, s] of Object.entries(now)) {
    const b = base[name];
    if (!b) continue;
    for (const k of ['kickRecall', 'kickPrecision', 'snareRecall', 'snarePrecision']) {
      if (typeof s[k] === 'number' && typeof b[k] === 'number' && s[k] < b[k] - 0.02) worse.push(`${name}: ${k} ${b[k]} → ${s[k]}`);
    }
    if (typeof s.bpmError === 'number' && typeof b.bpmError === 'number' && Math.abs(s.bpmError) > Math.abs(b.bpmError) + 1) worse.push(`${name}: bpmError ${b.bpmError}% → ${s.bpmError}%`);
  }
  return worse;
}
