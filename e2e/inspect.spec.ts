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

// 피커 호버 시 클릭 없이도 ELEMENT_HOVERED 가 발신되는지 (호버 미리보기 배선).
test('picker emits ELEMENT_HOVERED on hover without clicking', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');
  await page.evaluate(() => {
    document.body.innerHTML = '<button id="hovertgt">호버대상</button>';
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');

  // background 전역에 ELEMENT_HOVERED 수신 프로미스 설치
  await sw.evaluate(() => {
    (globalThis as unknown as { __hovered: Promise<unknown> }).__hovered = new Promise((resolve) => {
      const listener = (msg: { type?: string; info?: { selector?: string } }) => {
        // 호버 경로상 중간 요소가 아닌, 대상 요소의 호버만 받는다
        if (msg?.type === 'ELEMENT_HOVERED' && msg.info?.selector === '#hovertgt') {
          chrome.runtime.onMessage.removeListener(listener);
          resolve(msg.info);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
    void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      for (const t of tabs) if (t.id != null) void chrome.tabs.sendMessage(t.id, { type: 'PICK_START' });
    });
  });

  await expect
    .poll(() => page.evaluate(() => !!document.querySelector('[data-qaxtension-overlay]')))
    .toBe(true);

  // 클릭하지 않고 호버만
  await page.hover('#hovertgt');

  const info = (await sw.evaluate(
    () => (globalThis as unknown as { __hovered: Promise<unknown> }).__hovered,
  )) as { selector: string; domPath: number[] | null };
  expect(info.selector).toBe('#hovertgt');
  // 트리 동기화용 경로 포함 (body 의 첫 자식 → [0])
  expect(info.domPath).toEqual([0]);
});

// DOM 트리: content 가 DOM_CHILDREN 에 자식 목록으로, INSPECT_PATH 에 선택으로 응답하는지.
test('content serves DOM_CHILDREN and inspects by path', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');
  await page.evaluate(() => {
    document.body.innerHTML = '<header></header><main><section id="sec"></section></main>';
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');

  // DOM_CHILDREN_RESULT 수신 → DOM_CHILDREN([]) 요청
  const nodes = (await sw.evaluate(async () => {
    const result = new Promise((resolve) => {
      const listener = (msg: { type?: string; nodes?: unknown }) => {
        if (msg?.type === 'DOM_CHILDREN_RESULT') {
          chrome.runtime.onMessage.removeListener(listener);
          resolve(msg.nodes);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    void chrome.tabs.sendMessage(tab.id!, { type: 'DOM_CHILDREN', path: [] });
    return result;
  })) as { tagName: string; childElementCount: number; path: number[] }[];

  expect(nodes.map((n) => n.tagName)).toEqual(['header', 'main']);
  expect(nodes[1].childElementCount).toBe(1);

  // INSPECT_PATH([1,0]) → section#sec 선택 마킹
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    void chrome.tabs.sendMessage(tab.id!, { type: 'INSPECT_PATH', path: [1, 0] });
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionPicked), { timeout: 3000 })
    .toBe('#sec');

  // HIGHLIGHT_PATH([1,0]) → 하이라이트 오버레이 표시, null → 숨김
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    void chrome.tabs.sendMessage(tab.id!, { type: 'HIGHLIGHT_PATH', path: [1, 0] });
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const o = document.querySelector('[data-qaxtension-highlight]') as HTMLElement | null;
          return o ? o.style.display : 'absent';
        }),
      { timeout: 3000 },
    )
    .toBe('block');

  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    void chrome.tabs.sendMessage(tab.id!, { type: 'HIGHLIGHT_PATH', path: null });
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const o = document.querySelector('[data-qaxtension-highlight]') as HTMLElement | null;
        return o ? o.style.display : 'absent';
      }),
    )
    .toBe('none');
});
