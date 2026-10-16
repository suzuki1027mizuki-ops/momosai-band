// 自分たちの録音で解析を確かめる：npm run corpus [-- --dir test/corpus --profile auto --channel mix --tol 0.05 --baseline 前回.json --out 今回.json]
// test/corpus/（git に入れない）に置いた WAV を、本体と同じ解析にかけ、1 秒ごとの検出・テンポ・話し声を CSV（同じ名前.csv）に、
// 要約を画面に出す。同じ名前の Audacity のラベル（名前.txt。k / kick = キック、s / snare = スネア、b / beat = 拍）があれば、
// 一致率とテンポの誤差も出す。--baseline で前回の要約（--out で保存したもの）と比べ、悪くなった数字を示す。
// WAV だけ読む（MP3 などは Audacity などで WAV に書き出してから）。録音はリポジトリに入れない（権利・大きさ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVJ } from '../test/helpers/load-src.mjs';
import { readWav, toMono, readLabels, analyzeSamples, secondsCSV, compareSummaries } from './corpus-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const dir = path.resolve(ROOT, arg('--dir', 'test/corpus'));
const profile = arg('--profile', 'auto'), channel = arg('--channel', 'mix'), tol = +arg('--tol', 0.05);

if (!fs.existsSync(dir)) {
  console.log(`${path.relative(ROOT, dir)} がありません。録音（WAV）を置いてから、もう一度実行してください。`);
  process.exit(0);
}
const wavs = fs.readdirSync(dir).filter((f) => /\.wav$/i.test(f)).sort();
if (!wavs.length) { console.log(`${path.relative(ROOT, dir)} に WAV がありません（MP3 などは WAV に書き出してから）。`); process.exit(0); }

const VJ = loadVJ();
const summaries = {};
for (const f of wavs) {
  const base = f.replace(/\.wav$/i, '');
  let wav;
  try { wav = readWav(fs.readFileSync(path.join(dir, f))); } catch (e) { console.log(`× ${f}: ${e.message}`); continue; }
  const lp = path.join(dir, base + '.txt');
  const labels = fs.existsSync(lp) ? readLabels(fs.readFileSync(lp, 'utf8')) : [];
  const { seconds, summary } = analyzeSamples(VJ, toMono(wav.channels, channel), wav.sr, { profile, labels, tol });
  fs.writeFileSync(path.join(dir, base + '.csv'), secondsCSV(seconds));
  summaries[f] = summary;
  const acc = summary.kickRecall !== undefined ? `  キック 再現率 ${summary.kickRecall} 適合率 ${summary.kickPrecision}` : '';
  const tempo = summary.trueBpm ? `  正解 ${summary.trueBpm} BPM（誤差 ${summary.bpmError}%）` : '';
  console.log(`${f}  ${summary.seconds} 秒  キック ${summary.kick}・スネア ${summary.snare}・ハイハット ${summary.hat}・キメ ${summary.accent}  テンポ ${summary.bpm} BPM  話し声 ${Math.round(summary.speechRatio * 100)}%${acc}${tempo}`);
}
const out = arg('--out');
if (out) fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(summaries, null, 1));
const baseline = arg('--baseline');
if (baseline) {
  const worse = compareSummaries(summaries, JSON.parse(fs.readFileSync(path.resolve(ROOT, baseline), 'utf8')));
  console.log(worse.length ? '前回より悪くなった数字:\n  ' + worse.join('\n  ') : '前回より悪くなった数字はありません');
  if (worse.length) process.exitCode = 1;
}
