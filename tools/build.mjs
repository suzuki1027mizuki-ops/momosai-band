// index.html と src/ をインライン化して、配布用の単一ファイル dist/momosai-vj.html を作る。
// 依存パッケージなし。起動スクリプトと説明書も dist/ にコピーする。中身の作り方は build-lib.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtml } from './build-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const { html, stamp, count, version } = buildHtml(ROOT);
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'momosai-vj.html'), html);

const copy = (from, to, mode) => {
  fs.copyFileSync(path.join(ROOT, from), path.join(DIST, to));
  if (mode) fs.chmodSync(path.join(DIST, to), mode);
};
copy('launcher/start-windows.bat', 'start-windows.bat');
copy('launcher/start-mac.command', 'start-mac.command', 0o755);
// ブリッジ（スマホ操作・OSC・Art-Net。Node.js で動かす）
fs.mkdirSync(path.join(DIST, 'bridge'), { recursive: true });
copy('bridge/server.mjs', 'bridge/server.mjs');
copy('bridge/qr.mjs', 'bridge/qr.mjs');
copy('bridge/remote.html', 'bridge/remote.html');
copy('launcher/start-bridge-windows.bat', 'start-bridge-windows.bat');
copy('launcher/start-bridge-mac.command', 'start-bridge-mac.command', 0o755);
if (fs.existsSync(path.join(ROOT, 'docs/MANUAL-ja.html'))) copy('docs/MANUAL-ja.html', 'MANUAL-ja.html');

const kb = (fs.statSync(path.join(DIST, 'momosai-vj.html')).size / 1024).toFixed(0);
console.log(`built dist/momosai-vj.html (${count} scripts, ${kb} KB, v${version} ${stamp})`);
