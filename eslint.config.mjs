// 静的解析（npm run lint）。まちがい（未定義の名前・使っていない変数・重複など）を見つけるためのもので、書き方の好みは決めない。
import js from '@eslint/js';
import globals from 'globals';

const rules = {
  ...js.configs.recommended.rules,
  // 「失敗しても続ける」ための空の catch は使う（中にコメントを書く）
  'no-empty': ['error', { allowEmptyCatch: true }],
  // 使っていない引数（コールバックの形を合わせるため）と catch の変数は数えない
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  // 全角の空白は、セットリストの読み取り（正規表現・文字列）でわざと使う
  'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true, skipComments: true }],
  // 「ASCII 以外の文字があるか」を /[^\x00-\x7f]/ で調べる
  'no-control-regex': 'off',
  // 「let x = 既定値; try { x = … } catch { x = 既定値 }」の形を使う（読みやすさのため）
  'no-useless-assignment': 'off',
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'app/node_modules/**', 'app/web/**', 'app/release/**', 'test/artifacts/**', 'src/ui/thumbs.js'] },
  {
    // アプリ本体：classic script（file:// と Node の vm の両方で読むため、ES Modules は使わない）
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules,
  },
  {
    // ブリッジ・ツール・テスト（Node）。テストとツールは、ページの中で動かす関数（page.evaluate）も書くのでブラウザの名前も使う
    files: ['bridge/**/*.mjs', 'tools/**/*.mjs', 'test/**/*.mjs', 'app/**/*.mjs', '*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser, VJ: 'readonly' } },
    rules,
  },
  {
    files: ['app/**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
];
