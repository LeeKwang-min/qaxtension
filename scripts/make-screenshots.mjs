// 스토어용 사이드 패널 스크린샷 생성 스크립트 (1회성)
// dogfooding 트릭: 패널은 백그라운드로 두고 content 탭을 bringToFront 해야 패널이 연결됨.
import { chromium } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const EXT = path.resolve('dist');
const OUT = path.resolve('docs/store/screenshots/raw');
mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

// 1) service worker → 확장 ID
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
console.log('extId:', extId);

// 2) content 탭 — 데모 페이지 + 콘솔/네트워크/기록용 데이터 주입
const content = await ctx.newPage();
await content.setViewportSize({ width: 1024, height: 880 });
await content.goto('https://leekwang-min.github.io/qaxtension/privacy/', { waitUntil: 'load' });
await content.evaluate(() => {
  // 기록 데모용 미니 폼 (연결 전에 추가해도 무방)
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;font-family:system-ui;box-shadow:0 6px 20px rgba(0,0,0,.12)';
  box.innerHTML = '<div style="font-weight:600;margin-bottom:8px">데모 로그인</div>'
    + '<label style="font-size:13px">이메일<input id="demo-email" type="email" style="display:block;margin:6px 0;padding:7px;border:1px solid #ddd;border-radius:6px;width:180px"></label>'
    + '<button id="demo-login" type="button" style="padding:7px 16px;border-radius:6px;border:1px solid #1f2937;background:#1f2937;color:#fff;cursor:pointer">로그인</button>';
  document.body.appendChild(box);
});

// 3) 패널 탭 열기
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 440, height: 900 });
await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);
await panel.waitForTimeout(600);

// 4) content 를 front 로 → 패널이 그 탭을 재구독해 연결
await content.bringToFront();
await panel.locator('[data-testid="status"].on').waitFor({ timeout: 20000 });
console.log('✅ 패널 연결됨 (🟢 주입됨)');
await panel.waitForTimeout(900);

// 연결 후 콘솔·네트워크 데이터 발생 (구독 시작 이후라야 수집됨)
await content.evaluate(async () => {
  console.log('[QA Companion] 페이지 로드 완료');
  console.info('세션 시작: guest 사용자');
  console.warn('경고: 이미지 응답이 느립니다 (1180ms)');
  console.error('오류: 리소스 로드 실패 (404) /api/banner.json');
  try { await fetch(location.href); } catch {}
  try { await fetch('/api/profile'); } catch {}
  try { await fetch('/api/missing-endpoint'); } catch {}
});
await panel.waitForTimeout(1200);

const shot = async (name) => {
  await panel.waitForTimeout(500);
  await panel.screenshot({ path: `${OUT}/${name}.png` });
  console.log('📸', name);
};

const clickTab = (label) => panel.locator('nav.tabs button.tab', { hasText: label }).click();

// 1. 검사 탭
await clickTab('검사');
await shot('1-inspect');

// 2. 네트워크 탭
await clickTab('네트워크');
await shot('2-network');

// 3. 콘솔 탭
await clickTab('콘솔');
await shot('3-console');

// 4. 검증 탭 → 검사 실행
await clickTab('검증');
await panel.waitForTimeout(300);
await panel.getByRole('button', { name: '검사 실행' }).click();
await panel.waitForTimeout(3500);
await shot('4-audit');

// 5. 기록 탭 → 시작 → content 조작
await clickTab('기록');
await panel.waitForTimeout(300);
await panel.getByRole('button', { name: /기록 시작/ }).click();
await panel.waitForTimeout(1000);
await content.fill('#demo-email', 'user@example.com');
await content.click('#demo-login');
await content.waitForTimeout(1000);
await shot('5-record');

// 6. 리포트 탭
await clickTab('리포트');
await shot('6-report');

await ctx.close();
console.log('done → ' + OUT);
