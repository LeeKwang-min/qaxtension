# QA Companion — Phase 4 (증거 & 리포트) Implementation Plan

> **For agentic workers:** TDD(superpowers:test-driven-development) 로 task 별 구현. 순수 로직(마크다운 빌더·zip·휴리스틱)은 단위 테스트, 스크린샷/env 수집은 e2e 로 검증. task 별 커밋, main 직접 작업.

**Goal:** store 에 쌓인 데이터(pickedElement·requests·logs)와 보이는 영역 스크린샷(+주석)·환경정보를 하나의 **버그 리포트**(마크다운)로 묶어 **클립보드 복사 / .md·.zip 다운로드**한다. 핵심 가치 흐름 "검사→포착→전달"의 결실.

**Architecture:**
- **스크린샷:** 패널 → background `chrome.tabs.captureVisibleTab`(기존 `<all_urls>` host 권한으로 충분) → 단발성 Port 메시지로 dataURL 반환(상시 broadcast state 에 넣지 않아 대용량 재전송 방지). 패널이 `<canvas>` 에 표시하고 화살표/박스 주석 후 `toDataURL` 로 첨부 생성.
- **환경정보:** 패널 → background `COLLECT_ENV` → content 가 DOM 측에서 수집(UA·platform·언어·뷰포트·스크린·로그인 추정) → `ENV_RESULT` → store `env` 저장 → Port push. 로그인 추정은 best-effort(비httpOnly 쿠키/localStorage 흔한 키 휴리스틱, `chrome.cookies` 미사용).
- **리포트:** 순수 모듈 `report/builder.ts` 가 세션 스냅샷 → 마크다운 문자열 + 첨부 디스크립터. `report/zip.ts` 는 의존성 없는 store-only(무압축) zip writer(PNG 는 이미 압축됨) + CRC32 — 단위 테스트. 패널은 빌더 결과를 클립보드/blob 다운로드로 내보낸다.

**권한:** 신규 추가는 `clipboardWrite` 만. 스크린샷은 기존 `<all_urls>`, 다운로드는 패널 내 `<a download>`(downloads 권한 불필요), 로그인 추정은 `document.cookie`/`localStorage`(cookies 권한 불필요).

## File Structure

| 파일 | 책임 |
|---|---|
| `src/messaging/types.ts` | (수정) `EnvInfo`, `ReportInput`, 메시지(+`CAPTURE_SCREENSHOT`/`SCREENSHOT_RESULT`/`COLLECT_ENV`/`ENV_RESULT`), `TabSessionState += env` |
| `src/background/store.ts` | (수정) `createDefault` 에 `env: null` |
| `src/report/builder.ts` | (신규, 순수) 마크다운 빌드·실패 API 표·에러 섹션·로그인 추정 휴리스틱·OS 파싱·첨부 디스크립터 |
| `src/report/zip.ts` | (신규, 순수) CRC32 + store-only zip writer |
| `src/report/env.ts` | (신규) content 측 EnvInfo 수집(DOM 읽기) — 휴리스틱/OS 파싱은 builder 재사용 |
| `src/content/index.ts` | (수정) `COLLECT_ENV` → collectEnv → `ENV_RESULT` |
| `src/background/index.ts` | (수정) `CAPTURE_SCREENSHOT`→captureVisibleTab→`SCREENSHOT_RESULT`, `COLLECT_ENV` 라우팅, `ENV_RESULT`→store.env |
| `src/sidepanel/ReportPanel.tsx` | (신규) 스크린샷+주석 캔버스·환경정보·미리보기·복사/.md/.zip |
| `src/sidepanel/App.tsx` | (수정) 리포트 탭 연결 + screenshot/env 핸들러 |
| `src/manifest.ts` | (수정) `clipboardWrite` 권한 |
| `tests/report-builder.test.ts` | (신규) 마크다운 스냅샷·휴리스틱·OS 파싱 |
| `tests/report-zip.test.ts` | (신규) zip 구조/CRC 라운드트립 |
| `tests/store.test.ts` | (수정) `env: null` 기본값 |
| `e2e/report.spec.ts` | (신규) 스크린샷 캡처·env 수집·복사 흐름 |

## Task 1: 타입 & store (TDD)
- [ ] `EnvInfo`(url·userAgent·platform·os·language·viewport·screen·loginGuess·collectedAt), `ReportInput`(env·pickedElement·requests·logs·generatedAt·screenshot 유무)
- [ ] 메시지: PortMessage += `CAPTURE_SCREENSHOT`/`SCREENSHOT_RESULT`/`COLLECT_ENV`; RuntimeMessage += `COLLECT_ENV`/`ENV_RESULT`; `TabSessionState += env`
- [ ] store.test 에 `env: null` 기대(실패) → createDefault 확장 → 통과
- [ ] 커밋

## Task 2: report/builder.ts 순수 모듈 (TDD)
- [ ] `osFromUA`(UA→OS 라벨), `guessLogin`(entries→흔한 키 매칭) 실패 테스트 → 구현
- [ ] `buildMarkdown(input)` 스냅샷(섹션: 환경·검사 요소·실패 API 표·최근 에러·스크린샷 안내) 실패 → 구현
- [ ] `buildReport(input)` → `{ markdown, attachments }` (스크린샷 dataURL 있으면 screenshot.png 첨부)
- [ ] 커밋

## Task 3: report/zip.ts 순수 모듈 (TDD)
- [ ] `crc32(bytes)` 알려진 벡터 검증 실패 → 구현
- [ ] `buildZip(files)` → Uint8Array; local header 시그니처(PK\x03\x04)·EOCD(PK\x05\x06)·엔트리 수 검증 실패 → 구현(store-only)
- [ ] 커밋

## Task 4: env 수집(content) + background 라우팅
- [ ] `report/env.ts` collectEnv(): navigator/window 읽기 + localStorage·document.cookie → guessLogin
- [ ] content: `COLLECT_ENV` → collectEnv → `ENV_RESULT` 발신
- [ ] background: `CAPTURE_SCREENSHOT`→captureVisibleTab(실패 시 error)→`SCREENSHOT_RESULT`; `COLLECT_ENV`→content 전달; `ENV_RESULT`→store.env + pushState
- [ ] 빌드 + 단위 테스트
- [ ] 커밋

## Task 5: ReportPanel + App
- [ ] ReportPanel: 스크린샷 버튼→캔버스 표시, 주석 도구(화살표/박스/지우기), 환경정보 수집·표시, 마크다운 미리보기, 클립보드 복사·.md·.zip 다운로드
- [ ] App: 리포트 탭 연결 + onCaptureScreenshot/onCollectEnv (Port 단발 메시지 수신 핸들링)
- [ ] manifest clipboardWrite
- [ ] 빌드 + 테스트
- [ ] 커밋

## Task 6: e2e + README
- [ ] e2e/report.spec.ts: 패널에서 스크린샷 캡처(이미지 표시)·env 수집(URL 표시)·복사 버튼 동작
- [ ] 전체 e2e 통과
- [ ] README 상태 Phase 4 체크 + 문서 링크
- [ ] 커밋

## 비범위 (Non-goals)
- 전체 페이지(스크롤) 스크린샷 — v1 은 보이는 영역만(spec).
- 웹훅/외부 트래커 실제 전송 — 구조만(후순위).
- 압축 zip(deflate) — store-only 로 충분(PNG 기압축).
- `chrome.cookies`(httpOnly) 기반 로그인 식별 — best-effort 휴리스틱만.
- 주석 실행취소 스택/도형 편집 — v1 은 추가·전체 지우기만.
