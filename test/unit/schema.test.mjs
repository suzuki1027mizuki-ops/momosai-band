// 設定の形（src/core/schema.js）：すべての項目に決まりがあり、既定値がその決まりに合い、パネルの範囲と同じ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadVJ, ROOT } from '../helpers/load-src.mjs';

const VJ = loadVJ();
const { schema, fit } = VJ.settingsSchema;
const D = VJ.defaultSettings;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

test('設定の形：既定値のすべての項目（入れ子も）に決まりがあり、決まりに無い項目は無い', () => {
  assert.deepEqual(Object.keys(schema).sort(), Object.keys(D).sort());
  for (const [k, spec] of Object.entries(schema)) {
    if (spec.fields) assert.deepEqual(Object.keys(spec.fields).sort(), Object.keys(D[k]).sort(), k);
    else if (isObj(D[k])) assert.ok(spec.map, `${k} はオブジェクトなので fields か map が要る`);
    if (Array.isArray(D[k])) assert.ok(spec.array === D[k].length || spec.list, `${k} は配列なので array（長さ）か list が要る`);
  }
});

test('設定の形：既定値は決まりに合う（直しても変わらない）', () => {
  for (const [k, spec] of Object.entries(schema)) {
    assert.deepEqual(fit(spec, JSON.parse(JSON.stringify(D[k])), D[k], D), D[k], k);
  }
});

test('設定の形：パネルの部品（スライダー・数の欄）の範囲が、決まりの範囲と同じ', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const specs = [];
  for (const [k, spec] of Object.entries(schema)) {
    if (spec.ui) specs.push([k, spec]);
    for (const [kk, s] of Object.entries(spec.fields || {})) if (s.ui) specs.push([k + '.' + kk, s]);
  }
  assert.ok(specs.length >= 15, '部品の id を書いた項目が少なすぎる');
  for (const [k, s] of specs) {
    const tag = html.match(new RegExp(`<input[^>]*id="${s.ui}"[^>]*>`));
    assert.ok(tag, `${k}: index.html に #${s.ui} が無い`);
    const attr = (n) => { const m = tag[0].match(new RegExp(`\\b${n}="([^"]+)"`)); return m ? +m[1] : undefined; };
    assert.equal(attr('min'), s.min, `${k}: #${s.ui} の min`);
    assert.equal(attr('max'), s.max, `${k}: #${s.ui} の max`);
  }
});

test('設定の形：直し方の決まり（範囲・丸め・範囲外は既定値・選択肢・形・空白と長さ）', () => {
  const S = schema;
  assert.equal(fit(S.master, 5, D.master, D), 1);
  assert.equal(fit(S.master, '0.5', D.master, D), D.master, '型が違えば既定値');
  assert.equal(fit(S.sensitivity, 2.6, D.sensitivity, D), 3);
  assert.equal(fit(S.osc.fields.port, 0.6, D.osc.port, D.osc), D.osc.port, '範囲の外は丸める前に見る');
  assert.equal(fit(S.osc.fields.port, 8000.4, D.osc.port, D.osc), 8000);
  assert.equal(fit(S.osc.fields.port, 70000, D.osc.port, D.osc), D.osc.port);
  assert.equal(fit(S.lang, 'fr', D.lang, D), D.lang);
  assert.equal(fit(S.output.fields.rotate, 45, 0, D.output), 0);
  assert.equal(fit(S.logo, 'http://x/y.png', '', D), '');
  assert.equal(fit(S.osc.fields.host, '  10.0.0.2 ', D.osc.host, D.osc), '10.0.0.2');
  assert.equal(fit(S.osc.fields.host, '   ', D.osc.host, D.osc), D.osc.host);
  assert.equal(fit(S.osc.fields.host, 'h'.repeat(256), D.osc.host, D.osc), D.osc.host);
  assert.equal(fit(S.overlay.fields.videoName, 'v'.repeat(300), '', D.overlay).length, 200);
  assert.equal(fit(S.net.fields.url, ' http://x ', D.net.url, D.net), D.net.url);
  assert.equal(fit(S.net.fields.url, '', D.net.url, D.net), '', '空はつながない');
  assert.equal(fit(S.fpsCap, 12, 0, D), 30);
  assert.equal(fit(S.crossfade, -0.5, D.crossfade, D), -1);
  assert.deepEqual(fit(S.messages, ['a', 2], D.messages, D), D.messages, '長さが違えば既定値');
  assert.deepEqual(fit(S.customPalette, ['#00ff00', 'x', '#ABCDEF', 5], D.customPalette, D), ['#00ff00', D.customPalette[1], '#ABCDEF', D.customPalette[3]]);
});
