# JIRA 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QA 데이터를 기반으로 JIRA Cloud 이슈를 사이드 패널에서 자동 생성한다(설정·생성 UI 포함).

**Architecture:** 순수 모듈 3개(`integrations/jira/{client,mapping,settings}.ts`)로 로직을 분리하고, background가 `JIRA_*` 메시지로 이들을 묶어 fetch를 실행(CORS 회피). UI는 헤더 ⚙️ 설정 화면 + 리포트 탭 생성 섹션. 순수 모듈은 fetch/storage 주입으로 vitest 단위 테스트.

**Tech Stack:** TypeScript, React 19, MV3(CRXJS+Vite), vitest, JIRA REST API v3, ADF.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/messaging/types.ts` (수정) | `JiraConfig`·`JiraProject`·`JiraIssueType`·`AdfDoc`·`JiraIssueResult` 타입 + `RuntimeMessage`에 `JIRA_*` 추가 |
| `src/integrations/jira/settings.ts` (신규) | `chrome.storage.local` 설정 CRUD (storage area 주입 가능) |
| `src/integrations/jira/mapping.ts` (신규) | `ReportInput` → 제목 제안 + ADF 설명 + 이슈 페이로드 (순수) |
| `src/integrations/jira/client.ts` (신규) | JIRA REST v3 호출 (fetch 주입, 순수) |
| `src/background/index.ts` (수정) | `JIRA_*` 메시지 핸들러 — settings 로드 + client 호출 |
| `src/sidepanel/SettingsPanel.tsx` (신규) | 헤더 ⚙️ → 설정 화면 (사이트·이메일·토큰·연결 테스트·저장) |
| `src/sidepanel/App.tsx` (수정) | 헤더 ⚙️ 버튼 + `view` 상태('main'\|'settings') |
| `src/sidepanel/JiraCreateSection.tsx` (신규) | 리포트 탭 "JIRA 티켓 생성" 섹션 |
| `src/sidepanel/ReportPanel.tsx` (수정) | `JiraCreateSection` 삽입 |
| `tests/jira-settings.test.ts`·`tests/jira-mapping.test.ts`·`tests/jira-client.test.ts` (신규) | 단위 테스트 |

---

## Task 1: 타입 정의

**Files:**
- Modify: `src/messaging/types.ts` (끝에 추가 + `RuntimeMessage` union 확장)

- [ ] **Step 1: JIRA 도메인 타입 추가**

`src/messaging/types.ts` 파일 끝에 추가:

```typescript
// ── JIRA 연동 ──────────────────────────────────────────────
export interface JiraConfig {
  /** 예: https://acme.atlassian.net (끝 슬래시 없음) */
  site: string;
  email: string;
  token: string;
  defaultProjectId?: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
}

/** Atlassian Document Format 최소 타입 */
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
}
export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

export interface JiraCreatePayload {
  projectId: string;
  issueTypeId: string;
  summary: string;
  /** 주석 적용된 스크린샷 dataURL (없으면 null) */
  screenshot: string | null;
  /** 리포트 데이터 (설명 ADF 빌드용) */
  report: ReportInput;
}

export interface JiraIssueResult {
  key: string;
  url: string;
  screenshotAttached: boolean;
}
```

- [ ] **Step 2: RuntimeMessage union에 JIRA 메시지 추가**

`src/messaging/types.ts`의 `export type RuntimeMessage =` union(라인 408 부근)에 멤버 추가:

```typescript
  | { type: 'JIRA_TEST'; config: JiraConfig }
  | { type: 'JIRA_TEST_RESULT'; ok: boolean; displayName?: string; error?: string }
  | { type: 'JIRA_LIST_PROJECTS' }
  | { type: 'JIRA_PROJECTS_RESULT'; projects: JiraProject[]; error?: string }
  | { type: 'JIRA_LIST_ISSUETYPES'; projectId: string }
  | { type: 'JIRA_ISSUETYPES_RESULT'; issueTypes: JiraIssueType[]; error?: string }
  | { type: 'JIRA_CREATE'; payload: JiraCreatePayload }
  | { type: 'JIRA_CREATE_RESULT'; result?: JiraIssueResult; error?: string }
```

- [ ] **Step 3: 타입 컴파일 확인**

Run: `npx tsc -b`
Expected: 에러 없음(타입만 추가, 기존 코드 영향 없음).

- [ ] **Step 4: Commit**

```bash
git add src/messaging/types.ts
git commit -m "feat(jira): 연동 도메인 타입 + JIRA_* 메시지"
```

---

## Task 2: settings.ts (설정 저장/로드)

**Files:**
- Create: `src/integrations/jira/settings.ts`
- Test: `tests/jira-settings.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/jira-settings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { loadSettings, saveSettings, clearSettings, type StorageArea } from '../src/integrations/jira/settings';
import type { JiraConfig } from '../src/messaging/types';

/** chrome.storage.local.get/set/remove 를 흉내내는 fake */
function fakeArea(initial: Record<string, unknown> = {}): StorageArea {
  let store: Record<string, unknown> = { ...initial };
  return {
    get: async (key) => ({ [key]: store[key] }),
    set: async (items) => { store = { ...store, ...items }; },
    remove: async (key) => { delete store[key]; },
  };
}

const cfg: JiraConfig = { site: 'https://acme.atlassian.net', email: 'a@b.com', token: 't0ken' };

describe('jira settings', () => {
  it('저장 후 로드하면 같은 값을 돌려준다', async () => {
    const area = fakeArea();
    await saveSettings(cfg, area);
    expect(await loadSettings(area)).toEqual(cfg);
  });

  it('저장된 값이 없으면 null', async () => {
    expect(await loadSettings(fakeArea())).toBeNull();
  });

  it('clear 후 로드하면 null', async () => {
    const area = fakeArea();
    await saveSettings(cfg, area);
    await clearSettings(area);
    expect(await loadSettings(area)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/jira-settings.test.ts`
Expected: FAIL — `Cannot find module '../src/integrations/jira/settings'`.

- [ ] **Step 3: 구현**

`src/integrations/jira/settings.ts`:

```typescript
import type { JiraConfig } from '../../messaging/types';

const KEY = 'jiraConfig';

/** chrome.storage.local 의 필요한 부분만 추상화(테스트 주입용) */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

function defaultArea(): StorageArea {
  return chrome.storage.local as unknown as StorageArea;
}

export async function loadSettings(area: StorageArea = defaultArea()): Promise<JiraConfig | null> {
  const got = await area.get(KEY);
  const v = got[KEY];
  return v ? (v as JiraConfig) : null;
}

export async function saveSettings(cfg: JiraConfig, area: StorageArea = defaultArea()): Promise<void> {
  await area.set({ [KEY]: cfg });
}

export async function clearSettings(area: StorageArea = defaultArea()): Promise<void> {
  await area.remove(KEY);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/jira-settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/jira/settings.ts tests/jira-settings.test.ts
git commit -m "feat(jira): 설정 저장/로드 (chrome.storage.local)"
```

---

## Task 3: mapping.ts (리포트 → 이슈 페이로드)

**Files:**
- Create: `src/integrations/jira/mapping.ts`
- Test: `tests/jira-mapping.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/jira-mapping.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { suggestTitle, buildDescriptionADF, buildIssueFields } from '../src/integrations/jira/mapping';
import type { ReportInput, RequestRecord, LogRecord } from '../src/messaging/types';

function emptyInput(over: Partial<ReportInput> = {}): ReportInput {
  return {
    generatedAt: 0, env: null, pickedElement: null,
    requests: [], logs: [], steps: [], screenshot: null, ...over,
  };
}
function failReq(): RequestRecord {
  return {
    id: 'r1', source: 'fetch', method: 'POST', url: 'https://api.test/login',
    status: 500, statusText: 'Error', ok: false, error: null,
    durationMs: 12, startedAt: 0, requestBody: null, responseBody: null,
  } as RequestRecord;
}
function errLog(text: string): LogRecord {
  return { id: 'l1', level: 'error', source: 'console', text, count: 1, firstAt: 0, lastAt: 0 } as LogRecord;
}

describe('suggestTitle', () => {
  it('실패 API 가 있으면 그 정보로 제목', () => {
    expect(suggestTitle(emptyInput({ requests: [failReq()] })))
      .toBe('[QA] POST /login 500');
  });
  it('실패 API 없고 콘솔 에러 있으면 첫 에러', () => {
    expect(suggestTitle(emptyInput({ logs: [errLog('TypeError: x is undefined')] })))
      .toBe('[QA] TypeError: x is undefined');
  });
  it('둘 다 없으면 URL 기반', () => {
    expect(suggestTitle(emptyInput({ env: { url: 'https://shop.test/cart' } as ReportInput['env'] })))
      .toBe('[QA] https://shop.test/cart 이슈');
  });
});

describe('buildDescriptionADF', () => {
  it('doc/version 형태이며 실패 API 섹션을 포함', () => {
    const adf = buildDescriptionADF(emptyInput({ requests: [failReq()] }));
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    const json = JSON.stringify(adf);
    expect(json).toContain('실패한 API');
    expect(json).toContain('/login');
  });
  it('데이터 없으면 빈 안내 문단만', () => {
    const adf = buildDescriptionADF(emptyInput());
    expect(adf.content.length).toBeGreaterThan(0);
  });
});

describe('buildIssueFields', () => {
  it('project/issuetype/summary/labels 를 구성하고 qa-companion 라벨 포함', () => {
    const fields = buildIssueFields({
      projectId: '10001', issueTypeId: '10002', summary: '제목',
      screenshot: null, report: emptyInput(),
    });
    expect(fields.project).toEqual({ id: '10001' });
    expect(fields.issuetype).toEqual({ id: '10002' });
    expect(fields.summary).toBe('제목');
    expect(fields.labels).toContain('qa-companion');
    expect(fields.description.type).toBe('doc');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/jira-mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`src/integrations/jira/mapping.ts`:

```typescript
import type {
  ReportInput, AdfDoc, AdfNode, JiraCreatePayload,
} from '../../messaging/types';

/** path 만 추출 (실패 시 원본) */
function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

export function suggestTitle(input: ReportInput): string {
  const fail = input.requests.find((r) => r.ok === false || r.error != null || (r.status != null && r.status >= 400));
  if (fail) return `[QA] ${fail.method} ${pathOf(fail.url)} ${fail.status ?? '오류'}`;
  const err = input.logs.find((l) => l.level === 'error');
  if (err) return `[QA] ${err.text.slice(0, 80)}`;
  const url = input.env?.url;
  return url ? `[QA] ${url} 이슈` : '[QA] 이슈';
}

// ── ADF 헬퍼 ──
const text = (s: string): AdfNode => ({ type: 'text', text: s });
const para = (s: string): AdfNode => ({ type: 'paragraph', content: [text(s)] });
const heading = (s: string): AdfNode => ({ type: 'heading', attrs: { level: 3 }, content: [text(s)] });
const bullet = (items: string[]): AdfNode => ({
  type: 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [para(i)] })),
});

export function buildDescriptionADF(input: ReportInput): AdfDoc {
  const content: AdfNode[] = [];

  if (input.env) {
    content.push(heading('환경'));
    content.push(bullet([
      `URL: ${input.env.url ?? '(알 수 없음)'}`,
      `OS: ${input.env.os}`,
      `뷰포트: ${input.env.viewport.width}×${input.env.viewport.height}`,
      `언어: ${input.env.language}`,
    ]));
  }

  const fails = input.requests.filter((r) => r.ok === false || r.error != null);
  if (fails.length) {
    content.push(heading('실패한 API'));
    content.push(bullet(fails.map((r) => `${r.status ?? r.error ?? '오류'} ${r.method} ${pathOf(r.url)}`)));
  }

  const errors = input.logs.filter((l) => l.level === 'error' || l.level === 'warn');
  if (errors.length) {
    content.push(heading('콘솔 에러·경고'));
    content.push(bullet(errors.map((l) => `[${l.level}] ${l.text.slice(0, 200)}`)));
  }

  if (input.pickedElement) {
    content.push(heading('검사한 요소'));
    content.push(bullet([
      `셀렉터: ${input.pickedElement.selector}`,
      input.pickedElement.text ? `텍스트: ${input.pickedElement.text}` : '텍스트: —',
    ]));
  }

  if (input.steps.length) {
    content.push(heading('재현 절차'));
    content.push({
      type: 'orderedList',
      content: input.steps.map((s) => ({
        type: 'listItem',
        content: [para(`${s.kind}: ${s.selector ?? ''} ${s.value ?? ''}`.trim())],
      })),
    });
  }

  if (content.length === 0) content.push(para('첨부된 분석 데이터가 없습니다.'));
  return { type: 'doc', version: 1, content };
}

export interface JiraFields {
  project: { id: string };
  issuetype: { id: string };
  summary: string;
  description: AdfDoc;
  labels: string[];
}

export function buildIssueFields(payload: JiraCreatePayload): JiraFields {
  return {
    project: { id: payload.projectId },
    issuetype: { id: payload.issueTypeId },
    summary: payload.summary,
    description: buildDescriptionADF(payload.report),
    labels: ['qa-companion'],
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/jira-mapping.test.ts`
Expected: PASS. 만약 `Step`/`ElementInfo`/`EnvInfo` 필드명이 실제 타입과 다르면 `src/messaging/types.ts`에서 확인해 맞춘다(예: `s.value`가 없으면 실제 필드명으로 교체).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/jira/mapping.ts tests/jira-mapping.test.ts
git commit -m "feat(jira): 리포트→제목 제안·ADF 설명·이슈 필드 매핑"
```

---

## Task 4: client.ts (JIRA REST 클라이언트)

**Files:**
- Create: `src/integrations/jira/client.ts`
- Test: `tests/jira-client.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/jira-client.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  authHeader, testConnection, listProjects, listIssueTypes, createIssue,
} from '../src/integrations/jira/client';
import type { JiraConfig } from '../src/messaging/types';

const cfg: JiraConfig = { site: 'https://acme.atlassian.net', email: 'a@b.com', token: 't0ken' };

/** 호출 1건을 기록하고 지정 응답을 돌려주는 fake fetch */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fn, calls };
}

describe('authHeader', () => {
  it('Basic base64(email:token)', () => {
    expect(authHeader(cfg)).toBe('Basic ' + btoa('a@b.com:t0ken'));
  });
});

describe('testConnection', () => {
  it('200 이면 ok=true + displayName', async () => {
    const { fn, calls } = fakeFetch(200, { displayName: '홍길동' });
    const res = await testConnection(cfg, fn);
    expect(res.ok).toBe(true);
    expect(res.displayName).toBe('홍길동');
    expect(calls[0].url).toBe('https://acme.atlassian.net/rest/api/3/myself');
  });
  it('401 이면 ok=false', async () => {
    const { fn } = fakeFetch(401, {});
    expect((await testConnection(cfg, fn)).ok).toBe(false);
  });
});

describe('listProjects', () => {
  it('values 를 JiraProject[] 로 매핑', async () => {
    const { fn, calls } = fakeFetch(200, { values: [{ id: '1', key: 'QA', name: 'QA 프로젝트' }] });
    const projects = await listProjects(cfg, fn);
    expect(projects).toEqual([{ id: '1', key: 'QA', name: 'QA 프로젝트' }]);
    expect(calls[0].url).toContain('/rest/api/3/project/search');
  });
});

describe('listIssueTypes', () => {
  it('subtask 를 제외하고 매핑', async () => {
    const { fn } = fakeFetch(200, { issueTypes: [
      { id: '10', name: '버그', subtask: false },
      { id: '11', name: '하위작업', subtask: true },
    ]});
    expect(await listIssueTypes(cfg, '1', fn)).toEqual([{ id: '10', name: '버그' }]);
  });
});

describe('createIssue', () => {
  it('POST /issue 후 key·url 반환', async () => {
    const { fn, calls } = fakeFetch(201, { key: 'QA-7' });
    const res = await createIssue(cfg, { project: { id: '1' }, issuetype: { id: '10' }, summary: 's', description: { type: 'doc', version: 1, content: [] }, labels: [] }, fn);
    expect(res.key).toBe('QA-7');
    expect(res.url).toBe('https://acme.atlassian.net/browse/QA-7');
    expect(calls[0].init?.method).toBe('POST');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/jira-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`src/integrations/jira/client.ts`:

```typescript
import type { JiraConfig, JiraProject, JiraIssueType } from '../../messaging/types';
import type { JiraFields } from './mapping';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function authHeader(cfg: JiraConfig): string {
  return 'Basic ' + btoa(`${cfg.email}:${cfg.token}`);
}

function jsonHeaders(cfg: JiraConfig): Record<string, string> {
  return { Authorization: authHeader(cfg), Accept: 'application/json', 'Content-Type': 'application/json' };
}

/** 끝 슬래시 제거한 base */
function base(cfg: JiraConfig): string {
  return cfg.site.replace(/\/+$/, '');
}

export async function testConnection(
  cfg: JiraConfig, fetchFn: FetchLike = fetch,
): Promise<{ ok: boolean; displayName?: string }> {
  const res = await fetchFn(`${base(cfg)}/rest/api/3/myself`, { headers: jsonHeaders(cfg) });
  if (!res.ok) return { ok: false };
  const body = (await res.json()) as { displayName?: string };
  return { ok: true, displayName: body.displayName };
}

export async function listProjects(cfg: JiraConfig, fetchFn: FetchLike = fetch): Promise<JiraProject[]> {
  const res = await fetchFn(`${base(cfg)}/rest/api/3/project/search?maxResults=50`, { headers: jsonHeaders(cfg) });
  if (!res.ok) throw new Error(`프로젝트 조회 실패 (${res.status})`);
  const body = (await res.json()) as { values: JiraProject[] };
  return body.values.map((p) => ({ id: p.id, key: p.key, name: p.name }));
}

export async function listIssueTypes(cfg: JiraConfig, projectId: string, fetchFn: FetchLike = fetch): Promise<JiraIssueType[]> {
  const res = await fetchFn(`${base(cfg)}/rest/api/3/project/${projectId}`, { headers: jsonHeaders(cfg) });
  if (!res.ok) throw new Error(`이슈타입 조회 실패 (${res.status})`);
  const body = (await res.json()) as { issueTypes?: { id: string; name: string; subtask: boolean }[] };
  return (body.issueTypes ?? []).filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name }));
}

export async function createIssue(
  cfg: JiraConfig, fields: JiraFields, fetchFn: FetchLike = fetch,
): Promise<{ key: string; url: string }> {
  const res = await fetchFn(`${base(cfg)}/rest/api/3/issue`, {
    method: 'POST', headers: jsonHeaders(cfg), body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`이슈 생성 실패 (${res.status}) ${t.slice(0, 200)}`);
  }
  const body = (await res.json()) as { key: string };
  return { key: body.key, url: `${base(cfg)}/browse/${body.key}` };
}

/** dataURL → Blob */
function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function attachScreenshot(
  cfg: JiraConfig, issueKey: string, dataUrl: string, fetchFn: FetchLike = fetch,
): Promise<boolean> {
  const form = new FormData();
  form.append('file', dataUrlToBlob(dataUrl), 'screenshot.png');
  const res = await fetchFn(`${base(cfg)}/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: { Authorization: authHeader(cfg), 'X-Atlassian-Token': 'no-check' },
    body: form,
  });
  return res.ok;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/jira-client.test.ts`
Expected: PASS. (`btoa`/`atob`/`Response`/`FormData`/`Blob`은 Node 18+ 전역에 존재.)

- [ ] **Step 5: Commit**

```bash
git add src/integrations/jira/client.ts tests/jira-client.test.ts
git commit -m "feat(jira): REST v3 클라이언트 (연결·프로젝트·이슈타입·생성·첨부)"
```

---

## Task 5: background JIRA 핸들러

**Files:**
- Modify: `src/background/index.ts` (패널 메시지 핸들러에 `JIRA_*` case 추가)

- [ ] **Step 1: import 추가**

`src/background/index.ts` 상단 import 블록에 추가:

```typescript
import { loadSettings } from '../integrations/jira/settings';
import { testConnection, listProjects, listIssueTypes, createIssue, attachScreenshot } from '../integrations/jira/client';
import { buildIssueFields } from '../integrations/jira/mapping';
```

- [ ] **Step 2: 패널 onMessage 핸들러에 JIRA case 추가**

`src/background/index.ts`의 패널 메시지를 처리하는 `else if (msg.type === ...)` 체인(라인 342 부근, `RECORD_SET_ACTIVE` 근처)에 이어서 추가. 패널은 포트로 응답을 받으므로 각 결과를 `port.postMessage`로 회신한다(해당 핸들러가 속한 `port` 변수 사용):

```typescript
    } else if (msg.type === 'JIRA_TEST') {
      void testConnection(msg.config)
        .then((r) => port.postMessage({ type: 'JIRA_TEST_RESULT', ok: r.ok, displayName: r.displayName } satisfies RuntimeMessage))
        .catch((e: unknown) => port.postMessage({ type: 'JIRA_TEST_RESULT', ok: false, error: String(e) } satisfies RuntimeMessage));
    } else if (msg.type === 'JIRA_LIST_PROJECTS') {
      void loadSettings().then((cfg) => {
        if (!cfg) return port.postMessage({ type: 'JIRA_PROJECTS_RESULT', projects: [], error: 'JIRA 설정이 없습니다' } satisfies RuntimeMessage);
        return listProjects(cfg)
          .then((projects) => port.postMessage({ type: 'JIRA_PROJECTS_RESULT', projects } satisfies RuntimeMessage))
          .catch((e: unknown) => port.postMessage({ type: 'JIRA_PROJECTS_RESULT', projects: [], error: String(e) } satisfies RuntimeMessage));
      });
    } else if (msg.type === 'JIRA_LIST_ISSUETYPES') {
      void loadSettings().then((cfg) => {
        if (!cfg) return port.postMessage({ type: 'JIRA_ISSUETYPES_RESULT', issueTypes: [], error: 'JIRA 설정이 없습니다' } satisfies RuntimeMessage);
        return listIssueTypes(cfg, msg.projectId)
          .then((issueTypes) => port.postMessage({ type: 'JIRA_ISSUETYPES_RESULT', issueTypes } satisfies RuntimeMessage))
          .catch((e: unknown) => port.postMessage({ type: 'JIRA_ISSUETYPES_RESULT', issueTypes: [], error: String(e) } satisfies RuntimeMessage));
      });
    } else if (msg.type === 'JIRA_CREATE') {
      void loadSettings().then(async (cfg) => {
        if (!cfg) return port.postMessage({ type: 'JIRA_CREATE_RESULT', error: 'JIRA 설정이 없습니다' } satisfies RuntimeMessage);
        try {
          const fields = buildIssueFields(msg.payload);
          const { key, url } = await createIssue(cfg, fields);
          let screenshotAttached = false;
          if (msg.payload.screenshot) {
            screenshotAttached = await attachScreenshot(cfg, key, msg.payload.screenshot).catch(() => false);
          }
          port.postMessage({ type: 'JIRA_CREATE_RESULT', result: { key, url, screenshotAttached } } satisfies RuntimeMessage);
        } catch (e) {
          port.postMessage({ type: 'JIRA_CREATE_RESULT', error: String(e) } satisfies RuntimeMessage);
        }
      });
    }
```

> 주의: 위 코드는 패널 포트 핸들러(`port.onMessage.addListener` 내부, `port` 가 스코프에 있는 곳)에 넣어야 한다. `RECORD_SET_ACTIVE` 등이 처리되는 그 블록이다.

- [ ] **Step 3: PortMessage 타입에도 JIRA 메시지 허용 확인**

패널↔background 포트가 `PortMessage`를 쓰면(라인 478) JIRA 메시지가 양방향으로 흐르도록 `PortMessage` union에도 `JIRA_*`를 포함시킨다. 이미 `RuntimeMessage`로 통합돼 있다면 생략. `src/messaging/types.ts`에서 패널이 보내는/받는 메시지 타입을 확인하고, 필요하면 `PortMessage`에 다음을 추가:

```typescript
  | { type: 'JIRA_TEST'; config: JiraConfig }
  | { type: 'JIRA_TEST_RESULT'; ok: boolean; displayName?: string; error?: string }
  | { type: 'JIRA_LIST_PROJECTS' }
  | { type: 'JIRA_PROJECTS_RESULT'; projects: JiraProject[]; error?: string }
  | { type: 'JIRA_LIST_ISSUETYPES'; projectId: string }
  | { type: 'JIRA_ISSUETYPES_RESULT'; issueTypes: JiraIssueType[]; error?: string }
  | { type: 'JIRA_CREATE'; payload: JiraCreatePayload }
  | { type: 'JIRA_CREATE_RESULT'; result?: JiraIssueResult; error?: string }
```

- [ ] **Step 4: 빌드 확인**

Run: `npx tsc -b`
Expected: 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add src/background/index.ts src/messaging/types.ts
git commit -m "feat(jira): background JIRA_* 핸들러 (settings+client 연결)"
```

---

## Task 6: SettingsPanel + 헤더 ⚙️

**Files:**
- Create: `src/sidepanel/SettingsPanel.tsx`
- Modify: `src/sidepanel/App.tsx` (헤더 ⚙️ 버튼 + `view` 상태 + JIRA 메시지 처리)

- [ ] **Step 1: SettingsPanel 구현**

`src/sidepanel/SettingsPanel.tsx`:

```typescript
import { useEffect, useState } from 'react';
import type { JiraConfig } from '../messaging/types';
import { loadSettings, saveSettings } from '../integrations/jira/settings';

interface Props {
  onBack: () => void;
  /** 연결 테스트 요청 — background 로 JIRA_TEST 전송. 결과는 testResult prop 으로 받음 */
  onTest: (config: JiraConfig) => void;
  testResult: { ok: boolean; displayName?: string; error?: string } | null;
  testing: boolean;
}

export function SettingsPanel({ onBack, onTest, testResult, testing }: Props) {
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadSettings().then((cfg) => {
      if (cfg) { setSite(cfg.site); setEmail(cfg.email); setToken(cfg.token); }
    });
  }, []);

  const normalizedSite = site.trim().replace(/\/+$/, '');
  const config: JiraConfig = { site: normalizedSite, email: email.trim(), token: token.trim() };
  const filled = config.site && config.email && config.token;

  const save = () => {
    void saveSettings(config).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); });
  };

  return (
    <div className="app">
      <header className="app-header">
        <button onClick={onBack}>← 뒤로</button>
        <div className="app-title" style={{ marginTop: 8 }}>⚙️ 설정</div>
      </header>
      <section style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 12 }}>JIRA 연결</h3>
        <p style={{ fontSize: 11, color: 'var(--fg-subtle)', margin: '4px 0 8px' }}>
          API 토큰은{' '}
          <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">
            Atlassian 계정 설정
          </a>
          에서 발급합니다.
        </p>
        <label style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>
          사이트
          <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://회사.atlassian.net"
            style={{ width: '100%', marginTop: 2 }} />
        </label>
        <label style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>
          이메일
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
            style={{ width: '100%', marginTop: 2 }} />
        </label>
        <label style={{ display: 'block', fontSize: 11, marginBottom: 8 }}>
          API 토큰
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="토큰 붙여넣기"
            style={{ width: '100%', marginTop: 2 }} />
        </label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => onTest(config)} disabled={!filled || testing}>
            {testing ? '확인 중…' : '연결 테스트'}
          </button>
          <button onClick={save} disabled={!filled}>{saved ? '저장됨 ✓' : '저장'}</button>
        </div>
        {testResult && (
          <p style={{ fontSize: 11, marginTop: 6, color: testResult.ok ? 'var(--success)' : 'var(--danger)' }}>
            {testResult.ok ? `🟢 연결됨${testResult.displayName ? ` — ${testResult.displayName}` : ''}` : `🔴 실패: ${testResult.error ?? '인증 확인'}`}
          </p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: App.tsx에 view 상태 + ⚙️ 버튼 + JIRA_TEST 처리 배선**

`src/sidepanel/App.tsx` 수정:
1. 상태 추가: `const [view, setView] = useState<'main' | 'settings'>('main');` 그리고 `const [jiraTest, setJiraTest] = useState<{ok:boolean;displayName?:string;error?:string}|null>(null);` `const [jiraTesting, setJiraTesting] = useState(false);`
2. 포트 `onMessage` 리스너에 추가: `else if (msg.type === 'JIRA_TEST_RESULT') { setJiraTesting(false); setJiraTest({ ok: msg.ok, displayName: msg.displayName, error: msg.error }); }`
3. 헤더 `.app-title` 옆에 ⚙️ 버튼:

```tsx
<div className="app-title">
  <span className="logo">🧪</span> QA Companion
  <button onClick={() => setView('settings')} title="설정" style={{ marginLeft: 'auto', border: 'none', background: 'none', fontSize: 15, cursor: 'pointer' }}>⚙️</button>
</div>
```
(`.app-title`에 `width: 100%`가 필요하면 인라인으로 `style={{ width: '100%' }}` 추가)

4. 렌더 최상단 분기:

```tsx
if (view === 'settings') {
  return (
    <SettingsPanel
      onBack={() => setView('main')}
      onTest={(config) => {
        setJiraTest(null); setJiraTesting(true);
        portRef.current?.postMessage({ type: 'JIRA_TEST', config } satisfies PortMessage);
      }}
      testResult={jiraTest}
      testing={jiraTesting}
    />
  );
}
```
5. import 추가: `import { SettingsPanel } from './SettingsPanel';`

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc -b && npm run build`
Expected: 에러 없음.

- [ ] **Step 4: 수동 확인(선택) + 단위 그린**

Run: `npm test`
Expected: 기존 + 신규 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/SettingsPanel.tsx src/sidepanel/App.tsx
git commit -m "feat(jira): 헤더 ⚙️ 설정 화면 — 연결 입력·테스트·저장"
```

---

## Task 7: 리포트 탭 JIRA 생성 섹션

**Files:**
- Create: `src/sidepanel/JiraCreateSection.tsx`
- Modify: `src/sidepanel/ReportPanel.tsx` (섹션 삽입 + JIRA 메시지 props 배선)
- Modify: `src/sidepanel/App.tsx` (JIRA 프로젝트/이슈타입/생성 결과 상태 + ReportPanel 에 전달)

- [ ] **Step 1: JiraCreateSection 구현**

`src/sidepanel/JiraCreateSection.tsx`:

```typescript
import { useEffect, useState } from 'react';
import type { JiraProject, JiraIssueType, JiraIssueResult, ReportInput } from '../messaging/types';
import { suggestTitle } from '../integrations/jira/mapping';

interface Props {
  report: ReportInput;
  screenshot: string | null;
  projects: JiraProject[];
  issueTypes: JiraIssueType[];
  result: JiraIssueResult | null;
  error: string | null;
  busy: boolean;
  onLoadProjects: () => void;
  onSelectProject: (projectId: string) => void;
  onCreate: (projectId: string, issueTypeId: string, summary: string) => void;
}

export function JiraCreateSection(props: Props) {
  const { report, projects, issueTypes, result, error, busy } = props;
  const [projectId, setProjectId] = useState('');
  const [issueTypeId, setIssueTypeId] = useState('');
  const [summary, setSummary] = useState('');

  // 섹션이 열리면 프로젝트 로드 + 제목 자동 제안
  useEffect(() => { props.onLoadProjects(); setSummary(suggestTitle(report)); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (projectId) { props.onSelectProject(projectId); setIssueTypeId(''); } /* eslint-disable-next-line */ }, [projectId]);

  return (
    <section style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <h3 style={{ fontSize: 12, margin: '0 0 6px' }}>🎫 JIRA 티켓 생성</h3>

      <label style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>
        프로젝트
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ width: '100%', marginTop: 2 }}>
          <option value="">선택…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.key})</option>)}
        </select>
      </label>

      <label style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>
        이슈 타입
        <select value={issueTypeId} onChange={(e) => setIssueTypeId(e.target.value)} disabled={!projectId} style={{ width: '100%', marginTop: 2 }}>
          <option value="">선택…</option>
          {issueTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>

      <label style={{ display: 'block', fontSize: 11, marginBottom: 8 }}>
        제목
        <input value={summary} onChange={(e) => setSummary(e.target.value)} style={{ width: '100%', marginTop: 2 }} />
      </label>

      <button
        type="button"
        disabled={!projectId || !issueTypeId || !summary || busy}
        onClick={() => props.onCreate(projectId, issueTypeId, summary)}
        style={{ fontWeight: 700 }}
      >
        {busy ? '생성 중…' : '티켓 생성'}
      </button>

      {result && (
        <p style={{ fontSize: 11, marginTop: 6, color: 'var(--success)' }}>
          ✅ 생성됨: <a href={result.url} target="_blank" rel="noreferrer">{result.key}</a>
          {result.screenshotAttached ? ' · 스크린샷 첨부됨' : ''}
        </p>
      )}
      {error && <p style={{ fontSize: 11, marginTop: 6, color: 'var(--danger)' }}>🔴 {error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: App.tsx에 JIRA 프로젝트/이슈타입/생성 상태 + 핸들러**

`src/sidepanel/App.tsx`:
1. 상태:
```tsx
const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
const [jiraIssueTypes, setJiraIssueTypes] = useState<JiraIssueType[]>([]);
const [jiraResult, setJiraResult] = useState<JiraIssueResult | null>(null);
const [jiraError, setJiraError] = useState<string | null>(null);
const [jiraBusy, setJiraBusy] = useState(false);
```
2. 포트 onMessage 리스너에 추가:
```tsx
else if (msg.type === 'JIRA_PROJECTS_RESULT') { setJiraProjects(msg.projects); if (msg.error) setJiraError(msg.error); }
else if (msg.type === 'JIRA_ISSUETYPES_RESULT') { setJiraIssueTypes(msg.issueTypes); if (msg.error) setJiraError(msg.error); }
else if (msg.type === 'JIRA_CREATE_RESULT') { setJiraBusy(false); setJiraResult(msg.result ?? null); setJiraError(msg.error ?? null); }
```
3. import: `import type { JiraProject, JiraIssueType, JiraIssueResult } from '../messaging/types';`
4. `<ReportPanel>` 에 props 전달:
```tsx
jiraProjects={jiraProjects}
jiraIssueTypes={jiraIssueTypes}
jiraResult={jiraResult}
jiraError={jiraError}
jiraBusy={jiraBusy}
onJiraLoadProjects={() => { setJiraError(null); portRef.current?.postMessage({ type: 'JIRA_LIST_PROJECTS' } satisfies PortMessage); }}
onJiraSelectProject={(projectId) => portRef.current?.postMessage({ type: 'JIRA_LIST_ISSUETYPES', projectId } satisfies PortMessage)}
onJiraCreate={(projectId, issueTypeId, summary) => {
  setJiraBusy(true); setJiraResult(null); setJiraError(null);
  const report: ReportInput = { generatedAt: Date.now(), env: state?.env ?? null, pickedElement: state?.pickedElement ?? null, requests: state?.requests ?? [], logs: state?.logs ?? [], steps: state?.steps ?? [], screenshot };
  portRef.current?.postMessage({ type: 'JIRA_CREATE', payload: { projectId, issueTypeId, summary, screenshot, report } } satisfies PortMessage);
}}
```
> `ReportInput`·`screenshot`는 이미 ReportPanel 에서 쓰는 값과 동일하게 구성한다. `ReportInput` import 가 없으면 추가.

- [ ] **Step 3: ReportPanel에 섹션 삽입**

`src/sidepanel/ReportPanel.tsx`:
1. Props 인터페이스에 추가: `jiraProjects`, `jiraIssueTypes`, `jiraResult`, `jiraError`, `jiraBusy`, `onJiraLoadProjects`, `onJiraSelectProject`, `onJiraCreate` (타입은 `JiraCreateSection` Props와 동일).
2. import: `import { JiraCreateSection } from './JiraCreateSection';`
3. 컴포넌트 반환부의 "요약 + 내보내기" 섹션 다음에 삽입:
```tsx
<JiraCreateSection
  report={reportInput()}
  screenshot={screenshot}
  projects={jiraProjects}
  issueTypes={jiraIssueTypes}
  result={jiraResult}
  error={jiraError}
  busy={jiraBusy}
  onLoadProjects={onJiraLoadProjects}
  onSelectProject={onJiraSelectProject}
  onCreate={onJiraCreate}
/>
```

- [ ] **Step 4: 빌드 + 테스트 확인**

Run: `npx tsc -b && npm run build && npm test`
Expected: 빌드 에러 없음, 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/JiraCreateSection.tsx src/sidepanel/ReportPanel.tsx src/sidepanel/App.tsx
git commit -m "feat(jira): 리포트 탭 티켓 생성 섹션 (프로젝트·이슈타입·제목→생성)"
```

---

## Task 8: 통합 dogfooding (선택, 수동)

**Files:** 없음 (수동 검증)

- [ ] **Step 1:** 실제 JIRA Cloud 테스트 사이트 + API 토큰으로 dogfooding. dist 빌드 후 Chrome 로드 → ⚙️ 설정 입력 → 연결 테스트 🟢 → 리포트 탭에서 데이터 모은 뒤 프로젝트/이슈타입 선택 → 생성 → 실제 이슈 생성 + 스크린샷 첨부 확인.
- [ ] **Step 2:** 에러 경로 확인: 잘못된 토큰(401), 권한 없는 프로젝트(403).
- [ ] **Step 3:** 메모리 업데이트(JIRA 연동 완료) + push.

---

## Self-Review (작성자 체크 완료)

- **Spec coverage:** 설정(Task 6)·client(Task 4)·mapping(Task 3)·settings(Task 2)·background(Task 5)·생성 UI(Task 7)·타입(Task 1)·테스트(각 Task) — 스펙 전 항목 커버.
- **Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. 에러 처리 구체화(401/403/미설정).
- **Type consistency:** `JiraConfig`/`JiraFields`/`JiraCreatePayload`/`JiraIssueResult` 가 Task 1 정의와 이후 사용처에서 일치. `buildIssueFields`·`createIssue`·`attachScreenshot` 시그니처 일관.
- **주의 사항(실행 시 확인):** ① `RequestRecord`/`LogRecord`/`Step`/`EnvInfo`/`ElementInfo` 의 실제 필드명을 `types.ts`에서 확인해 mapping/test 의 필드 접근을 맞출 것(예: `r.startedAt`, `l.firstAt`, `s.value` 가 실제와 다를 수 있음). ② 패널↔background 가 `PortMessage`를 쓰는지 `RuntimeMessage`를 쓰는지 확인해 JIRA 메시지를 올바른 union에 추가할 것.
