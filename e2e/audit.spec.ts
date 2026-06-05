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

// content 가 RUN_AUDIT 에 응답해 a11y 위반을 담은 AUDIT_RESULT 를 발신하는지 검증.
test('content runs audit and emits AUDIT_RESULT with a11y issues', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  // 의도적 접근성 위반을 페이지에 주입 (alt 없는 이미지 + 이름 없는 버튼)
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<img id="noalt" src="/qax-missing.png"><button id="noname"></button>',
    );
  });

  const sw = await worker();

  // background 전역에 AUDIT_RESULT 수신 프로미스 설치
  await sw.evaluate(() => {
    (globalThis as unknown as { __auditRaw: Promise<unknown> }).__auditRaw = new Promise((resolve) => {
      const listener = (msg: { type?: string; raw?: unknown }) => {
        if (msg?.type === 'AUDIT_RESULT') {
          chrome.runtime.onMessage.removeListener(listener);
          resolve(msg.raw);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
  });

  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    void chrome.tabs.sendMessage(tab.id!, { type: 'RUN_AUDIT' });
  });

  const raw = (await sw.evaluate(
    () => (globalThis as unknown as { __auditRaw: Promise<unknown> }).__auditRaw,
  )) as {
    a11y: { kind: string; selector: string }[];
    resources: { kind: string; url: string }[];
    ranAt: number;
  };

  const kinds = raw.a11y.map((i) => i.kind);
  expect(kinds).toContain('img-alt');
  expect(kinds).toContain('control-name');
  expect(raw.resources.some((r) => r.url.includes('qax-missing.png'))).toBe(true);
  expect(raw.ranAt).toBeGreaterThan(0);
});

// chrome.windows.update 로 창 리사이즈가 동작하는지 (반응형 프리셋 배선).
test('windows.update resizes the window (responsive preset wired)', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await page.waitForLoadState('load');
  const sw = await worker();

  const width = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const win = await chrome.windows.update(tab.windowId!, { width: 800, height: 700 });
    return win.width;
  });

  // OS/크롬이 약간 보정할 수 있어 근사 비교
  expect(width).toBeGreaterThan(600);
  expect(width).toBeLessThan(1000);
});
