# 권한 정당화 / Privacy Practices 입력 가이드

> Chrome 웹 스토어 대시보드의 **"개인정보 보호 관행(Privacy practices)"** 탭에 그대로 옮겨 적을 수 있도록 정리한 문서입니다.
> 영어 입력란이므로 **English** 문구를 복사해 사용하고, 한국어는 이해용입니다.

---

## 1. 단일 목적 설명 (Single purpose description)

**English (붙여넣기용):**
> QA Companion is a quality-assurance utility that lets users inspect a web page they are testing — capturing console logs, network requests, performance metrics, accessibility issues, storage entries, and reproduction steps — and compiles the findings into a QA report. Users can optionally create a JIRA ticket from a report. All processing happens locally in the browser, except that the optional JIRA ticket creation sends the report to the user's own JIRA instance at the user's explicit request.

**한국어 (이해용):**
> QA Companion은 사용자가 테스트 중인 웹 페이지를 점검하여(콘솔 로그·네트워크 요청·성능·접근성·스토리지·재현 절차 수집) 그 결과를 QA 리포트로 정리하는 품질 점검 유틸리티입니다. 사용자는 선택적으로 리포트에서 JIRA 티켓을 생성할 수 있습니다. 모든 처리는 브라우저 내부에서 이루어지며, 선택적 JIRA 티켓 생성만 사용자의 명시적 요청에 따라 사용자 본인의 JIRA로 리포트를 전송합니다.

---

## 2. 권한별 정당화 (Permission justifications)

각 권한 입력란에 아래 English 문구를 붙여넣으세요.

| 권한 | English justification (붙여넣기용) | 한국어 설명 |
|---|---|---|
| **sidePanel** | Provides the extension's main UI as a Chrome side panel where inspection results are displayed. | 점검 결과를 보여주는 메인 UI(사이드 패널) 제공 |
| **storage** | Persists user settings, the current inspection session, and (optionally) the user's JIRA connection settings locally within the browser. | 사용자 설정·현재 세션·(선택) JIRA 연결 설정을 브라우저에 로컬 저장 |
| **tabs** | Identifies the active tab being inspected and captures its visible-area screenshot for the QA report. | 검사 중인 활성 탭 식별 및 스크린샷 캡처 |
| **scripting** | Injects the inspection scripts into the inspected page to read DOM, colors, accessibility, and element info. | DOM·색상·접근성·요소 정보 수집을 위한 검사 스크립트 주입 |
| **webRequest** | Observes network requests of the inspected page to record status codes, timing, and errors for the report (observation only). | 네트워크 요청의 상태·타이밍·오류를 리포트에 기록(관찰 전용) |
| **clipboardWrite** | Lets the user copy the generated QA report and network details to the clipboard. | 생성된 리포트·네트워크 정보를 클립보드로 복사 |
| **cookies** | Reads cookies of the inspected page so the user can review storage/session state during QA. | QA 중 검사 대상 페이지의 쿠키 상태 점검 |
| **host_permissions: `<all_urls>`** | The extension must work on any website the user chooses to test; QA targets are not limited to a fixed domain, so broad host access is required to inspect the user's current page on demand. | QA 대상이 특정 도메인으로 한정되지 않으므로, 사용자가 선택한 모든 사이트에서 동작하기 위해 광범위 호스트 권한 필요 |

> 💡 `<all_urls>` + `cookies` + `webRequest` 조합은 수동 심사로 분류될 가능성이 높습니다. 위 정당화처럼 "QA 대상이 임의의 사이트라 불가피하다"는 점을 명확히 적는 것이 통과의 핵심입니다.
> JIRA 연동은 새 권한을 요구하지 않습니다(기존 `<all_urls>`로 JIRA fetch, `storage`로 설정 저장). 오히려 self-hosted JIRA도 지원하려면 임의 도메인 접근이 필요하다는 점이 `<all_urls>` 정당화를 보강합니다.

---

## 3. 데이터 사용 인증 (Data usage certifications)

대시보드에서 아래 항목을 **모두 체크**하세요 (본 확장 프로그램은 전부 준수):

- ✅ 사용자 데이터를 확장 프로그램의 핵심 기능과 무관한 목적으로 사용/전송하지 않음
- ✅ 사용자 데이터를 신용평가·대출 목적으로 사용/전송하지 않음
- ✅ 사용자 데이터를 핵심 기능과 무관한 광고 목적으로 사용/전송하지 않음

> 📌 JIRA 전송은 위 인증과 충돌하지 않습니다: ① JIRA 티켓 생성은 **핵심 기능**이고, ② 전송 대상은 **사용자 본인이 설정한 사용자 자신의 JIRA 워크스페이스**라 "제3자 판매·전송"이 아니라 사용자 지시에 의한 전송(승인된 사용 사례)입니다.

## 4. 수집 데이터 유형 신고 (Data types)

대시보드 "수집하는 데이터" 항목에서 아래 **3개를 체크**:

- ✅ **웹사이트 콘텐츠 (Website content)** — 페이지 DOM·텍스트·콘솔·네트워크 응답·스토리지 등
- ✅ **사용자 활동 (User activity)** — 네트워크 모니터링 + 클릭·입력 등 행동 기록
- ✅ **인증 정보 (Authentication information)** — `cookies` 권한으로 세션 쿠키 접근 + JIRA API 토큰을 로컬 저장(점검·연동용, 전송은 사용자 지정 JIRA로만)
- ❌ 나머지(개인 식별 정보·건강·금융·위치·웹 기록·개인 통신)는 해당 없음 (비밀번호는 기록 시 자동 마스킹)

> ⚠️ Privacy practices 탭의 신고 내용과 **PRIVACY_POLICY.md / 라이브 개인정보처리방침 페이지가 일치**해야 합니다. 불일치 시 반려됩니다. (JIRA 전송·토큰 저장이 이미 반영돼 일치함)
