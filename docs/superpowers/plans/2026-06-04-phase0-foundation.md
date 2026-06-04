# QA Companion — Phase 0 (토대) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manifest V3 Chrome 익스텐션의 토대를 구축한다 — 빌드 파이프라인, 사이드 패널 셸, 타입드 메시지 계약, tabId별 세션 저장소, 그리고 `inject(MAIN) → content(ISOLATED) → background → side panel` 양방향 메시지 왕복을 검증한다.

**Architecture:** MAIN-world content script가 페이지에 신호를 보내고, ISOLATED content script가 브리지 역할로 background service worker에 전달하며, background는 tabId별 상태를 저장하고 Port로 연결된 사이드 패널에 push한다. 사이드 패널의 "Ping" 버튼이 역방향(panel → background → content → inject → 응답)을 검증한다.

**Tech Stack:** TypeScript, React, Vite, `@crxjs/vite-plugin` (v2 beta), Vitest(단위 테스트), Playwright(e2e).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `package.json` | 스크립트·의존성 |
| `tsconfig.json`, `tsconfig.node.json` | 타입 설정 (chrome/node/react-jsx) |
| `vite.config.ts` | Vite + React + CRXJS |
| `vitest.config.ts` | 단위 테스트 설정 |
| `playwright.config.ts` | e2e 설정 |
| `src/manifest.ts` | MV3 manifest 정의 (CRXJS `defineManifest`) |
| `src/messaging/types.ts` | 컨텍스트 간 메시지·상태 타입 (인터페이스) |
| `src/messaging/index.ts` | 소스 상수 + envelope 타입가드 |
| `src/background/store.ts` | tabId별 세션 상태 (순수 모듈) |
| `src/background/index.ts` | service worker: sidePanel 동작, 메시지 라우팅, Port push |
| `src/content/index.ts` | ISOLATED 브리지: MAIN↔runtime 중계, 관측용 DOM 마킹 |
| `src/inject/index.ts` | MAIN world: INJECT_READY 발신, PING 응답 |
| `src/sidepanel/index.html` | 패널 진입 HTML |
| `src/sidepanel/main.tsx` | React 마운트 |
| `src/sidepanel/App.tsx` | 패널 셸: 연결상태·Ping·탭 네비 |
| `tests/store.test.ts` | store 단위 테스트 |
| `tests/messaging.test.ts` | envelope 가드 단위 테스트 |
| `e2e/smoke.spec.ts` | unpacked 익스텐션 로드 → inject+content 파이프라인 검증 |

> 이후 Phase(1~6)는 별도 계획 문서로 작성한다. 본 계획은 토대만 다룬다.

---

## Task 1: 프로젝트 스캐폴드 & 빌드 파이프라인

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `src/manifest.ts`
- Create: `src/sidepanel/index.html`, `src/sidepanel/main.tsx`, `src/sidepanel/App.tsx`
- Create: `src/background/index.ts` (임시 빈 진입), `src/content/index.ts` (임시 빈 진입), `src/inject/index.ts` (임시 빈 진입)

- [ ] **Step 1: 의존성 설치**

```bash
npm init -y
npm pkg set type="module"
npm install react react-dom
npm install -D typescript @types/chrome @types/react @types/react-dom \
  vite @vitejs/plugin-react @crxjs/vite-plugin@beta \
  vitest @playwright/test @types/node
npx playwright install chromium
```

- [ ] **Step 2: `tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["chrome", "node"],
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests", "e2e"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: `tsconfig.node.json` 작성**

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 4: `src/manifest.ts` 작성**

```ts
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'QA Companion',
  version: '0.0.0',
  description: '비개발자를 위한 웹 서비스 QA 유틸리티',
  minimum_chrome_version: '114',
  action: { default_title: 'QA Companion' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  permissions: ['sidePanel', 'storage', 'tabs', 'scripting'],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_start',
      all_frames: false,
    },
    {
      matches: ['<all_urls>'],
      js: ['src/inject/index.ts'],
      run_at: 'document_start',
      world: 'MAIN',
      all_frames: false,
    },
  ],
});
```

- [ ] **Step 5: `vite.config.ts` 작성**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: { target: 'es2022' },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
```

- [ ] **Step 6: 임시 진입 파일 작성 (빌드 통과용 최소 내용)**

`src/background/index.ts`:
```ts
console.debug('[qaxtension] background boot');
```

`src/content/index.ts`:
```ts
console.debug('[qaxtension] content boot');
```

`src/inject/index.ts`:
```ts
console.debug('[qaxtension] inject boot');
```

- [ ] **Step 7: 사이드 패널 진입 파일 작성**

`src/sidepanel/index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>QA Companion</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/sidepanel/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/sidepanel/App.tsx` (Task 6에서 교체될 최소 셸):
```tsx
export function App() {
  return <div style={{ font: '13px system-ui', padding: 12 }}>QA Companion</div>;
}
```

- [ ] **Step 8: 빌드 검증**

Run: `npm run build`

> `package.json`에 빌드 스크립트가 아직 없다면 먼저 추가:
```bash
npm pkg set scripts.dev="vite"
npm pkg set scripts.build="tsc -b && vite build"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.e2e="playwright test"
```

Run: `npm run build`
Expected: 성공, `dist/` 생성, `dist/manifest.json` 존재.

- [ ] **Step 9: `.gitignore` 확인 후 커밋**

`.gitignore`에 `node_modules/`, `dist/`가 포함되어 있는지 확인(이미 존재). 그 후:
```bash
git add -A
git commit -m "chore: scaffold MV3 extension with Vite + CRXJS + React"
```

---

## Task 2: 메시지 계약 (messaging)

**Files:**
- Create: `src/messaging/types.ts`
- Create: `src/messaging/index.ts`
- Test: `tests/messaging.test.ts`, `vitest.config.ts`

- [ ] **Step 1: `vitest.config.ts` 작성**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: 타입 작성 — `src/messaging/types.ts`**

```ts
export type TabId = number;

/** MAIN world(inject) → ISOLATED(content) 로 가는 메시지 봉투 */
export interface InjectEnvelope {
  source: 'qaxtension-inject';
  payload:
    | { type: 'INJECT_READY' }
    | { type: 'PING_REPLY'; nonce: string };
}

/** ISOLATED(content) → MAIN world(inject) 로 가는 명령 봉투 */
export interface CmdEnvelope {
  source: 'qaxtension-cmd';
  payload: { type: 'PING'; nonce: string };
}

/** chrome.runtime 메시지 (content↔background 양방향 공유 union) */
export type RuntimeMessage =
  | { type: 'INJECT_READY' }
  | { type: 'PING_REPLY'; nonce: string }
  | { type: 'PING'; nonce: string };

/** tabId별 세션 상태 */
export interface TabSessionState {
  tabId: TabId;
  url: string | null;
  injectReady: boolean;
  lastPingNonce: string | null;
  updatedAt: number;
}

/** 사이드 패널 ↔ background 의 long-lived Port 메시지 */
export type PortMessage =
  | { type: 'SUBSCRIBE'; tabId: TabId }
  | { type: 'PING'; tabId: TabId }
  | { type: 'STATE_UPDATE'; state: TabSessionState };
```

- [ ] **Step 3: 실패하는 테스트 작성 — `tests/messaging.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  isInjectEnvelope,
  isCmdEnvelope,
  INJECT_SOURCE,
  CMD_SOURCE,
} from '../src/messaging';

describe('envelope guards', () => {
  it('accepts a valid inject envelope', () => {
    expect(
      isInjectEnvelope({ source: INJECT_SOURCE, payload: { type: 'INJECT_READY' } }),
    ).toBe(true);
  });

  it('rejects foreign or malformed messages', () => {
    expect(isInjectEnvelope({ source: 'other' })).toBe(false);
    expect(isInjectEnvelope(null)).toBe(false);
    expect(isInjectEnvelope('x')).toBe(false);
  });

  it('distinguishes a cmd envelope from an inject envelope', () => {
    expect(
      isCmdEnvelope({ source: CMD_SOURCE, payload: { type: 'PING', nonce: 'a' } }),
    ).toBe(true);
    expect(isCmdEnvelope({ source: INJECT_SOURCE, payload: { type: 'INJECT_READY' } })).toBe(false);
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npx vitest run tests/messaging.test.ts`
Expected: FAIL — `../src/messaging`에서 export를 찾지 못함.

- [ ] **Step 5: 구현 — `src/messaging/index.ts`**

```ts
import type { InjectEnvelope, CmdEnvelope } from './types';

export const INJECT_SOURCE = 'qaxtension-inject' as const;
export const CMD_SOURCE = 'qaxtension-cmd' as const;

export function isInjectEnvelope(data: unknown): data is InjectEnvelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === INJECT_SOURCE
  );
}

export function isCmdEnvelope(data: unknown): data is CmdEnvelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === CMD_SOURCE
  );
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run tests/messaging.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: 커밋**

```bash
git add src/messaging tests/messaging.test.ts vitest.config.ts
git commit -m "feat(messaging): typed context message contracts + envelope guards"
```

---

## Task 3: 세션 저장소 (background/store)

**Files:**
- Create: `src/background/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/store.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getTabState, updateTabState, clearTabState } from '../src/background/store';

describe('tab session store', () => {
  beforeEach(() => clearTabState(1));

  it('creates default state on first access', () => {
    const s = getTabState(1);
    expect(s.tabId).toBe(1);
    expect(s.injectReady).toBe(false);
    expect(s.url).toBeNull();
    expect(s.lastPingNonce).toBeNull();
  });

  it('merges partial patches and keeps tabId fixed', () => {
    updateTabState(1, { injectReady: true, url: 'https://x.test' });
    const s = getTabState(1);
    expect(s.injectReady).toBe(true);
    expect(s.url).toBe('https://x.test');
    expect(s.tabId).toBe(1);
  });

  it('clears state back to default', () => {
    updateTabState(1, { injectReady: true });
    clearTabState(1);
    expect(getTabState(1).injectReady).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — `../src/background/store` 모듈 없음.

- [ ] **Step 3: 구현 — `src/background/store.ts`**

```ts
import type { TabId, TabSessionState } from '../messaging/types';

const tabs = new Map<TabId, TabSessionState>();

function createDefault(tabId: TabId): TabSessionState {
  return {
    tabId,
    url: null,
    injectReady: false,
    lastPingNonce: null,
    updatedAt: Date.now(),
  };
}

export function getTabState(tabId: TabId): TabSessionState {
  let s = tabs.get(tabId);
  if (!s) {
    s = createDefault(tabId);
    tabs.set(tabId, s);
  }
  return s;
}

export function updateTabState(
  tabId: TabId,
  patch: Partial<Omit<TabSessionState, 'tabId'>>,
): TabSessionState {
  const current = getTabState(tabId);
  const next: TabSessionState = { ...current, ...patch, tabId, updatedAt: Date.now() };
  tabs.set(tabId, next);
  return next;
}

export function clearTabState(tabId: TabId): void {
  tabs.delete(tabId);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/background/store.ts tests/store.test.ts
git commit -m "feat(store): per-tab session state with merge/clear"
```

---

## Task 4: MAIN world inject 스크립트

**Files:**
- Modify: `src/inject/index.ts` (Task 1의 임시 내용 교체)

- [ ] **Step 1: 구현 — `src/inject/index.ts`**

```ts
import { INJECT_SOURCE, CMD_SOURCE } from '../messaging';
import type { InjectEnvelope, CmdEnvelope } from '../messaging/types';

// e2e 관측용 플래그 (호스트 페이지에 부수효과 최소)
(window as unknown as { __qaxtensionInjectReady?: boolean }).__qaxtensionInjectReady = true;

function post(payload: InjectEnvelope['payload']): void {
  const envelope: InjectEnvelope = { source: INJECT_SOURCE, payload };
  try {
    window.postMessage(envelope, '*');
  } catch {
    // 페이지를 절대 깨뜨리지 않는다 (fail-open)
  }
}

// 준비 신호 발신
post({ type: 'INJECT_READY' });

// content → inject 명령(PING) 수신 후 응답
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as CmdEnvelope | null;
  if (!data || data.source !== CMD_SOURCE) return;
  if (data.payload.type === 'PING') {
    post({ type: 'PING_REPLY', nonce: data.payload.nonce });
  }
});
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/inject/index.ts
git commit -m "feat(inject): MAIN-world ready signal + ping reply"
```

---

## Task 5: ISOLATED content 브리지

**Files:**
- Modify: `src/content/index.ts` (Task 1의 임시 내용 교체)

- [ ] **Step 1: 구현 — `src/content/index.ts`**

```ts
import { INJECT_SOURCE, CMD_SOURCE, isInjectEnvelope } from '../messaging';
import type { CmdEnvelope, RuntimeMessage } from '../messaging/types';

// MAIN world(inject) → background 로 중계
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  if (!isInjectEnvelope(ev.data)) return;
  const payload = ev.data.payload;

  if (payload.type === 'INJECT_READY') {
    // e2e 관측용 마킹
    document.documentElement.dataset.qaxtensionContent = 'ready';
    const msg: RuntimeMessage = { type: 'INJECT_READY' };
    void chrome.runtime.sendMessage(msg).catch(() => {});
  } else if (payload.type === 'PING_REPLY') {
    const msg: RuntimeMessage = { type: 'PING_REPLY', nonce: payload.nonce };
    void chrome.runtime.sendMessage(msg).catch(() => {});
  }
});

// background → MAIN world(inject) 명령 중계
chrome.runtime.onMessage.addListener((msg: RuntimeMessage) => {
  if (msg.type === 'PING') {
    const envelope: CmdEnvelope = { source: CMD_SOURCE, payload: { type: 'PING', nonce: msg.nonce } };
    window.postMessage(envelope, '*');
  }
});
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/content/index.ts
git commit -m "feat(content): bridge MAIN-world messages to/from background"
```

---

## Task 6: background service worker (라우팅 + Port push)

**Files:**
- Modify: `src/background/index.ts` (Task 1의 임시 내용 교체)

- [ ] **Step 1: 구현 — `src/background/index.ts`**

```ts
import { getTabState, updateTabState, clearTabState } from './store';
import type { RuntimeMessage, PortMessage, TabId } from '../messaging/types';

// 액션 아이콘 클릭 시 사이드 패널 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// tabId → 연결된 패널 Port 집합
const panelPorts = new Map<TabId, Set<chrome.runtime.Port>>();

function pushState(tabId: TabId): void {
  const ports = panelPorts.get(tabId);
  if (!ports || ports.size === 0) return;
  const state = getTabState(tabId);
  const msg: PortMessage = { type: 'STATE_UPDATE', state };
  for (const port of ports) port.postMessage(msg);
}

function nonce(): string {
  return Math.random().toString(36).slice(2);
}

// content script → background
chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  switch (msg.type) {
    case 'INJECT_READY':
      updateTabState(tabId, { injectReady: true, url: sender.tab?.url ?? null });
      pushState(tabId);
      break;
    case 'PING_REPLY':
      updateTabState(tabId, { lastPingNonce: msg.nonce });
      pushState(tabId);
      break;
    // 'PING' 은 background→content 방향이라 여기선 무시
  }
});

// 사이드 패널 Port 연결
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'qaxtension-panel') return;
  let boundTab: TabId | null = null;

  port.onMessage.addListener((msg: PortMessage) => {
    if (msg.type === 'SUBSCRIBE') {
      boundTab = msg.tabId;
      let set = panelPorts.get(msg.tabId);
      if (!set) {
        set = new Set();
        panelPorts.set(msg.tabId, set);
      }
      set.add(port);
      port.postMessage({ type: 'STATE_UPDATE', state: getTabState(msg.tabId) } satisfies PortMessage);
    } else if (msg.type === 'PING') {
      const n = nonce();
      updateTabState(msg.tabId, { lastPingNonce: null });
      const cmd: RuntimeMessage = { type: 'PING', nonce: n };
      chrome.tabs.sendMessage(msg.tabId, cmd).catch(() => {});
    }
  });

  port.onDisconnect.addListener(() => {
    if (boundTab != null) panelPorts.get(boundTab)?.delete(port);
  });
});

// 네비게이션/리로드 시 상태 초기화
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) {
    clearTabState(tabId);
    updateTabState(tabId, { url: info.url });
    pushState(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => clearTabState(tabId));
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/background/index.ts
git commit -m "feat(background): message routing, per-tab store, panel port push"
```

---

## Task 7: 사이드 패널 셸 (React)

**Files:**
- Modify: `src/sidepanel/App.tsx` (Task 1의 최소 셸 교체)

- [ ] **Step 1: 구현 — `src/sidepanel/App.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { PortMessage, TabSessionState, TabId } from '../messaging/types';

const PANEL_TABS = ['검사', '네트워크', '콘솔', '검증', '기록', '리포트'] as const;
type PanelTab = (typeof PANEL_TABS)[number];

export function App() {
  const [state, setState] = useState<TabSessionState | null>(null);
  const [active, setActive] = useState<PanelTab>('검사');
  const [tabId, setTabId] = useState<TabId | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    let cancelled = false;
    let port: chrome.runtime.Port | undefined;

    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (cancelled || tab?.id == null) return;
      setTabId(tab.id);
      port = chrome.runtime.connect({ name: 'qaxtension-panel' });
      portRef.current = port;
      port.onMessage.addListener((msg: PortMessage) => {
        if (msg.type === 'STATE_UPDATE') setState(msg.state);
      });
      port.postMessage({ type: 'SUBSCRIBE', tabId: tab.id } satisfies PortMessage);
    });

    return () => {
      cancelled = true;
      port?.disconnect();
      portRef.current = null;
    };
  }, []);

  const ping = () => {
    if (portRef.current && tabId != null) {
      portRef.current.postMessage({ type: 'PING', tabId } satisfies PortMessage);
    }
  };

  return (
    <div style={{ font: '13px system-ui', padding: 12 }}>
      <header style={{ marginBottom: 12 }}>
        <strong>QA Companion</strong>
        <div
          data-testid="status"
          style={{ marginTop: 4, color: state?.injectReady ? 'green' : '#999' }}
        >
          {state?.injectReady ? '주입됨 ✓' : '대기 중…'}
        </div>
        <div style={{ fontSize: 11, color: '#666', wordBreak: 'break-all' }}>
          {state?.url ?? ''}
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={ping}>Ping</button>
          {state?.lastPingNonce && (
            <span data-testid="pong" style={{ marginLeft: 8 }}>
              pong: {state.lastPingNonce}
            </span>
          )}
        </div>
      </header>

      <nav style={{ display: 'flex', gap: 4, borderBottom: '1px solid #eee', marginBottom: 8 }}>
        {PANEL_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setActive(t)}
            style={{ fontWeight: active === t ? 700 : 400 }}
          >
            {t}
          </button>
        ))}
      </nav>

      <main>
        <p style={{ color: '#999' }}>{active} 패널 — Phase 0 셸 (기능은 이후 Phase에서 구현)</p>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 단위 테스트 전체 통과 확인**

Run: `npm test`
Expected: messaging(3) + store(3) 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(sidepanel): shell with connection status, ping, tab nav"
```

---

## Task 8: e2e 스모크 테스트 (inject + content 파이프라인)

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/smoke.spec.ts`

> 참고: Chrome 사이드 패널 UI 자체는 브라우저 크롬 영역이라 Playwright로 자동화하기 어렵다. 본 Task는 `inject(MAIN) → content(ISOLATED)` 파이프라인이 실제 페이지에서 동작하는지 자동 검증한다. 사이드 패널 UI 및 양방향 Ping은 Task 9의 수동 검증으로 확인한다.

- [ ] **Step 1: `playwright.config.ts` 작성**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
});
```

- [ ] **Step 2: `e2e/smoke.spec.ts` 작성**

```ts
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
```

- [ ] **Step 3: 빌드 후 e2e 실행**

Run: `npm run build && npm run e2e`
Expected: 1 test passed. (실패 시 — 확장 로드 권한/headless 이슈면 `headless: false` 유지 및 로컬 디스플레이 환경 확인. CI는 `xvfb-run npm run e2e` 사용.)

- [ ] **Step 4: 커밋**

```bash
git add playwright.config.ts e2e/smoke.spec.ts
git commit -m "test(e2e): smoke test for inject+content pipeline"
```

---

## Task 9: 수동 검증 + README + 푸시

**Files:**
- Create: `README.md`

- [ ] **Step 1: 사이드 패널 양방향 수동 검증**

1. `npm run build`
2. Chrome → `chrome://extensions` → 개발자 모드 ON → "압축해제된 확장 프로그램 로드" → `dist/` 선택
3. 임의의 https 페이지(예: `https://example.com`)로 이동
4. 툴바의 QA Companion 아이콘 클릭 → 사이드 패널이 열린다
5. 상태가 **"주입됨 ✓"** 로 표시되고 현재 URL이 보인다 (inject→content→background→panel 정방향 확인)
6. **Ping** 버튼 클릭 → `pong: <nonce>` 가 표시된다 (panel→background→content→inject→응답 역방향 확인)
7. 페이지를 새로고침하면 상태가 초기화 후 다시 "주입됨 ✓" 로 돌아온다

체크: 위 6·7 항목이 모두 통과해야 Phase 0 완료.

- [ ] **Step 2: `README.md` 작성**

```markdown
# QA Companion

비개발자를 위한 웹 서비스 QA 유틸리티 Chrome 익스텐션 (Manifest V3).

## 개발

\`\`\`bash
npm install
npm run dev      # CRXJS 개발 모드 (HMR)
npm run build    # dist/ 프로덕션 빌드
npm test         # 단위 테스트 (vitest)
npm run e2e      # e2e 스모크 (playwright)
\`\`\`

## 설치 (개발)

1. \`npm run build\`
2. \`chrome://extensions\` → 개발자 모드 ON → "압축해제된 확장 프로그램 로드" → \`dist/\`

## 상태

- [x] Phase 0 — 토대 (빌드, 사이드 패널 셸, 메시지 파이프라인)
- [ ] Phase 1 — 요소·스타일 검사기
- [ ] Phase 2 — API 모니터
- [ ] Phase 3 — 콘솔/에러 수집
- [ ] Phase 4 — 증거 & 리포트
- [ ] Phase 5 — 추가 검증
- [ ] Phase 6 — 행동 기록

설계: \`docs/superpowers/specs/2026-06-04-qa-companion-design.md\`
```

- [ ] **Step 3: 커밋 & 푸시**

```bash
git add README.md
git commit -m "docs: add README with dev/install/status"
git push
```

---

## Phase 0 완료 기준 (Definition of Done)

- `npm run build` 성공, `dist/manifest.json` 생성
- `npm test` — messaging(3) + store(3) 단위 테스트 통과
- `npm run e2e` — inject+content 파이프라인 스모크 통과
- 수동 검증(Task 9 Step 1)의 정방향("주입됨 ✓"·URL)·역방향(Ping→pong)·초기화(새로고침) 모두 통과
- 모든 커밋 `main`에 푸시 완료
