// 単体アプリに入れる Web 側のファイルを用意する：ビルドした dist/momosai-vj.html とブリッジを app/web/ へ
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs')], { stdio: 'inherit' });
const WEB = path.join(HERE, 'web');
fs.rmSync(WEB, { recursive: true, force: true });
fs.mkdirSync(path.join(WEB, 'bridge'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'dist/momosai-vj.html'), path.join(WEB, 'momosai-vj.html'));
fs.copyFileSync(path.join(ROOT, 'bridge/server.mjs'), path.join(WEB, 'bridge/server.mjs'));
fs.copyFileSync(path.join(ROOT, 'bridge/remote.html'), path.join(WEB, 'bridge/remote.html'));
// アプリの版数はリポジトリの package.json に合わせる
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
pkg.version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(HERE, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log('prepared app/web');
