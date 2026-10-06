// Playwright（インストール済みの Chromium）を偽マイク付きで起動する。
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from './load-src.mjs';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (e) {
    return await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  }
}

export const DIST = path.join(ROOT, 'dist', 'momosai-vj.html');
export const DEV = path.join(ROOT, 'index.html');
export const FIXTURES = path.join(ROOT, 'test', 'fixtures');
export const ARTIFACTS = path.join(ROOT, 'test', 'artifacts');

/**
 * @param {{wav?: string, fakeUi?: boolean}} opts
 */
export async function launch(opts = {}) {
  const { chromium } = await loadPlaywright();
  const args = [
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ];
  if (opts.fakeUi !== false) args.push('--use-fake-ui-for-media-stream');
  else args.push('--deny-permission-prompts');
  if (opts.wav) args.push(`--use-file-for-fake-audio-capture=${opts.wav}`);
  // --allow-file-access-from-files は付けない（file:// 特有の問題を隠さないため）
  const browser = await chromium.launch({ args, ignoreDefaultArgs: ['--mute-audio'] });
  return browser;
}

/** ページを開いて VJ.app ができるまで待つ。コンソールエラーを集める */
export async function openApp(browser, file, query = '', viewport = { width: 480, height: 270 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + file + (query ? '?' + query : ''));
  await page.waitForFunction(() => window.VJ && window.VJ.app && window.VJ.app.renderer, null, { timeout: 30000 });
  return { page, errors };
}

export function saveDataUrl(dataUrl, name) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const p = path.join(ARTIFACTS, name);
  fs.writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return p;
}
