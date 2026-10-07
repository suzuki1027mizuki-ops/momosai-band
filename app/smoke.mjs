// 単体アプリの自己診断：MOMOSAI_SMOKE=1 で起動し、結果（SMOKE {...}）を確かめる。Linux では xvfb-run があれば使う
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const electron = require('electron');
const args = [electron, '.', '--no-sandbox'];
const useXvfb = process.platform === 'linux' && !process.env.DISPLAY && spawnSync('which', ['xvfb-run']).status === 0;
const cmd = useXvfb ? 'xvfb-run' : args.shift();
// 偽のマイクに流す音（テスト用の音源があれば。npm run fixtures で作られる）
const wav = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/drums.wav');
const env = { ...process.env, MOMOSAI_SMOKE: '1' };
if (fs.existsSync(wav)) env.MOMOSAI_FAKE_WAV = wav;
const r = spawnSync(cmd, useXvfb ? ['-a', ...args] : args, { env, encoding: 'utf8', timeout: 200000 });
const out = (r.stdout || '') + (r.stderr || '');
const line = out.split('\n').find((l) => l.startsWith('SMOKE '));
if (!line) { console.log(out.slice(-3000)); console.log('自己診断の結果がありません'); process.exit(1); }
const res = JSON.parse(line.slice(6));
console.log(JSON.stringify(res, null, 2));
console.log(res.ok ? '単体アプリ：OK' : '単体アプリ：問題あり');
process.exit(res.ok ? 0 : 1);
