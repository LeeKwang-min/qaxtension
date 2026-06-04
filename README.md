# QA Companion (qaxtension)

비개발자를 위한 웹 서비스 QA 유틸리티 Chrome 익스텐션 (Manifest V3).

QA 전담팀 없이 모두가 QA에 참여하는 환경에서, 비개발자도 개발자 도구 없이
현재 페이지의 스타일·API·에러를 검사하고, 개발자가 바로 이해할 수 있는
형태로 문제를 정리·전달할 수 있게 돕는다.

## 개발

```bash
npm install
npm run dev      # CRXJS 개발 모드 (HMR)
npm run build    # dist/ 프로덕션 빌드
npm test         # 단위 테스트 (vitest)
npm run e2e      # e2e 스모크 (playwright, 실제 Chromium 필요)
npm run e2e:ci   # 디스플레이 없는 CI 환경용 (xvfb-run 래핑)
```

> e2e 테스트는 확장을 로드하기 위해 `headless: false`로 실행된다. 디스플레이가 없는
> CI 러너에서는 `npm run e2e:ci`(xvfb 필요)를 사용한다.

## 설치 (개발)

1. `npm run build`
2. `chrome://extensions` → 개발자 모드 ON → "압축해제된 확장 프로그램 로드" → `dist/` 선택
3. 툴바의 QA Companion 아이콘을 클릭하면 사이드 패널이 열린다.

## 아키텍처

5개 실행 컨텍스트가 메시지로 연결된다.

```
inject (MAIN world)  ──postMessage──▶  content (ISOLATED)  ──runtime──▶  background SW  ──Port──▶  Side Panel (React)
```

- `src/inject/` — MAIN world. fetch/XHR·에러 후킹 지점(Phase 0은 준비 신호+ping).
- `src/content/` — ISOLATED 브리지. MAIN ↔ background 중계.
- `src/background/` — service worker. tabId별 세션 store + 메시지 라우팅 + Port push.
- `src/sidepanel/` — React UI 셸 (검사·네트워크·콘솔·검증·기록·리포트 탭).
- `src/messaging/` — 컨텍스트 간 타입드 메시지 계약 + 가드.

## 상태

- [x] **Phase 0 — 토대** (빌드, 사이드 패널 셸, inject→content→background→panel 메시지 파이프라인, 단위·e2e 테스트)
- [ ] Phase 1 — 요소·스타일 검사기
- [ ] Phase 2 — API 모니터
- [ ] Phase 3 — 콘솔/에러 수집
- [ ] Phase 4 — 증거 & 리포트
- [ ] Phase 5 — 추가 검증
- [ ] Phase 6 — 행동 기록

## 문서

- 설계: `docs/superpowers/specs/2026-06-04-qa-companion-design.md`
- Phase 0 구현 계획: `docs/superpowers/plans/2026-06-04-phase0-foundation.md`
