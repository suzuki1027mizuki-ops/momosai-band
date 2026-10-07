// 英語の辞書：コードで VJ.t('…') に渡している文がすべて訳されていて、{0} などの数が合っているか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadVJ, ROOT } from '../helpers/load-src.mjs';

const VJ = loadVJ();
const JP = /[぀-ヿ一-鿿！-｠]/;

function sourceKeys() {
  const keys = new Map();
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js') && f.name !== 'i18n-en.js') {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/(?<![\w.])(?:VJ\.)?t\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.set(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'), p);
        for (const m of src.matchAll(/(?<![\w.])(?:VJ\.)?t\(([^()]*\?[^()]*)\)/g)) for (const l of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) keys.set(l[1], p);
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return keys;
}

test('英語の辞書：コード中の翻訳する文がすべて辞書にある', () => {
  const missing = [];
  for (const [k, file] of sourceKeys()) {
    if (!JP.test(k) || k === '・') continue;
    if (VJ.i18n.en[k] === undefined) missing.push(`${path.relative(ROOT, file)}: ${k}`);
  }
  assert.deepEqual(missing, []);
});

test('英語の辞書：{0} などの置き換えの数が原文と同じ・訳に日本語が混ざっていない', () => {
  for (const [ja, en] of Object.entries(VJ.i18n.en)) {
    const ph = (s) => (s.match(/\{\d\}/g) || []).sort().join();
    assert.equal(ph(en), ph(ja), ja);
    assert.ok(!JP.test(en.replace(/○/g, '')), en);
  }
});

test('t()：日本語のときは原文、英語のときは訳、無い文はそのまま', () => {
  VJ.i18n.lang = 'ja';
  assert.equal(VJ.t('シーン: {0}', '波紋'), 'シーン: 波紋');
  VJ.i18n.lang = 'en';
  assert.equal(VJ.t('シーン: {0}', 'Ripple'), 'Scene: Ripple');
  assert.equal(VJ.t('辞書に無い文'), '辞書に無い文');
  assert.equal(VJ.sceneName(VJ.scenes.byId.orb), 'Voice Orb');
  assert.equal(VJ.profileName(VJ.profileById('speech')), 'MC, speeches, readings');
  VJ.i18n.lang = 'ja';
  assert.equal(VJ.sceneName(VJ.scenes.byId.orb), '声の輪');
  assert.equal(VJ.i18n.resolve('en'), 'en');
  assert.equal(VJ.i18n.resolve('ja'), 'ja');
});
