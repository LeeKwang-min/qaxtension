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

// 패널 UI 는 자동화 불가하므로, 서비스 워커의 store 를 직접 조회해 캡처 배선을 검증한다.
// background 는 chrome.storage 가 아닌 in-memory Map 이라 직접 못 읽으므로,
// 패널 Port 대신 SW 에서 tabs.sendMessage(RESYNC) 경로가 아닌 — 페이지 fetch 후
// content→background 중계가 일어났는지를 'NET_END 가 store 에 반영됐는지'로 본다.
// store 는 SW 컨텍스트의 모듈 상태라 sw.evaluate 로 접근 불가하므로,
// 여기서는 inject 후킹이 NET_START/END 를 window.postMessage 로 내보내는지를
// 페이지 MAIN world 에서 직접 가로채 검증한다(파이프라인의 출발점).
test('inject hooks fetch and emits NET_START then NET_END', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');

  // content/inject 주입 대기
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  // MAIN world 에서 qaxtension-inject 봉투를 수집하는 버퍼 설치
  await page.evaluate(() => {
    (window as any).__qaxNetEvents = [];
    window.addEventListener('message', (ev) => {
      const d: any = ev.data;
      if (ev.source === window && d && d.source === 'qaxtension-inject') {
        const t = d.payload?.type;
        if (t === 'NET_START' || t === 'NET_END') (window as any).__qaxNetEvents.push(d.payload);
      }
    });
  });

  // 같은 출처(example.com)로 fetch — 성공 경로
  await page.evaluate(() => fetch('https://example.com/').then((r) => r.text()).catch(() => {}));

  // NET_START 와 NET_END 가 모두 수집됐는지
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ev = (window as any).__qaxNetEvents as any[];
        return {
          hasStart: ev.some((e) => e.type === 'NET_START'),
          hasEnd: ev.some((e) => e.type === 'NET_END'),
        };
      }),
    )
    .toEqual({ hasStart: true, hasEnd: true });

  // NET_END 에 status 가 채워졌는지 (성공 응답)
  const end = await page.evaluate(() => {
    const ev = (window as any).__qaxNetEvents as any[];
    return ev.find((e) => e.type === 'NET_END');
  });
  expect(typeof end.end.status === 'number' || typeof end.end.error === 'string').toBe(true);
});

// 상대 경로 fetch 가 절대 URL 로 정규화돼 NET_START 에 실리는지 (호스트 그룹핑용)
test('inject normalizes relative fetch URLs to absolute', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  await page.evaluate(() => {
    (window as any).__qaxNetEvents = [];
    window.addEventListener('message', (ev) => {
      const d: any = ev.data;
      if (ev.source === window && d && d.source === 'qaxtension-inject') {
        if (d.payload?.type === 'NET_START') (window as any).__qaxNetEvents.push(d.payload);
      }
    });
  });

  // 상대 경로로 호출 — 인자는 '/' 이지만 절대 URL 로 기록돼야 한다
  await page.evaluate(() => fetch('/').then((r) => r.text()).catch(() => {}));

  const start = await page.evaluate(() => {
    const ev = (window as any).__qaxNetEvents as any[];
    return ev.find((e) => e.type === 'NET_START');
  });
  expect(start.record.url).toBe('https://example.com/');
});

// XHR 후킹도 동일 파이프라인으로 NET_START/END 를 내보내는지
test('inject hooks XHR and emits NET_START then NET_END', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  await page.evaluate(() => {
    (window as any).__qaxNetEvents = [];
    window.addEventListener('message', (ev) => {
      const d: any = ev.data;
      if (ev.source === window && d && d.source === 'qaxtension-inject') {
        const t = d.payload?.type;
        if (t === 'NET_START' || t === 'NET_END') (window as any).__qaxNetEvents.push(d.payload);
      }
    });
  });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const x = new XMLHttpRequest();
        x.open('GET', 'https://example.com/');
        x.addEventListener('loadend', () => resolve());
        x.send();
      }),
  );

  await expect
    .poll(() =>
      page.evaluate(() => {
        const ev = (window as any).__qaxNetEvents as any[];
        return ev.some((e) => e.type === 'NET_START') && ev.some((e) => e.type === 'NET_END');
      }),
    )
    .toBe(true);

  // 후킹된 XHR 의 source 가 'xhr' 인지
  const start = await page.evaluate(() => {
    const ev = (window as any).__qaxNetEvents as any[];
    return ev.find((e) => e.type === 'NET_START');
  });
  expect(start.record.source).toBe('xhr');
});

// 후킹이 페이지를 깨뜨리지 않는지 (fetch 가 정상 Response 를 반환하는지)
test('hooked fetch still returns a usable Response (non-destructive)', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');

  const ok = await page.evaluate(async () => {
    const res = await fetch('https://example.com/');
    const text = await res.text();
    return res.ok && text.length > 0;
  });
  expect(ok).toBe(true);
});
