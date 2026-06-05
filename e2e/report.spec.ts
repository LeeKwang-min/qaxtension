import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(dir, '../dist');

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
});

test.afterAll(async () => {
  await context?.close();
});

async function worker(): Promise<Worker> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  return sw;
}

// 스크린샷 권한(captureVisibleTab)이 배선됐는지 — 핵심 위험(권한 설정)을 검증한다.
test('captureVisibleTab returns a PNG dataURL (permission wired)', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await page.waitForLoadState('load');
  const sw = await worker();

  const dataUrl = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'png' });
  });

  expect(dataUrl.startsWith('data:image/png')).toBe(true);
  expect(dataUrl.length).toBeGreaterThan(100);
});

// content 가 COLLECT_ENV 에 응답해 ENV_RESULT 를 발신하는지 (환경정보 수집 파이프라인).
test('content collects env and emits ENV_RESULT with url and os', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  const sw = await worker();

  // background SW 전역에 ENV_RESULT 수신 프로미스를 설치
  await sw.evaluate(() => {
    (globalThis as unknown as { __envResult: Promise<unknown> }).__envResult = new Promise(
      (resolve) => {
        const listener = (msg: { type?: string; env?: unknown }) => {
          if (msg?.type === 'ENV_RESULT') {
            chrome.runtime.onMessage.removeListener(listener);
            resolve(msg.env);
          }
        };
        chrome.runtime.onMessage.addListener(listener);
      },
    );
  });

  // 활성 탭의 content 로 수집 요청
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    void chrome.tabs.sendMessage(tab.id!, { type: 'COLLECT_ENV' });
  });

  const env = (await sw.evaluate(
    () => (globalThis as unknown as { __envResult: Promise<unknown> }).__envResult,
  )) as {
    url: string;
    os: string;
    viewport: { width: number; height: number };
    language: string;
  };

  expect(env.url).toContain('example.com');
  expect(typeof env.os).toBe('string');
  expect(env.os.length).toBeGreaterThan(0);
  expect(env.viewport.width).toBeGreaterThan(0);
});
