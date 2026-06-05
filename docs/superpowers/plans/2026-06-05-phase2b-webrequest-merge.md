# QA Companion — Phase 2b (webRequest 보조 소스 병합) Implementation Plan

> **For agentic workers:** TDD(superpowers:test-driven-development) 로 task 별 구현. 순수 병합 로직은 단위 테스트, 배선은 빌드/기존 e2e 회귀로 검증.

**Goal:** Phase 2 의 fetch/XHR 캡처(소스 a)가 못 보는 실패(CORS 차단·네트워크 오류·리다이렉트)와 빈 상태코드를 `chrome.webRequest`(소스 b)로 보완한다. 기본 표시는 (a), (b)는 보완·독립 레코드만.

**Architecture:** `chrome.webRequest.onCompleted`/`onErrorOccurred` 를 background 에서 듣고(`types: ['xmlhttprequest']` 로 fetch/XHR 범위만), 순수 함수 `mergeWebReq` 로 store 의 `requests` 에 병합한다. inject 레코드와 `method+url+시간근접` 으로 1:1 소비 매칭하여 빈 status/모호한 error 를 보완하고, 매칭 실패 시 `source:'webRequest'` 독립 레코드를 만든다. 같은 `requestId` 재이벤트(리다이렉트→완료)는 같은 레코드를 갱신한다.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/messaging/types.ts` | (수정) `NetworkSource` 에 `'webRequest'`, `RequestRecord` 에 `fromCache`/`webReqId`, `WebReqEnd` 타입 |
| `src/capture/network.ts` | (수정) `mergeWebReq` 순수 병합 함수 + `WEBREQ_MATCH_WINDOW_MS` |
| `src/background/index.ts` | (수정) webRequest 리스너 등록 → `mergeWebReq` → pushState |
| `src/manifest.ts` | (수정) `webRequest` 권한 추가 |
| `tests/network.test.ts` | (수정) `mergeWebReq` 단위 테스트 추가 |

## 매칭/병합 규칙 (mergeWebReq)

입력: `(list: RequestRecord[], wr: WebReqEnd)` → 출력: 새 `RequestRecord[]` (불변).

1. **같은 requestId 재이벤트**: `r.webReqId === wr.requestId` 인 레코드가 있으면 그 레코드를 갱신(중복 추가 금지). 리다이렉트 후 최종 status 반영.
2. **inject 레코드 보완**: 위가 없으면, `source !== 'webRequest' && webReqId == null && method/url 일치 && |startedAt - wr.timeStamp| <= WINDOW` 중 startedAt 이 가장 가까운 레코드 1개를 소비(매칭). 보완 내용:
   - `status` 가 null 이면 `wr.status` 로 채우고 `ok` 재계산.
   - `error`: inject 가 error 인데(특히 모호한 'network error or CORS') wr.error 가 있으면 구체적 메시지로 교체.
   - `fromCache` 설정, `webReqId = wr.requestId` 마킹(재매칭/재이벤트 추적).
3. **독립 레코드**: 매칭 실패 시 `source:'webRequest'` 신규 레코드(본문 null). inject 후킹 전 발생했거나 후킹이 못 본 요청.

> 휴리스틱이며 완벽한 1:1 보장 아님(같은 URL 폭주 시 오매칭 가능). 비범위로 명시.

## Task 1: 타입 확장 (TDD)
- [ ] `WebReqEnd` 타입, `NetworkSource += 'webRequest'`, `RequestRecord += fromCache/webReqId` 추가
- [ ] `recordFromStart`/`applyEnd` 가 새 필드 기본값(null) 채우도록 수정
- [ ] 빌드 통과 확인

## Task 2: mergeWebReq 순수 함수 (TDD)
- [ ] 실패 테스트 작성(보완/독립/재이벤트/window밖/성공레코드보존)
- [ ] 구현 → 통과
- [ ] 커밋: `feat(capture): mergeWebReq — webRequest as secondary source (fill/merge/standalone)`

## Task 3: background webRequest 리스너 + manifest
- [ ] manifest 에 `webRequest` 권한 추가
- [ ] background 에 onCompleted/onErrorOccurred 리스너(types xmlhttprequest) → mergeWebReq → pushState
- [ ] 빌드 + 단위 테스트 통과
- [ ] 커밋: `feat(background): merge chrome.webRequest as secondary network source`

## Task 4: 회귀 검증 + 문서
- [ ] `npm test` 전부 통과, `npm run build` 0
- [ ] 기존 e2e(network 포함) 통과
- [ ] README 상태에 webRequest 보완 한 줄 반영
- [ ] 커밋

## 비범위
- 요청 본문/헤더 캡처(webRequest response body 불가) — (a) 담당.
- 완벽한 requestId 1:1 매칭 — 휴리스틱(시간 window).
- main_frame/script/image 등 비-xhr 리소스 — 범위 외(노이즈).
- WebSocket — 범위 외.
