# QA Companion — Phase 6 (행동 기록 → 재현 절차) Implementation Plan

> **For agentic workers:** TDD(superpowers:test-driven-development) 로 task 별 구현. 순수 변환·DOM 추출은 vitest(jsdom) 단위, 이벤트 후킹/네비게이션 유지/라우팅은 background+content + e2e 로 검증. task 별 커밋, main 직접 작업.

**Goal:** spec 기능 F. 사용자가 페이지에서 한 **클릭·입력·네비게이션**을 기록해 **사람이 읽는 재현 절차**로 자동 변환하고, '기록' 탭에 표시 + 리포트의 "## 재현 절차" 자리에 채운다. 이것이 마지막 Phase.

## 착수 결정 (자율, 메모리 "추천대로 진행" 선호)

| 결정 사항 | 선택 | 근거 |
|---|---|---|
| 이벤트 후킹 위치 | **content(ISOLATED) capture-phase 리스너** (inject MAIN 불필요) | content 는 공유 DOM 에 직접 리스너를 달 수 있고, capture 단계면 페이지가 stopPropagation 해도 포착. 네트워크/콘솔과 달리 함수 패치가 아니라 DOM 이벤트 구독이라 MAIN world 가 필요 없음. |
| 입력 기록 시점 | **`change` 이벤트** (매 키 입력 `input` 아님) | 커밋(blur/선택) 시점의 **최종값**만 기록 → 노이즈 최소. checkbox/radio/select 는 즉시 발화. |
| password 마스킹 | `type="password"` 값은 `••••••` 로 치환, 긴 값은 절단 | spec 명시. 민감정보 리포트 유출 방지. |
| selector 안정성 | `inspect/element-info.ts` 의 **`cssPath` 재사용** | 검사 탭과 동일한 짧은 선택자(id 우선 → tag.class 체인). 일관성. |
| 네비게이션 이어붙이기 | 기록 중이면 **`clearTabState` 가 steps·recording 을 유지** + navigate step 추가, content 재주입 후 readiness 감지 시 `RECORD_START` 재전송으로 리스너 재무장 | 페이지가 바뀌어도 한 시나리오를 끊김 없이 이어 기록. requests/logs/audit 는 페이지별 초기화가 옳지만 기록은 cross-navigation 관심사. |
| 모듈 분리 | `capture/recorder.ts` 한 모듈에 순수 변환 + DOM 추출(요소 인자) 공존 | audit/* 선례(루트 인자 받아 jsdom 단위 테스트)와 동일. chrome 의존 없음 → content 가 실제 이벤트로 호출. |

## Architecture

- **순수/DOM 모듈 `capture/recorder.ts`** (chrome 의존 0):
  - DOM 추출(요소 인자, jsdom 단위): `interactionFromClick(el, now)` → `InteractionEvent | null`(텍스트 입력 클릭 등은 null 로 무시), `interactionFromChange(el, now)` → `InteractionEvent | null`. 내부에서 `cssPath`(재사용) + `labelOf` + `valueOf`(password 마스킹·절단).
  - 순수 변환(단위): `stepFromEvent(event, id)` → `Step`, `pushStep(list, step)`(상한 + 직전 동일 selector 의 input/select 병합), `describeStep(step)` → 한국어 문장, `buildStepsSection(steps)` → "## 재현 절차" 마크다운.
- **content(ISOLATED):** `RECORD_START` 수신 → document 에 capture-phase `click`/`change` 리스너 설치, 각 이벤트를 `interactionFrom*` 로 `InteractionEvent` 화 → `INTERACTION` 발신. `RECORD_STOP` → 리스너 제거. (중복 설치 방지 가드)
- **background:** `RECORD_SET_ACTIVE` 라우팅(store.recording 갱신 + content 에 START/STOP), `INTERACTION` 수신 → `pushStep` 으로 store.steps 갱신→push. `RECORD_CLEAR` → steps 비움. **네비게이션:** onUpdated(loading) 에서 recording 이면 steps·recording 보존 + navigate step 추가, content readiness 회복 시 `RECORD_START` 재전송. `RECORD_CLEAR`·tab 제거 시에만 기록 종료.
- **report:** `buildMarkdown` 의 placeholder 를 `buildStepsSection(input.steps)` 로 교체. `ReportInput += steps`, `ReportOptions += includeSteps`(기본 true).
- **상태:** `TabSessionState += recording: boolean, steps: Step[]`. createDefault 확장.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/messaging/types.ts` | (수정) `StepKind`·`InteractionEvent`·`Step`; 메시지(`RECORD_START`/`RECORD_STOP`/`INTERACTION` runtime, `RECORD_SET_ACTIVE`/`RECORD_CLEAR` port); `TabSessionState += recording, steps`; `ReportInput += steps` |
| `src/background/store.ts` | (수정) `createDefault` 에 `recording: false, steps: []` |
| `src/capture/recorder.ts` | (신규) DOM 추출 + 순수 변환 + describe + 마크다운 섹션 |
| `src/content/index.ts` | (수정) `RECORD_START`/`RECORD_STOP` → capture 리스너 설치/제거 → `INTERACTION` |
| `src/background/index.ts` | (수정) `RECORD_SET_ACTIVE`/`RECORD_CLEAR` 라우팅, `INTERACTION` 수신→pushStep, 네비게이션 보존+navigate step+재무장 |
| `src/report/builder.ts` | (수정) placeholder → `buildStepsSection`; `ReportOptions += includeSteps`; `ReportInput.steps` |
| `src/sidepanel/RecordPanel.tsx` | (신규) 시작/중지 토글 + 지우기 + 스텝 목록 + 빈 상태 |
| `src/sidepanel/App.tsx` | (수정) '기록' 탭 연결 + recording/steps 전달 + Port 핸들러 |
| `src/sidepanel/ReportPanel.tsx` | (수정) steps prop + '재현 절차' 포함 체크박스 |
| `tests/recorder.test.ts` | (신규) jsdom DOM 추출 + 순수 변환/병합/마스킹/describe/섹션 |
| `tests/store.test.ts` | (수정) `recording:false, steps:[]` 기본값 |
| `tests/report-builder.test.ts` | (수정) 재현 절차 섹션 렌더 + includeSteps 제외 |
| `e2e/record.spec.ts` | (신규) RECORD_START 후 클릭/입력 → INTERACTION 봉투/스텝 관측, 네비게이션 이어붙이기 |

## Task 1: 타입 & store (TDD)
- [ ] 타입: `StepKind = 'click'|'input'|'select'|'check'|'navigate'`, `InteractionEvent`(kind·selector·label·value·at), `Step extends InteractionEvent { id }`
- [ ] 메시지: RuntimeMessage += `RECORD_START`/`RECORD_STOP`/`INTERACTION`; PortMessage += `RECORD_SET_ACTIVE`(active)/`RECORD_CLEAR`; `TabSessionState += recording, steps`; `ReportInput += steps`
- [ ] store.test `recording:false, steps:[]` 기대(실패) → createDefault 확장 → 통과 → 커밋

## Task 2: capture/recorder.ts 순수 변환 (TDD)
- [ ] `maskValue(value, isPassword)` — password→`••••••`, 길면 절단; `stepFromEvent(e,id)`; `pushStep`(상한 + 직전 동일 selector input/select 병합); 실패 테스트 → 구현
- [ ] `describeStep` 각 kind 한국어 문장; `buildStepsSection(steps)` 번호 목록 + 빈 상태 `_기록된 행동 없음_`; 실패 → 구현
- [ ] 커밋

## Task 3: capture/recorder.ts DOM 추출 (TDD, jsdom)
- [ ] `labelOf(el)` — 버튼/링크 텍스트, input `aria-label`/연결 label/placeholder/name 우선순위; `valueOf(el)`(password 마스킹)
- [ ] `interactionFromClick(el, now)` — 버튼/링크/`[role=button]`/submit·button·checkbox·radio 클릭만, 텍스트 input/textarea 클릭은 null; `interactionFromChange(el, now)` — text/textarea→input, select→select, checkbox/radio→check, 그 외 null
- [ ] 커밋

## Task 4: content + background 라우팅 + 네비게이션
- [ ] content: `RECORD_START`→capture-phase `click`/`change` 리스너 설치(중복 가드), 이벤트→`interactionFrom*`→`INTERACTION` 발신; `RECORD_STOP`→제거
- [ ] background: `RECORD_SET_ACTIVE`→store.recording 갱신 + content START/STOP; `INTERACTION`→`pushStep`→push; `RECORD_CLEAR`→steps 비움; onUpdated(loading) recording 이면 steps·recording 보존 + navigate step + readiness 회복 시 `RECORD_START` 재전송
- [ ] 빌드 + 단위 테스트 → 커밋

## Task 5: RecordPanel + App + Report 통합
- [ ] RecordPanel: 시작/중지 토글(recording 반영), '기록 지우기', 번호 매긴 스텝 목록(kind 색/아이콘 + describeStep + 시각), 빈 상태/주입 대기
- [ ] App: '기록' 탭 연결, `RECORD_SET_ACTIVE`/`RECORD_CLEAR` Port 메시지, ReportPanel 에 steps 전달
- [ ] builder: placeholder→`buildStepsSection`, `includeSteps` 옵션; ReportPanel '재현 절차' 체크박스; report-builder.test 수정
- [ ] 빌드 + 테스트 → 커밋

## Task 6: e2e + README
- [ ] e2e/record.spec.ts: 테스트 페이지에서 RECORD_START(sw.evaluate 경유) → 버튼 클릭·input 입력 → `INTERACTION`/스텝 관측, 비파괴(원래 핸들러 호출), 네비게이션 후 이어 기록
- [ ] 전체 e2e 통과
- [ ] README Phase 6 체크 + 문서 링크 → 커밋

## 비범위 (Non-goals)
- 셀렉터 자동 견고화(데이터속성 우선·nth-child 폴백 등 Playwright codegen 수준) — `cssPath` 재사용으로 충분, 과도한 정확도는 후순위.
- 스크롤·호버·드래그·키조합 기록 — v1 은 클릭·입력·네비게이션 핵심 3종.
- 기록 재생(replay)/자동 실행 — 사람이 읽는 절차 생성까지가 범위.
- iframe 내부 상호작용 — all_frames:false 정책 유지.
- 입력값 전수 마스킹(이메일/주민번호 패턴) — password 타입만 마스킹, 나머지는 절단.
