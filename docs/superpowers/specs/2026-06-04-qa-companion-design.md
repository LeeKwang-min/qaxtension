# QA Companion — 설계 문서

- **작성일:** 2026-06-04
- **작업 이름(임시):** `qa-companion`
- **유형:** Chrome 익스텐션 (Manifest V3)
- **상태:** 설계 확정, 구현 계획 대기

## 1. 목적

QA 전담팀이 없는 조직에서, 직무와 무관하게 모두가 참여하는 웹 서비스 QA를
**비개발자도 쉽게** 수행할 수 있게 돕는 유틸성 Chrome 익스텐션. 동시에
**개발자가 빠르게 이해하고 재현**할 수 있는 형태로 문제를 정리·전달한다.

핵심 가치 흐름: **검사 → 문제 자동 포착 → 증거와 함께 개발자에게 전달**.

## 2. 확정된 기반 결정

| 항목 | 결정 |
|---|---|
| 주 UX 표면 | **사이드 패널 (Side Panel)** — 페이지를 가리지 않고 항상 열어둔 채 QA |
| 배포 범위 | **미정** — 사내 전용 기준으로 설계하되, 추후 공개를 막지 않는 구조 |
| 대상 사이트 | **모든 사이트에서 동작**, 자사 도메인엔 특화 기능 여지 |
| 기술 스택 | **TypeScript + React + Vite (CRXJS)** |
| 리포트 전달 | **클립보드 마크다운 복사 + 파일(.md/.zip) 다운로드**, 웹훅은 구조만 열어둠 |
| v1 기능 범위 | **A + B + C + D + E + F 전부** (단계적 구현) |

## 3. 기능 범위 (v1)

- **A. 요소·스타일 검사기** — 요소 클릭 시 색상(스와치+HEX+대비비)·폰트·여백·크기를
  비개발자도 읽을 수 있는 말로 표시.
- **B. API 모니터** — 페이지가 호출한 API 리스트, 실패(4xx/5xx/네트워크오류) 테이블,
  트리맵, 호출 시각·소요시간, 요청/응답 본문.
- **C. 콘솔/에러 자동 수집** — `window.onerror`·`unhandledrejection`·`console.error`/`warn`
  자동 포착, 레벨·시각·스택 표시.
- **D. 증거 수집 & 버그 리포트 생성** — 스크린샷+주석, 환경정보(URL·UA·OS·뷰포트·
  로그인 사용자 추정·최근 에러·실패 API) 자동 수집, 마크다운 양식 클립보드 복사 / 파일 다운로드.
  ※ "로그인 사용자 추정"은 best-effort — 비httpOnly 쿠키/`localStorage`의 흔한 키
  (예: `user`, `token`, `email`) 휴리스틱 탐지이며 보장값이 아님.
- **E. 추가 자동 검증** — 접근성/색 대비, 반응형 뷰, 깨진 이미지·링크(404) 스캔,
  localStorage/쿠키 뷰어.
- **F. 행동 기록 → 재현 절차 자동화** — 클릭·입력·네비게이션 기록 → 재현 절차를
  사람이 읽는 글로 자동 생성, 리포트에 첨부.

## 4. 아키텍처 (Manifest V3)

5개 실행 컨텍스트가 메시지로 연결된다.

```
[페이지 MAIN world]  inject.ts
   fetch/XHR 가로채기, window.onerror·console.error 후킹
        │ window.postMessage
        ▼
[content script ISOLATED]  content.ts
   브리지 + 요소 피커/하이라이터, DOM 스캔(검증), 행동 기록
        │ chrome.runtime
        ▼
[background service worker]  background.ts
   tabId별 세션 저장소, webRequest(보조 네트워크 소스),
   captureVisibleTab(스크린샷), cookies, downloads, 메시지 라우팅
        │ chrome.runtime / Port
        ▼
[Side Panel UI]  React + TS
   탭: 검사 · 네트워크 · 콘솔 · 검증 · 기록 · 리포트
```

### 핵심 설계 포인트

- **네트워크 두 소스 병합:**
  - (a) `inject.ts`의 fetch/XHR 가로채기 — 앱이 실제 호출한 API + 요청/응답 본문(풍부함).
  - (b) `chrome.webRequest` — 상태코드/타이밍을 폭넓게(CORS 차단 등 fetch가 못 보는 실패 보완).
  - requestId / URL+시각으로 중복 제거. 기본 표시는 (a), 실패 보완은 (b).
- **호스트 페이지 비파괴:** `inject.ts`는 원본 함수 참조를 보존하고 모든 후킹을 try/catch로
  감싸 fail-open. 패치가 실패해도 페이지 동작에 영향 없음.
- **상태 scope:** tabId별로 분리, `chrome.storage.session`에 저장해 패널 재오픈 시 유지.
  "초기화" 버튼 제공. 요청/응답 본문은 **기본 32 KB**(설정 가능한 상수)로 절단해
  메모리를 보호하고, UI에 절단 여부를 표시.
- **권한 최소화:** 배포 미정이므로 선택적 권한이 필요한 기능은 첫 사용 시점에 요청.

## 5. 모듈 경계

각 모듈은 "무엇을 하는가 / 어떻게 쓰는가 / 무엇에 의존하는가"가 명확하며,
`messaging` 계약으로만 통신해 내부 변경이 소비자를 깨뜨리지 않는다.

| 모듈 | 책임 | 의존 |
|---|---|---|
| `messaging` | 컨텍스트 간 타입드 메시지 계약(인터페이스) | — |
| `store` | background의 tabId별 세션 모델 | messaging |
| `capture/network` | fetch/XHR 패치 + webRequest 병합 → `RequestRecord[]` | messaging |
| `capture/console` | 에러/console 후킹 → `LogRecord[]` | messaging |
| `capture/recorder` | 상호작용 이벤트 → `Step[]` (기능 F) | messaging |
| `inspect/element` | 요소 피커 + computed-style 추출 → `ElementInfo` | — |
| `audit/*` | a11y·대비·깨진링크·반응형·스토리지 (스캐너별 분리) | — |
| `report/builder` | 세션 스냅샷 → Markdown + 첨부 번들 | store |
| `ui/panel` | 타입드 store를 소비하는 React 앱 | messaging, store |

## 6. 데이터 흐름

- **수집:** inject.ts(MAIN) → `window.postMessage` → content.ts(ISOLATED)
  → `chrome.runtime.sendMessage` → background(store, tabId별) → Side Panel(Port 구독).
- **명령:** Side Panel("피커 켜기", "스크린샷 찍기" 등) → background → content.ts → 페이지.
- **네트워크 표시:** background에서 두 소스 병합 후 정규화된 `RequestRecord[]` 제공.

## 7. 기능별 동작 정의

- **A.** 패널에서 피커 켜기 → hover 하이라이트 → 클릭 시 스타일/색상/대비비를 평이한 말로 표시.
- **B.** 리스트(메서드/URL/상태/소요시간/시각), 실패 테이블, 트리맵(host→path 그룹,
  타일 크기=호출 수[토글: 전송량], 색=에러율 녹→적), 행 클릭 시 본문.
- **C.** JS 에러·미처리 예외·console.error/warn 자동 수집, 레벨·시각·스택 표시.
- **D.** 스크린샷(보이는 영역)+패널 내 화살표/박스 주석 → 환경정보 자동 수집
  → 마크다운 양식 클립보드 복사 / .md·.zip 다운로드. 웹훅 전송은 구조만 열어둠(후순위).
- **E.** 접근성/색 대비 경고, 반응형 뷰(뷰포트 프리셋), 깨진 이미지·링크(404),
  localStorage/쿠키 뷰어(httpOnly 쿠키는 `chrome.cookies`).
- **F.** 클릭·입력·네비게이션 기록 → 재현 절차를 사람이 읽는 글로 자동 생성, 리포트 첨부.

## 8. 에러 처리

- **호스트 페이지 보호:** 후킹 실패 시 원본 호출로 폴백.
- **메시지 단절:** 탭 종료·네비게이션 시 Port 끊김 graceful 처리.
- **권한:** 선택적 권한 필요 기능은 첫 사용 시점에 요청.
- **대용량 본문:** N KB 절단으로 메모리 보호, UI에 절단 표시.

## 9. 테스트 전략

- **단위(vitest):** 네트워크 병합·정규화, 리포트 빌더(마크다운 스냅샷), 대비 계산,
  audit 스캐너(jsdom).
- **통합(Playwright):** unpacked 익스텐션을 테스트 페이지에 로드해 실제 fetch/에러
  시나리오로 검증.

## 10. 구현 단계 (각 단계가 그 자체로 동작)

- **Phase 0 — 토대:** manifest, Vite+CRXJS 빌드, 사이드 패널 셸, `messaging` 계약,
  background store, inject↔content 브리지. (검증: 패널 열림 + 메시지 왕복)
- **Phase 1 — A** 요소·스타일 검사
- **Phase 2 — B** API 모니터
- **Phase 3 — C** 콘솔/에러
- **Phase 4 — D** 증거 & 리포트
- **Phase 5 — E** 추가 검증
- **Phase 6 — F** 행동 기록

각 Phase는 독립된 구현 계획으로 진행하고, 끝날 때마다 동작을 검증한다.

## 11. 비범위 (Non-goals, v1)

- 웹훅/외부 트래커(Slack·Jira·Notion) 실제 연동 — 구조만 열어두고 실제 구현은 후순위.
- 크롬 웹스토어 공개 패키징·심사 대응 — 배포 결정 후 별도 진행.
- 전체 페이지(스크롤 영역 전부) 스크린샷 — v1은 보이는 영역만.
- `chrome.debugger`(CDP) 기반 네트워크 캡처 — "디버깅 중" 배너 때문에 채택하지 않음.
