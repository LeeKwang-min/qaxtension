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

// 알려진 한계(Phase 0): inject(MAIN)와 content(ISOLATED)는 CRXJS async 로더로 주입된다.
// inject 의 INJECT_READY postMessage 가 content 의 message 리스너 등록보다 먼저 실행되면
// 메시지가 유실될 수 있다(재발신 없음). 로컬에선 content 로더가 더 빨리 resolve 되어 통과하지만
// 순서가 보장되진 않는다. 후속 Phase 에서 inject 재발신 또는 핸드셰이크로 강건화할 것.
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
