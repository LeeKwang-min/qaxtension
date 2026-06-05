# QA Companion — Phase 3 (콘솔/에러 수집) Implementation Plan

> **For agentic workers:** TDD(superpowers:test-driven-development) 로 task 별 구현. 순수 로직은 단위 테스트, inject 후킹은 e2e 로 검증.

**Goal:** 페이지의 `console.error`/`console.warn`·런타임 에러(`window 'error'`)·미처리 프로미스 거부(`unhandledrejection`)를 자동 포착해 사이드 패널 **콘솔** 탭에 레벨·시각·메시지·스택으로 보여준다.

**Architecture:** Phase 2(네트워크)와 동일 파이프라인. MAIN-world `inject` 가 후킹(원본 보존 + fail-open)하여 `LOG` 이벤트를 발신, `content` 가 중계, `background` 가 tabId별 store 에 `LogRecord[]` 로 push(연속 동일 로그는 count 병합), Port 로 패널에 push. 인자 직렬화·레코드 빌드·병합·레벨 필터는 순수 모듈 `src/capture/console.ts` 로 분리해 단위 테스트한다. 객체 직렬화는 postMessage 직전 inject 에서 문자열로 끝낸다(구조화 복제 위험 회피).

## File Structure

| 파일 | 책임 |
|---|---|
| `src/messaging/types.ts` | (수정) `LogLevel`/`LogSource`/`LogEvent`/`LogRecord`, 메시지·상태 확장 |
| `src/background/store.ts` | (수정) `createDefault` 에 `logs: []` |
| `src/capture/console.ts` | (신규) 인자 직렬화·레코드 빌드·연속 병합·상한·레벨 필터 (순수) |
| `src/inject/index.ts` | (수정) console.error/warn·error·unhandledrejection 후킹 → `LOG` 발신 |
| `src/content/index.ts` | (수정) `LOG` 중계 |
| `src/background/index.ts` | (수정) `LOG` 라우팅 + pushLog, `CONSOLE_CLEAR` 처리 |
| `src/sidepanel/ConsolePanel.tsx` | (신규) 콘솔 탭 UI (레벨 필터·리스트·스택·count·초기화) |
| `src/sidepanel/App.tsx` | (수정) 콘솔 탭 연결 + clear 핸들러 |
| `tests/console.test.ts` | (신규) 순수 모듈 단위 테스트 |
| `tests/store.test.ts` | (수정) `logs` 기본값 |
| `e2e/console.spec.ts` | (신규) inject 후킹 e2e |

## Task 1: 타입 & store (TDD)
- [ ] LogLevel/LogSource/LogEvent/LogRecord 타입, InjectEnvelope/RuntimeMessage += LOG, PortMessage += CONSOLE_CLEAR, TabSessionState += logs
- [ ] store.test 에 `logs: []` 기대 추가(실패) → createDefault 확장 → 통과
- [ ] 커밋

## Task 2: capture/console.ts 순수 모듈 (TDD)
- [ ] 실패 테스트(serializeArgs/recordFromLog/pushLog/filterByLevel)
- [ ] 구현 → 통과
- [ ] 커밋

## Task 3: inject 후킹
- [ ] console.error/warn 오버라이드(원본 보존), window 'error'(런타임만, 리소스 에러 제외), unhandledrejection
- [ ] 빌드 + 단위 테스트 통과
- [ ] 커밋

## Task 4: content 중계 + background 라우팅
- [ ] content: LOG 분기 추가
- [ ] background: case LOG → pushLog, CONSOLE_CLEAR → logs:[]
- [ ] 빌드 + 테스트
- [ ] 커밋

## Task 5: ConsolePanel + App
- [ ] ConsolePanel(레벨 필터·리스트·스택 펼침·count·초기화)
- [ ] App 콘솔 탭 연결 + clearConsole
- [ ] 빌드 + 테스트
- [ ] 커밋

## Task 6: e2e + README
- [ ] e2e/console.spec.ts (inject LOG 발신 검증)
- [ ] 전체 e2e 통과
- [ ] README 상태 Phase 3 체크
- [ ] 커밋

## 비범위
- console.log/info/debug 수집 — v1 은 error/warn(문제 신호)만. 후속.
- 객체 인자 인터랙티브 트리 뷰 — 문자열 직렬화만.
- 스택 소스맵 해석 — 원본 스택 그대로.
- 중복 로그 그룹핑(비연속) — 연속 동일만 count 병합.
