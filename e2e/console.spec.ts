import { test, expect, chromium, type BrowserContext } from '@playwright/test';
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

// inject 가 console/에러 후킹을 MAIN world 로 LOG 봉투로 내보내는지 검증한다.
// (background in-memory store 는 직접 접근 불가하므로 파이프라인 출발점을 본다)
async function installLogBuffer(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __qaxLogs: unknown[] }).__qaxLogs = [];
    window.addEventListener('message', (ev) => {
      const d = ev.data as { source?: string; payload?: { type?: string } };
      if (ev.source === window && d && d.source === 'qaxtension-inject' && d.payload?.type === 'LOG') {
        (window as unknown as { __qaxLogs: unknown[] }).__qaxLogs.push(d.payload);
      }
    });
  });
}

test('inject hooks console.error and emits a LOG envelope', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  await installLogBuffer(page);
  await page.evaluate(() => console.error('qax test error', { code: 42 }));

  await expect
    .poll(() =>
      page.evaluate(() => {
        const logs = (window as unknown as { __qaxLogs: Array<{ event: { source: string } }> }).__qaxLogs;
        return logs.some((l) => l.event.source === 'console');
      }),
    )
    .toBe(true);

  const captured = await page.evaluate(() => {
    const logs = (window as unknown as { __qaxLogs: Array<{ event: { level: string; text: string; source: string } }> })
      .__qaxLogs;
    return logs.find((l) => l.event.source === 'console')!.event;
  });
  expect(captured.level).toBe('error');
  expect(captured.text).toContain('qax test error');
  expect(captured.text).toContain('42'); // 객체 인자 직렬화
});

test('inject hooks unhandledrejection and emits a LOG envelope', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  await installLogBuffer(page);
  await page.evaluate(() => {
    void Promise.reject(new Error('qax rejection'));
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const logs = (window as unknown as { __qaxLogs: Array<{ event: { source: string; text: string } }> }).__qaxLogs;
        return logs.some((l) => l.event.source === 'unhandledrejection' && l.event.text.includes('qax rejection'));
      }),
    )
    .toBe(true);
});

test('hooked console.error still calls through (non-destructive)', async () => {
  const page = await context.newPage();
  const seen: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') seen.push(m.text());
  });
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  await page.evaluate(() => console.error('passthrough check'));

  // 원본 console.error 가 그대로 호출돼 브라우저 콘솔에 찍혀야 한다
  await expect.poll(() => seen.some((t) => t.includes('passthrough check'))).toBe(true);
});
