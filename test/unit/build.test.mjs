// 配布用の単一ファイル（tools/build-lib.mjs）：同じソースからは、いつ・どの PC で作っても同じものができる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHtml, commitDate } from '../../tools/build-lib.mjs';
import { ROOT, scriptList } from '../helpers/load-src.mjs';

test('ビルド：同じソースなら同じ中身。改行が CRLF のソース（Windows の作業コピー）からも同じものができ、出力は LF', () => {
  const a = buildHtml(ROOT, { date: '2000-01-01' });
  const b = buildHtml(ROOT, { date: '2000-01-01' });
  assert.equal(a.html, b.html);
  assert.match(a.stamp, /^2000-01-01 #[0-9a-f]{7}$/);
  assert.equal(a.count, scriptList().length, 'すべてのスクリプトを取り込む');
  assert.equal(a.html.includes('\r'), false, '出力の改行は LF だけ');
  assert.equal(a.html.includes('__VJ_BUILD_TIME__'), false);
  assert.ok(a.html.includes(`VJ.buildTime = '${a.stamp}'`), '識別子が入る');

  // index.html・スクリプト・package.json を CRLF にして別の場所に置き、そこから作る
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-build-'));
  try {
    for (const rel of ['index.html', 'package.json', ...scriptList()]) {
      const dst = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    }
    const c = buildHtml(tmp, { date: '2000-01-01' });
    assert.equal(c.stamp, a.stamp, '識別子のハッシュは改行に左右されない');
    assert.equal(c.html, a.html);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ビルド：日付は git の最後のコミットの日付（作った日ではない）。git が無い場所では今日', () => {
  assert.match(commitDate(ROOT), /^\d{4}-\d{2}-\d{2}$/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-nogit-'));
  try {
    assert.equal(commitDate(tmp), new Date().toISOString().slice(0, 10));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
