import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(dir, '../dist');

let context: BrowserContext;

test.beforeAll(async () => {
  // 확장 로드는 비-headless 또는 새 headless 모드가 필요하다.
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('inject(MAIN) and content(ISOLATED) pipeline runs on a real page', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');

  // MAIN world inject 가 실행되어 플래그를 세팅했는지
  await expect
    .poll(() => page.evaluate(() => (window as any).__qaxtensionInjectReady === true))
    .toBe(true);

  // ISOLATED content 가 INJECT_READY 를 받아 document 를 마킹했는지
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');
});
