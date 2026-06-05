# QA Companion — Phase 5 (추가 자동 검증) Implementation Plan

> **For agentic workers:** TDD(superpowers:test-driven-development) 로 task 별 구현. 순수 audit 스캐너는 jsdom 단위 테스트, 권한/fetch/cookies/windows 는 background 라우팅 + e2e 로 검증. task 별 커밋, main 직접 작업.

**Goal:** spec 기능 E. 페이지를 자동 점검해 비개발자도 알 수 있는 **검증 결과**를 '검증' 탭에 제시한다. 네 갈래:
1. **접근성/색 대비** — alt 누락, 접근가능 이름 없는 버튼/링크, label 없는 입력, html lang 누락, 텍스트 색 대비 위반(WCAG).
2. **깨진 이미지·링크(404)** — 이미지는 DOM `naturalWidth` 즉시 판정, 링크/리소스는 background `fetch` 로 상태코드 검증.
3. **반응형 뷰(뷰포트 프리셋)** — `chrome.windows.update` 로 대상 창을 프리셋 폭으로 리사이즈(+원복).
4. **localStorage / 쿠키 뷰어** — localStorage 는 content, 쿠키는 `chrome.cookies`(httpOnly 포함).

## 착수 결정 (자율, 메모리 "추천대로 진행" 선호)

| 결정 사항 | 선택 | 근거 |
|---|---|---|
| 깨진 링크 스캔 | 이미지=DOM naturalWidth, 링크=background fetch(HEAD→GET fallback) | 이미지는 권한 0 으로 가장 정확. 링크는 기존 `<all_urls>` host 권한으로 cross-origin status 획득. content fetch 는 CORS 로 status 못 봄 → background 가 검증. |
| 반응형 뷰 | `chrome.windows.update` 윈도우 리사이즈 프리셋 | iframe 은 X-Frame-Options/CSP frame-ancestors 로 대부분 차단, `chrome.debugger` 는 spec 비채택("디버깅 중" 배너). 윈도우 리사이즈는 비파괴적·권한 불필요. |
| chrome.cookies 권한 | **추가** | spec 이 httpOnly 쿠키 명시. 쿠키 뷰어의 핵심 가치. host_permissions 는 기존 `<all_urls>` 재사용. |

## Architecture

- **순수 스캐너(`audit/*`):** DOM 루트(또는 입력 배열)를 받아 결과를 반환하는 순수 함수. jsdom 단위 테스트. content 가 실제 `document` 로 호출.
  - `audit/a11y.ts` — `auditA11y(root, getStyle)` → `A11yIssue[]`. 대비 계산은 `inspect/colors.ts` 재사용. `getStyle` 주입으로 jsdom 에서 computed style 모킹 가능(테스트 용이성).
  - `audit/links.ts` — `collectResources(root)` → `ResourceRef[]`(이미지 깨짐 플래그 포함). 순수 수집/정규화. fetch 는 background.
  - `audit/storage.ts` — `toStorageEntries(localStorage 배열, cookie 배열)` → 정렬·민감키 마스킹된 `StorageView`. 순수.
  - `audit/responsive.ts` — `VIEWPORT_PRESETS` 상수 + `classifyViewport(w)` 순수.
- **content:** `RUN_AUDIT` 수신 → `auditA11y` + `collectResources`(이미지 깨짐 즉시 판정) + localStorage 수집 → `AUDIT_RESULT` 발신.
- **background:** `RUN_AUDIT` 라우팅, content 결과 수신 후 (a) `chrome.cookies.getAll({url})` 로 쿠키 보강, (b) `ResourceRef[]` 의 링크를 `fetch`(HEAD, 405/이상 시 GET) 동시성 제한(6)으로 검증 → store `audit` 저장 → push. `RESIZE_WINDOW` 라우팅 → `chrome.windows.update`.
- **상태:** `TabSessionState += audit: AuditResult | null`. 네비게이션 초기화는 기존 clearTabState 가 처리.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/messaging/types.ts` | (수정) `A11yIssue`·`ResourceRef`·`LinkCheck`·`StorageView`·`CookieItem`·`ViewportPreset`·`AuditResult`; 메시지(`RUN_AUDIT`/`AUDIT_RESULT`/`RESIZE_WINDOW`); `TabSessionState += audit` |
| `src/background/store.ts` | (수정) `createDefault` 에 `audit: null` |
| `src/audit/a11y.ts` | (신규, 순수) 접근성/대비 스캐너 |
| `src/audit/links.ts` | (신규, 순수) 리소스 수집 + 이미지 깨짐 판정 + URL 정규화/필터 |
| `src/audit/storage.ts` | (신규, 순수) localStorage+cookie → 정렬·마스킹 뷰 |
| `src/audit/responsive.ts` | (신규, 순수) 뷰포트 프리셋 상수 + 분류 |
| `src/audit/link-check.ts` | (신규, 순수 헬퍼) fetch 결과→`LinkCheck` 매핑, 동시성 풀(주입형 fetch 로 단위 테스트) |
| `src/content/index.ts` | (수정) `RUN_AUDIT` → a11y+resources+localStorage → `AUDIT_RESULT` |
| `src/background/index.ts` | (수정) `RUN_AUDIT` 라우팅, `AUDIT_RESULT` 수신→cookies+링크검증→store, `RESIZE_WINDOW`→windows.update |
| `src/sidepanel/AuditPanel.tsx` | (신규) 4개 섹션 UI(접근성/깨진 리소스/반응형/스토리지) |
| `src/sidepanel/App.tsx` | (수정) '검증' 탭 연결 + runAudit/resizeWindow 핸들러 |
| `src/manifest.ts` | (수정) `cookies` 권한 |
| `tests/audit-a11y.test.ts` | (신규) jsdom 위반 탐지 |
| `tests/audit-links.test.ts` | (신규) 리소스 수집/정규화/깨짐 판정 |
| `tests/audit-link-check.test.ts` | (신규) 주입 fetch 로 상태 매핑·동시성 |
| `tests/audit-storage.test.ts` | (신규) 정렬·마스킹 |
| `tests/audit-responsive.test.ts` | (신규) 프리셋·분류 |
| `tests/store.test.ts` | (수정) `audit: null` 기본값 |
| `e2e/audit.spec.ts` | (신규) RUN_AUDIT 왕복·결과 표시·리사이즈 |

## Task 1: 타입 & store (TDD)
- [ ] 타입: `A11yIssue`(kind·selector·message·severity), `ResourceRef`(kind·url·selector·broken), `LinkCheck`(url·status·ok·error), `CookieItem`(name·value·domain·httpOnly·secure), `StorageView`(local·cookies), `ViewportPreset`(label·width·height), `AuditResult`(a11y·resources·links·storage·ranAt)
- [ ] 메시지: PortMessage += `RUN_AUDIT`/`RESIZE_WINDOW`; RuntimeMessage += `RUN_AUDIT`/`AUDIT_RESULT`; `TabSessionState += audit`
- [ ] store.test `audit: null` 기대(실패) → createDefault 확장 → 통과 → 커밋

## Task 2: audit/a11y.ts 순수 스캐너 (TDD)
- [ ] `auditA11y(root, getStyle)` — img alt 누락, 빈 접근가능 이름 button/a, label 없는 input, html lang 누락 탐지 실패 테스트 → 구현
- [ ] 텍스트 대비 위반: `getStyle` 로 color/bg/fontSize/weight → `inspect/colors` 로 ratio·level, Fail 이면 issue 실패 → 구현
- [ ] 커밋

## Task 3: audit/links.ts 순수 수집 (TDD)
- [ ] `collectResources(root)` — `img[src]`·`a[href]`·`link[href]`·`script[src]` 수집, 절대 URL 정규화, `javascript:`/`mailto:`/`#`/`data:` 제외 실패 → 구현
- [ ] 이미지 깨짐: `img.complete && naturalWidth===0` → `broken:true` 실패 → 구현
- [ ] 커밋

## Task 4: audit/link-check.ts (TDD, 주입 fetch)
- [ ] `checkLinks(urls, fetchFn, concurrency)` → `LinkCheck[]`; HEAD ok, 4xx/5xx not-ok, throw→error, 동시성 상한 준수 실패 → 구현(HEAD 405/501 시 GET fallback)
- [ ] 커밋

## Task 5: audit/storage.ts + responsive.ts 순수 (TDD)
- [ ] `toStorageEntries(local, cookies)` — 키 정렬, 토큰/비밀번호류 값 마스킹 실패 → 구현
- [ ] `VIEWPORT_PRESETS`(Mobile 375×667·Tablet 768×1024·Desktop 1280×800) + `classifyViewport(w)` 실패 → 구현
- [ ] 커밋

## Task 6: content + background 라우팅
- [ ] content: `RUN_AUDIT` → `auditA11y(document, getComputedStyle)` + `collectResources` + localStorage 읽기 → `AUDIT_RESULT`(a11y·resources·localStorage·ranAt)
- [ ] background: `RUN_AUDIT`→content 전달; `AUDIT_RESULT` 수신→`chrome.cookies.getAll({url})` 보강 + `checkLinks`(global fetch) → `AuditResult` 조립→store.audit→push; `RESIZE_WINDOW`→`chrome.windows.update(windowId,{width,height})`
- [ ] manifest `cookies` 권한
- [ ] 빌드 + 단위 테스트 → 커밋

## Task 7: AuditPanel + App
- [ ] AuditPanel: "검사 실행" 버튼, 4섹션(접근성 이슈 목록·깨진 리소스·반응형 프리셋 버튼·스토리지/쿠키 표), 빈 상태/로딩
- [ ] App: '검증' 탭 연결, runAudit/resizeWindow Port 메시지
- [ ] 빌드 + 테스트 → 커밋

## Task 8: e2e + README
- [ ] e2e/audit.spec.ts: 의도적 a11y 위반/깨진 이미지 테스트 페이지에서 RUN_AUDIT → 이슈 표시, 리사이즈 동작(sw.evaluate 경유)
- [ ] 전체 e2e 통과
- [ ] README Phase 5 체크 + 문서 링크 → 커밋

## 비범위 (Non-goals)
- 외부 도메인 링크 전수 크롤링 — 페이지에 실재하는 참조만, 동시성 제한.
- `chrome.debugger` 디바이스 에뮬레이션(터치/DPR) — 윈도우 리사이즈로 대체.
- 쿠키 편집/삭제 — v1 은 읽기 전용 뷰어.
- ARIA 전수 검사(axe-core 수준) — 비개발자에게 유의미한 핵심 위반만.
- audit 결과의 리포트 자동 첨부 — 검증 탭 표시 우선, 리포트 통합은 후순위.
