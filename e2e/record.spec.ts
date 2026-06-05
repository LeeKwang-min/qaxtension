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

async function ready(page: import('@playwright/test').Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');
}

// content 가 RECORD_START 로 capture-phase 리스너를 무장하고 클릭·입력을
// INTERACTION 메시지로 내보내는지 (recorder DOM 추출 + 메시지 배선) 검증한다.
test('records click and input as INTERACTION messages, masking passwords', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await ready(page);
  await page.evaluate(() => {
    document.body.innerHTML =
      '<form aria-label="회원가입">' +
      '<h2>회원가입</h2>' +
      '<button id="login" type="button" class="btn-primary">로그인</button>' +
      '<input id="email" name="email" type="text">' +
      '<input id="pw" name="pw" type="password">' +
      '</form>';
  });

  const sw = await worker();
  // background 전역에 INTERACTION 수집 버퍼 설치 + content 무장
  await sw.evaluate(async () => {
    (globalThis as unknown as { __ix: unknown[] }).__ix = [];
    chrome.runtime.onMessage.addListener((msg: { type?: string; event?: unknown }) => {
      if (msg?.type === 'INTERACTION') (globalThis as unknown as { __ix: unknown[] }).__ix.push(msg.event);
    });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    void chrome.tabs.sendMessage(tab.id!, { type: 'RECORD_START' });
  });

  await page.click('#login');
  await page.fill('#email', 'a@b.com');
  await page.locator('#email').blur();
  await page.fill('#pw', 'hunter2');
  await page.locator('#pw').blur();

  await expect
    .poll(() =>
      sw.evaluate(() => (globalThis as unknown as { __ix: { kind: string }[] }).__ix.length),
    )
    .toBeGreaterThanOrEqual(3);

  const events = (await sw.evaluate(
    () => (globalThis as unknown as { __ix: unknown[] }).__ix,
  )) as { kind: string; selector: string; label: string; value: string | null; context: string | null }[];

  const click = events.find((e) => e.kind === 'click');
  expect(click?.selector).toBe('button#login.btn-primary[type=button]'); // 풍부한 시그니처
  expect(click?.label).toBe('로그인');
  expect(click?.context).toBe('회원가입 폼'); // 영역 컨텍스트

  const email = events.find((e) => e.kind === 'input' && e.selector === 'input#email[name=email]');
  expect(email?.value).toBe('a@b.com');

  const pw = events.find((e) => e.kind === 'input' && e.selector === 'input#pw[name=pw]');
  expect(pw).toBeTruthy();
  expect(pw?.value).not.toContain('hunter2'); // password 마스킹
});

// 기록 리스너가 capture 단계라도 페이지 자신의 핸들러를 막지 않는지 (비파괴).
test('recording is non-destructive — page handlers still fire', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  await ready(page);
  await page.evaluate(() => {
    document.body.innerHTML = '<button id="b">go</button>';
    (window as unknown as { __clicked: boolean }).__clicked = false;
    document.getElementById('b')!.addEventListener('click', () => {
      (window as unknown as { __clicked: boolean }).__clicked = true;
    });
  });

  const sw = await worker();
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    void chrome.tabs.sendMessage(tab.id!, { type: 'RECORD_START' });
  });

  await page.click('#b');
  expect(await page.evaluate(() => (window as unknown as { __clicked: boolean }).__clicked)).toBe(true);
});
