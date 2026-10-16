// 配布用の単一ファイルの中身を作る（書き出しは build.mjs）。単体テストからも呼ぶ。
// 同じソースからは、いつ・どの PC で作っても同じものができるようにする：
//   - 改行は LF にそろえてから、識別子のハッシュを作り、出力にも LF で書く（Windows の作業コピーは CRLF）
//   - 日付は、作った日ではなく git の最後のコミットの日付（git が無ければ今日）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const SCRIPT_RE = /<script src="([^"]+)"><\/script>/g;

/** git の最後のコミットの日付（YYYY-MM-DD）。git が無い・リポジトリでないときは今日 */
export function commitDate(root) {
  try {
    const d = execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  } catch (e) { /* git が無い */ }
  return new Date().toISOString().slice(0, 10);
}

/**
 * index.html と、そこから読む src/ のスクリプトを 1 つの HTML にまとめる。
 * @param {string} root リポジトリの場所
 * @param {{ date?: string }} [opts] date：識別子の日付（省略すると commitDate）
 * @returns {{ html: string, stamp: string, count: number, version: string }}
 */
export function buildHtml(root, opts = {}) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n?/g, '\n');
  const pkg = JSON.parse(read('package.json'));
  let html = read('index.html');
  // 識別子 = 日付 + ソース内容のハッシュ（どの版が本番 PC に入っているか HUD で確認できる）
  const hash = crypto.createHash('sha256').update(html);
  for (const m of html.matchAll(SCRIPT_RE)) hash.update(read(m[1]));
  const stamp = (opts.date || commitDate(root)) + ' #' + hash.digest('hex').slice(0, 7);
  let count = 0;
  html = html.replace(SCRIPT_RE, (m, src) => {
    const code = read(src)
      .replace(/__VJ_VERSION__/g, pkg.version)
      .replace(/__VJ_BUILD_TIME__/g, stamp)
      .replace(/<\/script/gi, '<\\/script');
    // 構文エラーはここで止める（1 ファイルでも壊れていると起動しないため）
    new vm.Script(code, { filename: src });
    count++;
    return `<script>/* ${src} */\n${code}</script>`;
  });
  if (/<script src=/.test(html)) throw new Error('インライン化できなかった script タグがあります');
  return { html, stamp, count, version: pkg.version };
}
