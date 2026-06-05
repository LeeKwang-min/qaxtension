# QA Companion — Phase 2 (API 모니터) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 페이지가 호출한 API(fetch/XHR)를 자동 포착해 사이드 패널 **네트워크** 탭에 리스트(메서드·URL·상태·소요시간·시각)·실패 테이블·트리맵·요청/응답 본문으로 보여준다.

**Architecture:** 네트워크 캡처는 페이지의 `window.fetch`/`XMLHttpRequest`를 가로채야 하므로 MAIN-world `inject`에서 후킹한다(원본 보존 + try/catch fail-open). 후킹은 요청 시작 시 `NET_START`, 완료/실패 시 `NET_END` 두 이벤트를 `InjectEnvelope`로 발신하고, `content`가 `chrome.runtime`으로 중계, `background`가 tabId별 store에 `RequestRecord[]`로 upsert(시작=신규, 종료=갱신)한 뒤 Port로 패널에 push한다. 본문 절단·레코드 빌드·트리맵 집계 등 변환 로직은 순수 모듈 `src/capture/network.ts`로 분리해 단위 테스트한다.

**Tech Stack:** TypeScript, React, Vite/CRXJS, Vitest(node + jsdom), Playwright.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/messaging/types.ts` | (수정) `RequestRecord`/`BodyCapture`/`NetStart`/`NetEnd`/`TreemapCell` 타입, 메시지·상태 확장 |
| `src/background/store.ts` | (수정) `createDefault`에 `requests: []` 추가 |
| `src/capture/network.ts` | (신규) 본문 절단·레코드 빌드·종료 병합·상한 push·실패 필터·트리맵 집계 (순수) |
| `src/inject/index.ts` | (수정) `window.fetch`/`XMLHttpRequest` 후킹 → `NET_START`/`NET_END` 발신 |
| `src/content/index.ts` | (수정) `NET_START`/`NET_END` 중계 |
| `src/background/index.ts` | (수정) 네트워크 메시지 라우팅 + store upsert, `NETWORK_CLEAR` 처리 |
| `src/sidepanel/NetworkPanel.tsx` | (신규) 네트워크 탭 UI (리스트·실패·트리맵·본문 상세) |
| `src/sidepanel/App.tsx` | (수정) 네트워크 탭에 NetworkPanel 연결 + clear 핸들러 |
| `src/manifest.ts` | (수정 없음 — 확인만) 추가 권한 불필요 (fetch/XHR 후킹은 content_scripts MAIN world로 충분) |
| `tests/network.test.ts` | (신규) 순수 모듈 단위 테스트 |
| `tests/store.test.ts` | (수정) `requests` 기본값 테스트 추가 |
| `e2e/network.spec.ts` | (신규) fetch/XHR 캡처 e2e |

---

## Task 1: 타입 & store 확장

**Files:**
- Modify: `src/messaging/types.ts`
- Modify: `src/background/store.ts`
- Test: `tests/store.test.ts` (기존 파일에 추가)

- [ ] **Step 1: `src/messaging/types.ts` 에 네트워크 타입 추가**

`export type TabId = number;` 바로 아래(`ColorInfo` 인터페이스 위)에 추가:
```ts
/** 요청/응답 본문 캡처 (대용량은 절단) */
export interface BodyCapture {
  /** 절단됐을 수 있는 본문 텍스트 */
  text: string;
  /** 절단 여부 (UI 표시용) */
  truncated: boolean;
  /** 원본 길이(문자 수) */
  size: number;
  /** content-type 헤더 (없으면 null) */
  contentType: string | null;
}

/** 네트워크 요청 출처 */
export type NetworkSource = 'fetch' | 'xhr';

/** inject 가 요청 시작 시 보내는 페이로드 */
export interface NetStart {
  id: string;
  source: NetworkSource;
  method: string;
  url: string;
  startedAt: number; // epoch ms
  requestBody: BodyCapture | null;
}

/** inject 가 요청 완료/실패 시 보내는 페이로드 (부분 갱신) */
export interface NetEnd {
  status?: number;
  statusText?: string;
  ok?: boolean;
  durationMs?: number;
  responseBody?: BodyCapture | null;
  /** 네트워크 오류/CORS 차단 시 메시지 (성공이면 없음) */
  error?: string;
}

/** 정규화된 네트워크 요청 레코드 (store/패널 표시 단위) */
export interface RequestRecord {
  id: string;
  source: NetworkSource;
  method: string;
  url: string;
  /** 진행 중이거나 네트워크 오류면 null */
  status: number | null;
  statusText: string | null;
  /** 2xx~3xx 면 true, 4xx/5xx 면 false, 진행 중/오류면 null */
  ok: boolean | null;
  /** 네트워크 오류/CORS 메시지 (없으면 null) */
  error: string | null;
  startedAt: number;
  durationMs: number | null;
  requestBody: BodyCapture | null;
  responseBody: BodyCapture | null;
}

/** 트리맵 타일 한 칸 (host 또는 path 그룹 집계) */
export interface TreemapCell {
  /** 그룹 라벨 (host 또는 첫 path 세그먼트) */
  key: string;
  count: number;
  errorCount: number;
  /** 0~1 */
  errorRate: number;
  /** 응답 본문 합계(문자 수) */
  bytes: number;
}
```

- [ ] **Step 2: 같은 파일에서 `InjectEnvelope`/`RuntimeMessage`/`PortMessage`/`TabSessionState` 확장**

`InjectEnvelope` 인터페이스의 `payload` union 을 다음으로 교체:
```ts
  payload:
    | { type: 'INJECT_READY' }
    | { type: 'PING_REPLY'; nonce: string }
    | { type: 'NET_START'; record: NetStart }
    | { type: 'NET_END'; id: string; end: NetEnd };
```

`RuntimeMessage` union 끝(`| { type: 'PICK_CANCELLED' };` 다음)에 분기를 추가 — 전체를 다음으로 교체:
```ts
/** chrome.runtime 메시지 (content↔background 양방향 공유 union) */
export type RuntimeMessage =
  | { type: 'INJECT_READY' }
  | { type: 'PING_REPLY'; nonce: string }
  | { type: 'PING'; nonce: string }
  | { type: 'RESYNC' }
  // background → content: 요소 피커 제어
  | { type: 'PICK_START' }
  | { type: 'PICK_STOP' }
  // content → background: 피커 결과
  | { type: 'ELEMENT_PICKED'; info: ElementInfo }
  | { type: 'PICK_CANCELLED' }
  // content → background: 네트워크 캡처 중계
  | { type: 'NET_START'; record: NetStart }
  | { type: 'NET_END'; id: string; end: NetEnd };
```

`TabSessionState` 인터페이스를 다음으로 교체(`requests` 추가):
```ts
/** tabId별 세션 상태 */
export interface TabSessionState {
  tabId: TabId;
  url: string | null;
  injectReady: boolean;
  lastPingNonce: string | null;
  picking: boolean;
  pickedElement: ElementInfo | null;
  requests: RequestRecord[];
  updatedAt: number;
}
```

`PortMessage` union 을 다음으로 교체(`NETWORK_CLEAR` 추가):
```ts
/** 사이드 패널 ↔ background 의 long-lived Port 메시지 */
export type PortMessage =
  | { type: 'SUBSCRIBE'; tabId: TabId }
  | { type: 'PING'; tabId: TabId }
  // 패널 → background: 요소 피커 토글
  | { type: 'PICK_START'; tabId: TabId }
  | { type: 'PICK_STOP'; tabId: TabId }
  // 패널 → background: 네트워크 기록 초기화
  | { type: 'NETWORK_CLEAR'; tabId: TabId }
  | { type: 'STATE_UPDATE'; state: TabSessionState };
```

- [ ] **Step 3: `tests/store.test.ts` 의 기본값 테스트에 한 줄 추가 (실패 우선)**

`creates default state on first access` 테스트의 expect 들 끝(`expect(s.pickedElement).toBeNull();` 다음 줄)에 추가:
```ts
    expect(s.requests).toEqual([]);
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — `s.requests` 가 `undefined` (createDefault 미확장).

- [ ] **Step 5: `src/background/store.ts` 의 `createDefault` 확장**

`createDefault` 함수를 다음으로 교체:
```ts
function createDefault(tabId: TabId): TabSessionState {
  return {
    tabId,
    url: null,
    injectReady: false,
    lastPingNonce: null,
    picking: false,
    pickedElement: null,
    requests: [],
    updatedAt: Date.now(),
  };
}
```

- [ ] **Step 6: 테스트 통과 + 빌드 확인**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: exit 0 (union 확장이 기존 소비처와 충돌 없는지 확인).

- [ ] **Step 7: 커밋**

```bash
git add src/messaging/types.ts src/background/store.ts tests/store.test.ts
git commit -m "feat(types): add RequestRecord/BodyCapture/NetStart/NetEnd, network messages, requests state"
```

---

## Task 2: 네트워크 변환 순수 모듈

**Files:**
- Create: `src/capture/network.ts`
- Test: `tests/network.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/network.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  captureBody,
  recordFromStart,
  applyEnd,
  pushBounded,
  failedRequests,
  treemapCells,
  MAX_BODY,
  MAX_REQUESTS,
} from '../src/capture/network';
import type { NetStart, RequestRecord } from '../src/messaging/types';

function start(over: Partial<NetStart> = {}): NetStart {
  return {
    id: 'r1',
    source: 'fetch',
    method: 'GET',
    url: 'https://api.example.com/users',
    startedAt: 1000,
    requestBody: null,
    ...over,
  };
}

describe('captureBody', () => {
  it('returns null for null input', () => {
    expect(captureBody(null, null)).toBeNull();
  });
  it('keeps short bodies intact', () => {
    const b = captureBody('hello', 'text/plain');
    expect(b).toEqual({ text: 'hello', truncated: false, size: 5, contentType: 'text/plain' });
  });
  it('truncates bodies over MAX_BODY and flags truncated', () => {
    const big = 'x'.repeat(MAX_BODY + 10);
    const b = captureBody(big, null)!;
    expect(b.truncated).toBe(true);
    expect(b.text.length).toBe(MAX_BODY);
    expect(b.size).toBe(MAX_BODY + 10);
    expect(b.contentType).toBeNull();
  });
});

describe('recordFromStart', () => {
  it('builds a pending record (status/ok null)', () => {
    const r = recordFromStart(start());
    expect(r.id).toBe('r1');
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://api.example.com/users');
    expect(r.status).toBeNull();
    expect(r.ok).toBeNull();
    expect(r.error).toBeNull();
    expect(r.durationMs).toBeNull();
    expect(r.responseBody).toBeNull();
  });
});

describe('applyEnd', () => {
  it('fills status/ok/duration on success', () => {
    const r = recordFromStart(start());
    const done = applyEnd(r, { status: 200, statusText: 'OK', ok: true, durationMs: 42, responseBody: null });
    expect(done.status).toBe(200);
    expect(done.ok).toBe(true);
    expect(done.durationMs).toBe(42);
  });
  it('records 4xx as not ok', () => {
    const r = recordFromStart(start());
    const done = applyEnd(r, { status: 404, statusText: 'Not Found', ok: false, durationMs: 5 });
    expect(done.status).toBe(404);
    expect(done.ok).toBe(false);
  });
  it('records network error (status stays null)', () => {
    const r = recordFromStart(start());
    const done = applyEnd(r, { error: 'network error or CORS', durationMs: 7 });
    expect(done.status).toBeNull();
    expect(done.error).toBe('network error or CORS');
  });
});

describe('pushBounded', () => {
  it('appends a new record by id', () => {
    const list = pushBounded([], recordFromStart(start()));
    expect(list).toHaveLength(1);
  });
  it('replaces an existing record with the same id (upsert)', () => {
    const a = recordFromStart(start({ id: 'dup' }));
    let list = pushBounded([], a);
    const b = { ...recordFromStart(start({ id: 'dup' })), method: 'POST' };
    list = pushBounded(list, b);
    expect(list).toHaveLength(1);
    expect(list[0].method).toBe('POST');
  });
  it('caps the list at MAX_REQUESTS (drops oldest)', () => {
    let list: RequestRecord[] = [];
    for (let i = 0; i < MAX_REQUESTS + 5; i++) {
      list = pushBounded(list, recordFromStart(start({ id: `r${i}` })));
    }
    expect(list).toHaveLength(MAX_REQUESTS);
    // 가장 오래된 r0..r4 가 밀려나고 r5 가 맨 앞
    expect(list[0].id).toBe('r5');
  });
});

describe('failedRequests', () => {
  it('returns 4xx/5xx and network errors only', () => {
    const ok = applyEnd(recordFromStart(start({ id: 'ok' })), { status: 200, ok: true, durationMs: 1 });
    const notFound = applyEnd(recordFromStart(start({ id: 'nf' })), { status: 404, ok: false, durationMs: 1 });
    const err = applyEnd(recordFromStart(start({ id: 'er' })), { error: 'boom', durationMs: 1 });
    const pending = recordFromStart(start({ id: 'pd' }));
    const fails = failedRequests([ok, notFound, err, pending]);
    expect(fails.map((r) => r.id).sort()).toEqual(['er', 'nf']);
  });
});

describe('treemapCells', () => {
  it('groups by host with count, errorRate, bytes', () => {
    const recs: RequestRecord[] = [
      applyEnd(recordFromStart(start({ id: '1', url: 'https://a.com/x' })), { status: 200, ok: true, durationMs: 1, responseBody: { text: 'ab', truncated: false, size: 2, contentType: null } }),
      applyEnd(recordFromStart(start({ id: '2', url: 'https://a.com/y' })), { status: 500, ok: false, durationMs: 1 }),
      applyEnd(recordFromStart(start({ id: '3', url: 'https://b.com/z' })), { status: 200, ok: true, durationMs: 1 }),
    ];
    const cells = treemapCells(recs);
    const a = cells.find((c) => c.key === 'a.com')!;
    expect(a.count).toBe(2);
    expect(a.errorCount).toBe(1);
    expect(a.errorRate).toBeCloseTo(0.5, 5);
    expect(a.bytes).toBe(2);
    const b = cells.find((c) => c.key === 'b.com')!;
    expect(b.count).toBe(1);
    expect(b.errorRate).toBe(0);
  });
  it('sorts cells by count descending', () => {
    const recs: RequestRecord[] = [
      recordFromStart(start({ id: '1', url: 'https://solo.com/a' })),
      recordFromStart(start({ id: '2', url: 'https://many.com/a' })),
      recordFromStart(start({ id: '3', url: 'https://many.com/b' })),
    ];
    const cells = treemapCells(recs);
    expect(cells[0].key).toBe('many.com');
  });
  it('uses a fallback label for unparseable urls', () => {
    const recs = [recordFromStart(start({ id: '1', url: 'not a url' }))];
    const cells = treemapCells(recs);
    expect(cells[0].key).toBe('(기타)');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/network.test.ts`
Expected: FAIL — `../src/capture/network` 모듈 없음.

- [ ] **Step 3: 구현 — `src/capture/network.ts`**

```ts
import type { BodyCapture, NetEnd, NetStart, RequestRecord, TreemapCell } from '../messaging/types';

/** 본문 절단 상한 (문자 수) — 설계상 기본 32KB */
export const MAX_BODY = 32 * 1024;
/** tabId별 보관 요청 상한 (메모리 보호) */
export const MAX_REQUESTS = 500;

/** 본문 문자열을 절단 가능한 BodyCapture 로. null 이면 null. */
export function captureBody(text: string | null, contentType: string | null): BodyCapture | null {
  if (text == null) return null;
  const size = text.length;
  const truncated = size > MAX_BODY;
  return {
    text: truncated ? text.slice(0, MAX_BODY) : text,
    truncated,
    size,
    contentType,
  };
}

/** NET_START → 진행 중 RequestRecord */
export function recordFromStart(s: NetStart): RequestRecord {
  return {
    id: s.id,
    source: s.source,
    method: s.method,
    url: s.url,
    status: null,
    statusText: null,
    ok: null,
    error: null,
    startedAt: s.startedAt,
    durationMs: null,
    requestBody: s.requestBody,
    responseBody: null,
  };
}

/** 진행 중 레코드에 NET_END 를 병합한 새 레코드 반환 (불변) */
export function applyEnd(r: RequestRecord, e: NetEnd): RequestRecord {
  return {
    ...r,
    status: e.status ?? r.status,
    statusText: e.statusText ?? r.statusText,
    ok: e.ok ?? r.ok,
    error: e.error ?? r.error,
    durationMs: e.durationMs ?? r.durationMs,
    responseBody: e.responseBody ?? r.responseBody,
  };
}

/** id 로 upsert + 상한 유지(초과 시 가장 오래된 것부터 제거). 불변 반환. */
export function pushBounded(list: RequestRecord[], rec: RequestRecord): RequestRecord[] {
  const idx = list.findIndex((r) => r.id === rec.id);
  let next: RequestRecord[];
  if (idx >= 0) {
    next = list.slice();
    next[idx] = rec;
  } else {
    next = [...list, rec];
  }
  if (next.length > MAX_REQUESTS) {
    next = next.slice(next.length - MAX_REQUESTS);
  }
  return next;
}

/** 4xx/5xx 또는 네트워크 오류만 (진행 중·성공 제외) */
export function failedRequests(list: RequestRecord[]): RequestRecord[] {
  return list.filter((r) => r.error != null || (r.status != null && r.status >= 400));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || '(기타)';
  } catch {
    return '(기타)';
  }
}

/** host 그룹별 집계 → 호출 수 내림차순 정렬된 트리맵 셀 */
export function treemapCells(list: RequestRecord[]): TreemapCell[] {
  const map = new Map<string, TreemapCell>();
  for (const r of list) {
    const key = hostOf(r.url);
    let cell = map.get(key);
    if (!cell) {
      cell = { key, count: 0, errorCount: 0, errorRate: 0, bytes: 0 };
      map.set(key, cell);
    }
    cell.count += 1;
    const isError = r.error != null || (r.status != null && r.status >= 400);
    if (isError) cell.errorCount += 1;
    cell.bytes += r.responseBody?.size ?? 0;
  }
  const cells = Array.from(map.values());
  for (const c of cells) c.errorRate = c.count > 0 ? c.errorCount / c.count : 0;
  cells.sort((a, b) => b.count - a.count);
  return cells;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/network.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/capture/network.ts tests/network.test.ts
git commit -m "feat(capture): network record build/merge/bounded-push/treemap utils (pure)"
```

---

## Task 3: inject 후킹 (fetch/XHR)

**Files:**
- Modify: `src/inject/index.ts`

> 후킹은 페이지의 `window`/`XMLHttpRequest` 전역에 의존해 단위 테스트가 어렵다 → e2e(Task 7)로 검증한다. 본문 절단 등 순수 로직은 Task 2 에서 이미 테스트됨. inject 는 절단된 본문만 발신하기 위해 `captureBody` 를 재사용한다.

- [ ] **Step 1: import 추가 — `src/inject/index.ts` 상단**

기존 import 두 줄을 다음 세 줄로 교체:
```ts
import { INJECT_SOURCE, isCmdEnvelope } from '../messaging';
import type { InjectEnvelope, NetStart, NetEnd } from '../messaging/types';
import { captureBody } from '../capture/network';
```

- [ ] **Step 2: 후킹 블록 추가 — `post({ type: 'INJECT_READY' });` 다음 줄에 삽입**

기존 `// 준비 신호 발신` / `post({ type: 'INJECT_READY' });` 두 줄 **바로 다음**에 삽입(아래 `window.addEventListener('message', ...)` 리스너보다 위):
```ts
  // ── 네트워크 캡처 (fetch / XHR) ───────────────────────────
  // 모든 후킹은 try/catch 로 감싸 페이지를 절대 깨뜨리지 않는다(fail-open).
  let netSeq = 0;
  const nextNetId = (): string => {
    netSeq += 1;
    return `net-${Date.now().toString(36)}-${netSeq}`;
  };
  const postStart = (record: NetStart): void => post({ type: 'NET_START', record });
  const postEnd = (id: string, end: NetEnd): void => post({ type: 'NET_END', id, end });

  // fetch 후킹 — 원본 보존
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (
        this: typeof window,
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const id = nextNetId();
        const startedAt = Date.now();
        let method = 'GET';
        let url = '';
        let requestBody = null as ReturnType<typeof captureBody>;
        try {
          if (input instanceof Request) {
            method = (init?.method ?? input.method ?? 'GET').toUpperCase();
            url = input.url;
          } else {
            method = (init?.method ?? 'GET').toUpperCase();
            url = String(input);
          }
          const body = init?.body;
          if (typeof body === 'string') requestBody = captureBody(body, null);
        } catch {
          /* fail-open: 메타 추출 실패해도 호출은 진행 */
        }
        try {
          postStart({ id, source: 'fetch', method, url, startedAt, requestBody });
        } catch {
          /* 발신 실패 무시 */
        }
        let p: Promise<Response>;
        try {
          p = origFetch.call(this, input as RequestInfo, init);
        } catch (e) {
          try {
            postEnd(id, { error: String(e), durationMs: Date.now() - startedAt });
          } catch {
            /* 무시 */
          }
          throw e;
        }
        return p.then(
          (response) => {
            // 응답 본문은 clone 으로 읽어 원본 스트림을 소비하지 않는다.
            try {
              const ct = response.headers.get('content-type');
              response
                .clone()
                .text()
                .then((text) => {
                  try {
                    postEnd(id, {
                      status: response.status,
                      statusText: response.statusText,
                      ok: response.ok,
                      durationMs: Date.now() - startedAt,
                      responseBody: captureBody(text, ct),
                    });
                  } catch {
                    /* 무시 */
                  }
                })
                .catch(() => {
                  // 본문 못 읽어도 상태/타이밍은 보낸다
                  try {
                    postEnd(id, {
                      status: response.status,
                      statusText: response.statusText,
                      ok: response.ok,
                      durationMs: Date.now() - startedAt,
                      responseBody: null,
                    });
                  } catch {
                    /* 무시 */
                  }
                });
            } catch {
              /* 무시 */
            }
            return response;
          },
          (err) => {
            try {
              postEnd(id, { error: String(err), durationMs: Date.now() - startedAt });
            } catch {
              /* 무시 */
            }
            throw err;
          },
        );
      } as typeof window.fetch;
    }
  } catch {
    /* fetch 후킹 실패 — 페이지 영향 없음 */
  }

  // XHR 후킹 — open/send 오버라이드
  try {
    interface QaxXhr extends XMLHttpRequest {
      __qaxNet?: { id: string; method: string; url: string; startedAt: number };
    }
    const proto = XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;

    proto.open = function (
      this: QaxXhr,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ): void {
      try {
        this.__qaxNet = {
          id: nextNetId(),
          method: String(method).toUpperCase(),
          url: String(url),
          startedAt: 0,
        };
      } catch {
        /* 무시 */
      }
      // 가변 인자 시그니처를 보존해 그대로 전달
      return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof proto.open;

    proto.send = function (this: QaxXhr, body?: Document | XMLHttpRequestBodyInit | null): void {
      const meta = this.__qaxNet;
      if (meta) {
        meta.startedAt = Date.now();
        let requestBody = null as ReturnType<typeof captureBody>;
        try {
          if (typeof body === 'string') requestBody = captureBody(body, null);
        } catch {
          /* 무시 */
        }
        try {
          postStart({
            id: meta.id,
            source: 'xhr',
            method: meta.method,
            url: meta.url,
            startedAt: meta.startedAt,
            requestBody,
          });
        } catch {
          /* 무시 */
        }
        try {
          this.addEventListener('loadend', () => {
            try {
              const status = this.status;
              const durationMs = Date.now() - meta.startedAt;
              if (status === 0) {
                // status 0 = 네트워크 오류 또는 CORS 차단
                postEnd(meta.id, { error: 'network error or CORS', durationMs });
                return;
              }
              let responseBody = null as ReturnType<typeof captureBody>;
              try {
                if (this.responseType === '' || this.responseType === 'text') {
                  responseBody = captureBody(this.responseText, this.getResponseHeader('content-type'));
                }
              } catch {
                /* 본문 못 읽어도 상태는 보냄 */
              }
              postEnd(meta.id, {
                status,
                statusText: this.statusText,
                ok: status >= 200 && status < 400,
                durationMs,
                responseBody,
              });
            } catch {
              /* 무시 */
            }
          });
        } catch {
          /* 무시 */
        }
      }
      return (origSend as (b?: Document | XMLHttpRequestBodyInit | null) => void).call(this, body);
    } as typeof proto.send;
  } catch {
    /* XHR 후킹 실패 — 페이지 영향 없음 */
  }
```

- [ ] **Step 3: 빌드 + 기존 테스트 확인**

Run: `npm run build`
Expected: exit 0.
Run: `npm test`
Expected: 기존 단위 테스트 전부 통과 (이 task 는 단위 테스트 추가 없음 — e2e 는 Task 7).

- [ ] **Step 4: 커밋**

```bash
git add src/inject/index.ts
git commit -m "feat(inject): hook fetch/XHR, emit NET_START/NET_END (fail-open)"
```

---

## Task 4: content 중계

**Files:**
- Modify: `src/content/index.ts`

- [ ] **Step 1: `window.addEventListener('message', ...)` 의 inject→background 중계에 NET 분기 추가**

기존 리스너의 `else if (payload.type === 'PING_REPLY') { ... }` 블록 **다음**에 분기 두 개를 추가(전체 `if/else if` 체인을 다음으로 교체):
```ts
  if (payload.type === 'INJECT_READY') {
    // e2e 관측용 마킹
    document.documentElement.dataset.qaxtensionContent = 'ready';
    const msg: RuntimeMessage = { type: 'INJECT_READY' };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (payload.type === 'PING_REPLY') {
    const msg: RuntimeMessage = { type: 'PING_REPLY', nonce: payload.nonce };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (payload.type === 'NET_START') {
    const msg: RuntimeMessage = { type: 'NET_START', record: payload.record };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (payload.type === 'NET_END') {
    const msg: RuntimeMessage = { type: 'NET_END', id: payload.id, end: payload.end };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  }
```

- [ ] **Step 2: 빌드 + 단위 테스트 확인**

Run: `npm run build`
Expected: exit 0.
Run: `npm test`
Expected: 전부 통과.

- [ ] **Step 3: 커밋**

```bash
git add src/content/index.ts
git commit -m "feat(content): relay NET_START/NET_END to background"
```

---

## Task 5: background 라우팅 + store upsert

**Files:**
- Modify: `src/background/index.ts`

- [ ] **Step 1: import 에 순수 헬퍼 추가 — `src/background/index.ts` 상단**

기존 import 두 줄을 다음으로 교체:
```ts
import { getTabState, updateTabState, clearTabState } from './store';
import type { RuntimeMessage, PortMessage, TabId } from '../messaging/types';
import { recordFromStart, applyEnd, pushBounded } from '../capture/network';
```

- [ ] **Step 2: content→background 라우팅에 NET 분기 추가**

`chrome.runtime.onMessage.addListener` 의 `switch (msg.type)` 안, `case 'PICK_CANCELLED'` 블록 다음에 추가:
```ts
    case 'NET_START': {
      const state = getTabState(tabId);
      updateTabState(tabId, { requests: pushBounded(state.requests, recordFromStart(msg.record)) });
      pushState(tabId);
      break;
    }
    case 'NET_END': {
      const state = getTabState(tabId);
      const next = state.requests.map((r) => (r.id === msg.id ? applyEnd(r, msg.end) : r));
      updateTabState(tabId, { requests: next });
      pushState(tabId);
      break;
    }
```

- [ ] **Step 3: 패널→background Port 라우팅에 `NETWORK_CLEAR` 분기 추가**

`port.onMessage.addListener` 안의 마지막 분기(`else if (msg.type === 'PICK_STOP') { ... }`) **다음**에 추가:
```ts
    } else if (msg.type === 'NETWORK_CLEAR') {
      updateTabState(msg.tabId, { requests: [] });
      pushState(msg.tabId);
```

(즉 `... } else if (msg.type === 'PICK_STOP') { ...기존... } else if (msg.type === 'NETWORK_CLEAR') { ...신규... }` 형태가 된다.)

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: exit 0.
Run: `npm test`
Expected: 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/background/index.ts
git commit -m "feat(background): upsert network records into store, handle NETWORK_CLEAR"
```

---

## Task 6: 사이드 패널 네트워크 UI

**Files:**
- Create: `src/sidepanel/NetworkPanel.tsx`
- Modify: `src/sidepanel/App.tsx`

- [ ] **Step 1: 구현 — `src/sidepanel/NetworkPanel.tsx`**

```tsx
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { RequestRecord } from '../messaging/types';
import { failedRequests, treemapCells } from '../capture/network';

interface Props {
  requests: RequestRecord[];
  injectReady: boolean;
  onClear: () => void;
}

/** host 만 잘라 표시 (긴 URL 축약용) */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function statusColor(r: RequestRecord): string {
  if (r.error != null) return '#b00020';
  if (r.status == null) return '#999'; // 진행 중
  if (r.status >= 500) return '#b00020';
  if (r.status >= 400) return '#c47f00';
  return '#0a7d28';
}

function statusLabel(r: RequestRecord): string {
  if (r.error != null) return '오류';
  if (r.status == null) return '…';
  return String(r.status);
}

/** 에러율(0~1) → 녹→적 배경색 */
function heatColor(rate: number): string {
  const hue = Math.round(120 - 120 * rate); // 120=녹, 0=적
  return `hsl(${hue}, 70%, 45%)`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12 }}>
      <span style={{ minWidth: 72, color: '#666' }}>{label}</span>
      <span style={{ wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}

function BodyBlock({ title, body }: { title: string; body: RequestRecord['requestBody'] }) {
  if (!body) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: '#666' }}>
        {title}
        {body.contentType ? ` · ${body.contentType}` : ''}
        {body.truncated ? ` · 절단됨 (원본 ${body.size}자)` : ''}
      </div>
      <pre
        style={{
          margin: '2px 0 0',
          padding: 6,
          background: '#f6f6f6',
          fontSize: 11,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 160,
          overflow: 'auto',
        }}
      >
        {body.text || '(빈 본문)'}
      </pre>
    </div>
  );
}

export function NetworkPanel({ requests, injectReady, onClear }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fails = failedRequests(requests);
  const cells = treemapCells(requests);
  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const maxCount = cells.reduce((m, c) => Math.max(m, c.count), 0) || 1;

  if (!injectReady && requests.length === 0) {
    return (
      <p style={{ color: '#999', fontSize: 12 }}>
        페이지가 연결되면 호출한 API 가 여기에 표시됩니다. 연결되지 않으면 페이지를 새로고침하세요.
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#666' }}>
          총 {requests.length}건 · 실패 {fails.length}건
        </span>
        <button onClick={onClear} disabled={requests.length === 0}>
          초기화
        </button>
      </div>

      {requests.length === 0 && (
        <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>
          아직 포착된 요청이 없습니다. 페이지에서 API 를 호출해 보세요.
        </p>
      )}

      {cells.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#333' }}>트리맵 (호스트별)</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {cells.map((c) => (
              <div
                key={c.key}
                title={`${c.key} · ${c.count}건 · 에러 ${Math.round(c.errorRate * 100)}%`}
                style={{
                  flexGrow: c.count,
                  flexBasis: `${Math.max(20, (c.count / maxCount) * 100)}px`,
                  minWidth: 56,
                  height: 44,
                  background: heatColor(c.errorRate),
                  color: '#fff',
                  borderRadius: 3,
                  padding: 4,
                  fontSize: 10,
                  overflow: 'hidden',
                }}
              >
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.key}
                </div>
                <div>{c.count}건 · {Math.round(c.errorRate * 100)}%</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {fails.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#b00020' }}>실패 ({fails.length})</h3>
          {fails.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              style={{ cursor: 'pointer', fontSize: 11, padding: '2px 0', color: '#b00020', wordBreak: 'break-all' }}
            >
              <strong>{statusLabel(r)}</strong> {r.method} {shortUrl(r.url)}
            </div>
          ))}
        </section>
      )}

      {requests.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#333' }}>요청 ({requests.length})</h3>
          <div>
            {requests.map((r) => (
              <div
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'baseline',
                  padding: '3px 4px',
                  fontSize: 11,
                  cursor: 'pointer',
                  background: r.id === selectedId ? '#eef4ff' : 'transparent',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <span style={{ color: statusColor(r), fontWeight: 700, minWidth: 30 }}>{statusLabel(r)}</span>
                <span style={{ minWidth: 36, color: '#555' }}>{r.method}</span>
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{shortUrl(r.url)}</span>
                <span style={{ color: '#999', minWidth: 44, textAlign: 'right' }}>
                  {r.durationMs != null ? `${r.durationMs}ms` : '…'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {selected && (
        <section style={{ marginTop: 12, borderTop: '2px solid #eee', paddingTop: 8 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#333' }}>상세</h3>
          <Field label="메서드">{selected.method}</Field>
          <Field label="URL">{selected.url}</Field>
          <Field label="상태">
            <span style={{ color: statusColor(selected), fontWeight: 700 }}>
              {selected.status ?? '진행 중/오류'} {selected.statusText ?? ''}
            </span>
          </Field>
          {selected.error && <Field label="오류">{selected.error}</Field>}
          <Field label="소요시간">{selected.durationMs != null ? `${selected.durationMs}ms` : '—'}</Field>
          <Field label="출처">{selected.source}</Field>
          <BodyBlock title="요청 본문" body={selected.requestBody} />
          <BodyBlock title="응답 본문" body={selected.responseBody} />
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `src/sidepanel/App.tsx` 수정 — 네트워크 탭 연결 + clear 핸들러**

import 에 추가:
```tsx
import { NetworkPanel } from './NetworkPanel';
```

`togglePick` 함수 정의 **바로 아래**에 clear 핸들러 추가:
```tsx
  const clearNetwork = () => {
    if (!portRef.current || tabId == null) return;
    portRef.current.postMessage({ type: 'NETWORK_CLEAR', tabId } satisfies PortMessage);
  };
```

기존 `<main>` 블록을 다음으로 교체:
```tsx
      <main>
        {active === '검사' ? (
          <InspectPanel
            picking={state?.picking ?? false}
            picked={state?.pickedElement ?? null}
            injectReady={state?.injectReady ?? false}
            onTogglePick={togglePick}
          />
        ) : active === '네트워크' ? (
          <NetworkPanel
            requests={state?.requests ?? []}
            injectReady={state?.injectReady ?? false}
            onClear={clearNetwork}
          />
        ) : (
          <p style={{ color: '#999' }}>{active} 패널 — 이후 Phase에서 구현</p>
        )}
      </main>
```

- [ ] **Step 3: 빌드 + 단위 테스트 확인**

Run: `npm run build`
Expected: exit 0.
Run: `npm test`
Expected: 전부 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/sidepanel/NetworkPanel.tsx src/sidepanel/App.tsx
git commit -m "feat(sidepanel): network monitor tab (list/failures/treemap/body detail)"
```

---

## Task 7: e2e + 수동 검증

**Files:**
- Create: `e2e/network.spec.ts`

- [ ] **Step 1: 작성 — `e2e/network.spec.ts`**

```ts
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
```

- [ ] **Step 2: 빌드 + e2e 실행**

Run: `npm run build && npx playwright test e2e/network.spec.ts`
Expected: 3 passed.
Run: `npx playwright test`
Expected: 모든 e2e 통과 (smoke + resync + inspect + network).

- [ ] **Step 3: 수동 검증 (사용자 확인 항목)**

1. `npm run build` 후 `chrome://extensions` 에서 확장 새로고침.
2. API 를 호출하는 실제 페이지(예: 임의 SPA, 또는 개발자도구 콘솔에서 `fetch('/api/...')`)를 열고 패널의 **네트워크** 탭 열기.
3. 페이지가 호출한 요청이 리스트에 메서드·URL·상태(색)·소요시간으로 쌓이는지.
4. 일부러 404/500 또는 CORS 차단되는 요청을 발생시키면 **실패** 섹션과 트리맵의 빨간 타일에 반영되는지.
5. 행을 클릭하면 **상세**에 요청/응답 본문이 보이고, 32KB 초과 본문은 "절단됨" 표시가 뜨는지.
6. **초기화** 버튼으로 목록이 비워지는지.
7. 페이지 새로고침 시 목록이 자동 초기화되는지(네비게이션 시 store clear).

- [ ] **Step 4: 커밋**

```bash
git add e2e/network.spec.ts
git commit -m "test(e2e): fetch/XHR capture pipeline (NET_START/END, non-destructive)"
```

---

## Task 8: README 상태 갱신

**Files:**
- Modify: `README.md`

- [ ] **Step 1: `README.md` 의 상태 목록에서 Phase 2 줄 갱신**

```md
- [x] **Phase 2 — API 모니터** (fetch/XHR 후킹 → 리스트·실패·트리맵·요청/응답 본문)
```
(기존 `- [ ] Phase 2 — API 모니터` 줄을 위로 교체.)

또한 문서 하단 "문서" 섹션에 한 줄 추가:
```md
- Phase 2 구현 계획: `docs/superpowers/plans/2026-06-05-phase2-api-monitor.md`
```

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: mark Phase 2 (API monitor) complete in README"
```

---

## Phase 2 완료 기준 (Definition of Done)

- `npm run build` 성공
- `npm test` — network / store / colors / element-info / picker / messaging 단위 테스트 전부 통과
- `npm run e2e` — smoke + resync + inspect + network 통과
- 수동 검증(Task 7 Step 3) 통과: 요청 누적 → 실패/트리맵 반영 → 행 클릭 상세(본문·절단표시) → 초기화 → 네비게이션 시 초기화
- 모든 커밋 푸시 완료

## 비범위 (Phase 2 Non-goals)

- **chrome.webRequest 보조 소스 병합** — fetch 가 못 보는 실패(차단/리다이렉트) 보완은 별도 Phase(후속). 본 Phase 는 fetch/XHR(소스 a)만으로 본문까지 포함한 완결 기능을 제공한다.
- 요청 헤더 전체 캡처 — v1 은 본문·상태·타이밍 중심(헤더는 후속).
- WebSocket / EventSource / sendBeacon 캡처 — 범위 외.
- iframe 내부 요청 (manifest `all_frames: false`).
- 트리맵 path 그룹 토글·전송량 토글 — v1 은 host 그룹·호출 수 기준 단일 뷰.
- 본문 JSON 예쁘게 포매팅·검색 — 후속.
- pushState 디바운싱(요청 폭주 시 push 빈도 제어) — 후속(상한 500건으로 메모리만 보호).
```

