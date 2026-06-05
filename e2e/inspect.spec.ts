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

// 패널 UI 는 자동화 불가하므로, 서비스 워커에서 PICK_START 를 content 로 보내고
// 페이지 요소를 클릭해 피커 배선(오버레이 삽입 → 클릭 → 선택 마킹)을 검증한다.
test('picker overlays, captures a clicked element, and records its selector', async () => {
  const page = await context.newPage();
  // 실제 https 페이지여야 content script 가 주입된다 (about:blank/setContent 는 미주입).
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');
  // 주입 확인 후 테스트용 타겟 요소 삽입 (id 가 있어 cssPath 가 '#cta' 반환)
  await page.evaluate(() => {
    document.body.innerHTML = '<button id="cta">눌러</button>';
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');

  // background 경유로 PICK_START 전송
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    for (const t of tabs) if (t.id != null) void chrome.tabs.sendMessage(t.id, { type: 'PICK_START' });
  });

  // 오버레이가 삽입됐는지
  await expect
    .poll(() => page.evaluate(() => !!document.querySelector('[data-qaxtension-overlay]')))
    .toBe(true);

  // 대상 요소 클릭
  await page.click('#cta');

  // content 가 선택 결과를 마킹했는지 (selector = '#cta')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionPicked))
    .toBe('#cta');

  // 클릭 후 오버레이는 제거됨
  expect(
    await page.evaluate(() => !!document.querySelector('[data-qaxtension-overlay]')),
  ).toBe(false);
});
