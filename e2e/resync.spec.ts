import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(dir, '../dist');

let context: BrowserContext;

test.beforeAll(async () => {
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

// 늦은 진입/SW 재시작/로더 경합으로 최초 INJECT_READY 를 놓친 상황을 모사한다.
// content 가 마킹을 잃은 뒤(=상태 stale), CMD RESYNC 한 번이면 inject 가
// INJECT_READY 를 재발신하고 content 가 다시 마킹해야 한다.
test('RESYNC command makes inject re-announce readiness', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');

  // 최초 로드: 마킹이 찍혔는지 확인
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  // stale 상황 모사: 마킹 제거
  await page.evaluate(() => {
    delete document.documentElement.dataset.qaxtensionContent;
  });
  expect(
    await page.evaluate(() => document.documentElement.dataset.qaxtensionContent),
  ).toBeUndefined();

  // 페이지(MAIN world)에서 CMD RESYNC 를 발신 → inject 가 INJECT_READY 재발신해야 함
  await page.evaluate(() => {
    window.postMessage({ source: 'qaxtension-cmd', payload: { type: 'RESYNC' } }, '*');
  });

  // content 가 재발신된 INJECT_READY 를 받아 다시 마킹했는지
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');
});
