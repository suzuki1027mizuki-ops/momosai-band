// 設定の読み込みの「今の答え」：いろいろな設定 200 通り（test/helpers/settings-cases.mjs）を読み込んだ結果を
// settings-golden.json と比べる。storage.js の書き換え（スキーマにまとめる など）で、結果が気づかないうちに変わらないように。
// 意図して変えたときは、差を確かめてから VJ_WRITE_GOLDEN=1 で流して作り直す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVJ } from '../helpers/load-src.mjs';
import { settingsCases, diffFrom } from '../helpers/settings-cases.mjs';

const VJ = loadVJ();
const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'settings-golden.json');

function results() {
  VJ.storage.takeNotes();
  return settingsCases(VJ).map((c) => {
    const s = VJ.storage.fromJSON(JSON.stringify(c));
    return { diff: diffFrom(VJ.defaultSettings, s), notes: VJ.storage.takeNotes() };
  });
}

test('設定の読み込み：200 通りの設定を読み込んだ結果が、今の答えと同じ', () => {
  // 保存するのと同じ形にそろえて比べる（-0 は JSON にすると 0 になる）
  const got = JSON.parse(JSON.stringify(results()));
  if (process.env.VJ_WRITE_GOLDEN) {
    fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n');
    return;
  }
  const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.equal(got.length, want.length);
  for (let i = 0; i < got.length; i++) assert.deepEqual(got[i], want[i], `${i} 番目の設定: ${JSON.stringify(settingsCases(VJ)[i])}`);
});
