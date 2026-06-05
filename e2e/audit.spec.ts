import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(dir, '../dist');

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    // viewport:null → 페이지 뷰포트가 실제 창 크기를 따라감(리사이즈 보정 검증에 필요).
    // 기본값은 고정 viewport 라 창을 줄여도 innerWidth 가 안 변한다.
    viewport: null,
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

// 오버헤드 보정 리사이즈가 실제로 페이지 뷰포트를 프리셋에 맞추는지 검증.
// (창 전체가 아니라 innerWidth 가 프리셋이 되어야 함 — 사이드패널/크롬 UI 보정)
test('resize compensates chrome overhead so innerWidth matches the preset', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await page.waitForLoadState('load');
  const sw = await worker();

  const PRESET_W = 600;
  const PRESET_H = 700;

  // background 의 resizeToViewport 와 동일한 보정 로직을 SW 컨텍스트에서 수행
  await sw.evaluate(
    async ({ pw, ph }) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const win = await chrome.windows.get(tab.windowId!);
      const [inj] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: () => ({ iw: window.innerWidth, ih: window.innerHeight }),
      });
      const m = inj.result as { iw: number; ih: number };
      const dw = Math.max(0, win.width! - m.iw);
      const dh = Math.max(0, win.height! - m.ih);
      await chrome.windows.update(tab.windowId!, {
        width: pw + dw,
        height: ph + dh,
        state: 'normal',
      });
    },
    { pw: PRESET_W, ph: PRESET_H },
  );

  // 리사이즈가 반영될 때까지 폴링 — 페이지 innerWidth 가 프리셋 근사여야 함
  await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 3000 }).toBeLessThan(PRESET_W + 30);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(innerWidth).toBeGreaterThan(PRESET_W - 30);
  expect(innerWidth).toBeLessThan(PRESET_W + 30);
});
