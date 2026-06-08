# QA Companion — JIRA 연동 설계 (MVP)

작성일: 2026-06-08

## 목적

QA 실무자가 사이드 패널에서 분석한 데이터(환경·실패 API·콘솔 에러·검사 요소·재현 절차·스크린샷)를 기반으로, **JIRA Cloud 프로젝트에 이슈를 자동 생성**한다. 현재 리포트는 markdown/zip 생성과 클립보드/다운로드까지만 지원하며 외부 트래커 연동은 없다. 이 기능으로 "QA → 티켓 등록" 수작업을 없앤다.

## 전제 / 결정사항

- **JIRA 환경:** JIRA Cloud (`*.atlassian.net`), REST API v3.
- **인증:** API 토큰(Basic auth, `email:token` base64). 익스텐션 단독으로 OAuth 2.0(3LO)은 client secret 보관용 백엔드가 필요하므로 범위 밖. API 토큰은 한 번 설정하면 유지돼 "로그인 상태"처럼 동작한다.
- **백엔드 없음.** 순수 클라이언트 익스텐션. 모든 JIRA 호출은 background fetch(CORS 회피). `host_permissions: ['<all_urls>']` 로 `*.atlassian.net` 포함 이미 커버.
- **설정 위치:** 헤더 ⚙️ 버튼 → 설정 화면 전환(뒤로가기). 탭은 6개 유지(360px 폭 보존).
- **티켓 생성 흐름:** 간결형. 리포트 탭 "JIRA 티켓 생성" → 프로젝트·이슈타입 선택 + 제목(자동 제안, 편집) → 생성. 설명·스크린샷은 자동.
- **MVP 범위 포함:** 스크린샷 첨부 O. 설명은 ADF(문단/불릿 위주, 테이블 없음)로 직접 빌드.

## 모듈 구조 (신규 `src/integrations/jira/`)

각 모듈은 단일 책임 + 잘 정의된 인터페이스로 독립 테스트 가능하게 둔다.

### `client.ts` — JIRA REST API v3 클라이언트
- `fetch` 를 주입받는 순수 모듈(기존 `audit/links.ts` 선례). DOM/chrome API 의존 없음 → vitest 단위 테스트.
- 함수:
  - `testConnection(cfg)` → `GET /rest/api/3/myself` (200이면 연결 OK, accountId/displayName 반환)
  - `listProjects(cfg)` → `GET /rest/api/3/project/search` (프로젝트 목록)
  - `listIssueTypes(cfg, projectId)` → 프로젝트별 이슈타입 (createmeta 또는 project 상세)
  - `createIssue(cfg, payload)` → `POST /rest/api/3/issue` (생성된 `key`/`id` 반환)
  - `attachScreenshot(cfg, issueKey, dataUrl)` → `POST /rest/api/3/issue/{key}/attachments` (multipart, 헤더 `X-Atlassian-Token: no-check`)
- `cfg` = `{ site, email, token }`. Authorization 헤더는 호출부(background)에서 `Basic base64(email:token)` 구성.

### `mapping.ts` — ReportInput → 이슈 페이로드 (순수)
- `suggestTitle(input): string` — 제목 자동 제안. 우선순위:
  1. 실패 API 있으면 `[QA] {method} {path} {status}` (예: `[QA] POST /api/login 500`)
  2. 없고 콘솔 에러 있으면 `[QA] {첫 에러 메시지 요약}`
  3. 아니면 `[QA] {페이지 URL/제목} 이슈`
- `buildDescriptionADF(input): ADFDoc` — ADF(`{type:'doc', version:1, content:[...]}`) 직접 빌드. 섹션: 환경정보, 실패 API 목록, 콘솔 에러, 검사 요소, 재현 절차(steps). 문단(heading)·불릿 리스트·코드블록 사용. markdown 파서 불필요(구조화 데이터에서 직접 생성).
- `buildIssuePayload({ projectId, issueTypeId, summary, descriptionADF, labels })` — `/issue` 요청 바디 구성. 라벨에 `qa-companion` 자동 포함.

### `settings.ts` — 설정 저장/로드
- `chrome.storage.local` 에 `{ site, email, token, defaultProjectId? }` CRUD. 익스텐션의 첫 storage 사용.
- `loadSettings()` / `saveSettings(cfg)` / `clearSettings()`.
- 토큰은 background 에서만 읽어 사용(content/page 에 노출 금지).

### background — `JIRA_*` 메시지 핸들러
- 패널 → background 메시지: `JIRA_TEST`, `JIRA_LIST_PROJECTS`, `JIRA_LIST_ISSUETYPES`, `JIRA_CREATE_ISSUE`(스크린샷 첨부까지 한 번에 처리).
- background 가 `settings.ts` 로 설정 로드 → `client.ts` 호출(실제 fetch 주입) → 결과를 패널에 회신.
- CORS: JIRA Cloud API 는 브라우저에서 직접 호출 시 CORS 제한이 있으나 익스텐션 background(service worker) fetch 는 host_permissions 로 우회된다.

### UI
- **`SettingsPanel.tsx`** (신규) — 헤더 ⚙️ → 설정 화면. JIRA 사이트·이메일·토큰 입력, "연결 테스트"(결과 표시), "저장". 뒤로가기로 메인 복귀. App 에 `view` 상태('main' | 'settings') 추가.
- **리포트 탭(`ReportPanel.tsx`) JIRA 섹션** — "JIRA 티켓 생성" 버튼. 토큰 미설정이면 비활성 + "설정에서 JIRA 연결" 유도. 활성 시: 프로젝트·이슈타입 드롭다운(로드) + 제목 입력(자동 제안 프리필) + "생성". 생성 성공 시 이슈 링크(`{site}/browse/{key}`) 표시.

## 데이터 흐름

```
[설정]
 헤더 ⚙️ → SettingsPanel → 입력 → "연결 테스트"
   → JIRA_TEST → background → client.testConnection(GET /myself)
   → 200 표시 → "저장" → settings.saveSettings(chrome.storage.local)

[티켓 생성]
 리포트 탭 "JIRA 티켓 생성"
   → JIRA_LIST_PROJECTS → 프로젝트 선택
   → JIRA_LIST_ISSUETYPES(projectId) → 이슈타입 선택
   → 제목 자동 제안(mapping.suggestTitle) 프리필 + 편집
   → "생성" → JIRA_CREATE_ISSUE
       → mapping.buildDescriptionADF + buildIssuePayload
       → client.createIssue(POST /issue)
       → client.attachScreenshot(POST /issue/{key}/attachments)  // 스크린샷 있으면
   → 이슈 링크 표시
```

## 데이터 매핑 상세

| 리포트 데이터 | JIRA 이슈 |
|---|---|
| (자동 제안) | summary (제목, 편집 가능) |
| env, 실패 API, logs, pickedElement, steps | description (ADF 문단/불릿) |
| screenshot (주석본) | attachment |
| — | labels: `['qa-companion']` |
| (사용자 선택) | project, issuetype |

## 에러 처리

- 401 (인증 실패) → "토큰·이메일을 확인하세요" 안내.
- 403 (권한 없음) → "해당 프로젝트에 이슈 생성 권한이 있는지 확인하세요".
- 네트워크/기타 실패 → 에러 메시지 표시 + 재시도 가능.
- 토큰 미설정 → 생성 버튼 비활성 + 설정 유도.
- 생성은 성공했으나 스크린샷 첨부 실패 → 이슈 링크는 표시하되 "스크린샷 첨부 실패" 경고(이슈 자체는 생성됨).

## 보안

- 토큰은 `chrome.storage.local`(익스텐션 샌드박스 격리, 평문) 저장. 사용자 머신 로컬에만 존재, 외부 전송은 JIRA API 호출뿐.
- 토큰은 background 에서만 사용. content script/페이지/패널 UI 에 평문 노출하지 않는다(설정 화면 입력 필드는 password 타입, 저장 후 마스킹).

## 테스트 전략

- **단위(vitest):**
  - `client.ts` — fetch 주입으로 각 함수의 요청 URL·헤더·바디·응답 파싱 검증.
  - `mapping.ts` — `suggestTitle` 우선순위, `buildDescriptionADF` 구조, `buildIssuePayload` 라벨 포함.
  - `settings.ts` — storage mock CRUD.
- **e2e(playwright):** 설정 화면 렌더 + 입력 + 리포트 탭 생성 버튼 노출/비활성 토글. 실제 JIRA 호출은 하지 않는다(네트워크 의존·인증 필요).
- 커밋별 `tsc -b` + 단위 그린 유지(기존 작업 패턴).

## 비범위 (향후 후보)

- OAuth 2.0 로그인(백엔드 필요).
- JIRA Server/Data Center 지원(API v2·PAT).
- 상세형 생성(라벨·담당자·우선순위 매번 조정), 원클릭 생성(기본 프로젝트 고정).
- 다른 트래커(Slack·Notion·GitHub Issues).
- 기존 이슈에 코멘트 추가, 중복 이슈 감지.
