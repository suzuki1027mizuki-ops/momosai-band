// index.html と src/ をインライン化して、配布用の単一ファイル dist/momosai-vj.html を作る。
// 依存パッケージなし。起動スクリプトと説明書も dist/ にコピーする。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// 識別子 = 日付 + ソース内容のハッシュ（どの版が本番 PC に入っているか HUD で確認できる）
const hash = crypto.createHash('sha256').update(html);
for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) hash.update(fs.readFileSync(path.join(ROOT, m[1])));
const stamp = new Date().toISOString().slice(0, 10) + ' #' + hash.digest('hex').slice(0, 7);
let count = 0;
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8')
    .replace(/__VJ_VERSION__/g, pkg.version)
    .replace(/__VJ_BUILD_TIME__/g, stamp)
    .replace(/<\/script/gi, '<\\/script');
  // 構文エラーはここで止める（1 ファイルでも壊れていると起動しないため）
  new vm.Script(code, { filename: src });
  count++;
  return `<script>/* ${src} */\n${code}</script>`;
});
if (/<script src=/.test(html)) throw new Error('インライン化できなかった script タグがあります');

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
copy('bridge/remote.html', 'bridge/remote.html');
copy('launcher/start-bridge-windows.bat', 'start-bridge-windows.bat');
copy('launcher/start-bridge-mac.command', 'start-bridge-mac.command', 0o755);
if (fs.existsSync(path.join(ROOT, 'docs/MANUAL-ja.html'))) copy('docs/MANUAL-ja.html', 'MANUAL-ja.html');

const kb = (fs.statSync(path.join(DIST, 'momosai-vj.html')).size / 1024).toFixed(0);
console.log(`built dist/momosai-vj.html (${count} scripts, ${kb} KB, v${pkg.version} ${stamp})`);
