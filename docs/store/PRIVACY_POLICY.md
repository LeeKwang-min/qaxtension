# QA Companion — 개인정보처리방침 / Privacy Policy

최종 수정일 / Last updated: 2026-06-08

> 📌 **호스팅 안내**: 이 문서를 공개 URL로 게시해야 합니다(예: GitHub Pages, Notion 공개 페이지).
> 그 URL을 Chrome 웹 스토어 대시보드의 "개인정보처리방침" 칸에 입력하세요.
> 아래 `[연락처 이메일]` 자리표시자를 실제 공개용 이메일로 교체하세요.

---

## 한국어

### 1. 개요
QA Companion(이하 "본 확장 프로그램")은 비개발자도 웹 서비스의 품질을 점검할 수 있도록 돕는 QA 유틸리티입니다. 본 확장 프로그램은 사용자가 직접 검사를 실행한 웹 페이지에 한해 동작하며, 수집한 데이터는 **사용자의 브라우저 내부에만 저장**됩니다.

### 2. 수집하는 정보
본 확장 프로그램은 사용자가 검사를 실행한 시점에, 검사 대상 페이지로부터 다음 정보를 **로컬에서** 처리합니다.

| 구분 | 내용 |
|---|---|
| 콘솔 로그 | 검사 대상 페이지가 출력하는 콘솔 메시지 |
| 네트워크 요청 정보 | 요청 URL, 메서드, 상태 코드, 타이밍, 캐시 여부 (요청/응답 메타데이터) |
| 성능 지표 | 페이지 로딩 및 렌더링 관련 측정값 |
| 사용자 행동 기록 | 재현 절차 작성을 위한 클릭·입력·이동 기록 (※ 비밀번호 입력은 마스킹되며, 긴 입력값은 잘려서 저장됨) |
| DOM·요소 정보 | 페이지 구조, 요소 속성, 색상, 접근성 점검 결과 |
| 스토리지 점검 | 검사 대상 페이지의 쿠키·localStorage·sessionStorage 항목 (점검 목적의 읽기) |
| 화면 캡처 | 현재 탭의 보이는 영역 스크린샷 (사용자가 캡처를 실행한 경우) |
| JIRA 연동 설정 (선택) | 사용자가 JIRA 연동을 설정한 경우에 한해 JIRA 사이트 URL·이메일·API 토큰 (브라우저 로컬에만 저장) |

### 3. 정보의 이용 목적
수집된 정보는 오직 **QA 리포트 생성 및 화면 표시**(버그 재현 절차, 네트워크·콘솔·성능·접근성 점검 결과 정리), 그리고 사용자가 직접 설정한 경우의 **JIRA 티켓 생성**에만 사용됩니다.

### 4. 정보의 저장 및 보관
- 모든 데이터는 기본적으로 사용자의 브라우저(확장 프로그램 로컬 저장소) 내에만 저장됩니다. JIRA 연동 설정(사이트·이메일·API 토큰)도 사용자의 브라우저 로컬 저장소에만 저장됩니다.
- 본 확장 프로그램은 자체 서버를 운영하지 않으며, 분석·광고 목적으로 어떠한 외부 서버로도 사용자 데이터를 전송하지 않습니다.
- **예외 — JIRA 연동:** 사용자가 JIRA 연동을 직접 설정하고 "티켓 생성"을 실행하는 경우에 한해, 선택한 QA 리포트 데이터(요약·환경 정보·네트워크/콘솔 요약·재현 절차·스크린샷)가 **사용자가 지정한 JIRA 인스턴스로 전송**됩니다. 이 전송은 오직 사용자의 명시적 행동에 의해서만 발생합니다.
- 단, 링크 유효성 검사 기능을 사용하는 경우, 사용자가 검사 대상으로 지정한 페이지에 포함된 링크 주소로 직접 접속하여 응답 상태만 확인합니다(해당 링크의 서버로 데이터를 별도 전송하지 않음).
- 데이터는 사용자가 삭제하거나 확장 프로그램을 제거하면 사라집니다.

### 5. 정보의 제3자 제공
본 확장 프로그램은 사용자 데이터를 판매하거나, 광고·신용평가 등 핵심 기능과 무관한 목적으로 사용·공유하지 않습니다. 유일한 외부 전송은 위 4항의 JIRA 연동이며, 이는 **사용자 본인이 설정한 사용자 자신의 JIRA 워크스페이스**로 사용자의 지시에 따라 이루어집니다. 전송된 데이터는 Atlassian의 개인정보처리방침에 따라 처리됩니다.

### 6. 사용자의 권리
사용자는 언제든지 확장 프로그램 내 데이터를 삭제하거나, 확장 프로그램을 제거하여 모든 로컬 데이터를 삭제할 수 있습니다.

### 7. 문의
개인정보 처리에 관한 문의: dltkdtn56@naver.com (제공자: 이광민)

---

## English

### 1. Overview
QA Companion ("the Extension") is a QA utility that helps non-developers inspect the quality of web services. The Extension operates only on pages where the user explicitly runs an inspection, and all collected data is **stored solely within the user's browser**.

### 2. Information We Collect
When the user runs an inspection, the Extension processes the following information **locally** from the inspected page:

| Category | Description |
|---|---|
| Console logs | Console messages emitted by the inspected page |
| Network request info | Request URL, method, status code, timing, cache status (request/response metadata) |
| Performance metrics | Page load and rendering measurements |
| User action recording | Click / input / navigation steps for reproduction notes (passwords are masked; long input values are truncated) |
| DOM & element info | Page structure, element attributes, colors, accessibility results |
| Storage inspection | Cookies, localStorage, and sessionStorage of the inspected page (read for inspection purposes) |
| Screenshot | Visible area of the current tab (only when the user triggers a capture) |
| JIRA integration settings (optional) | Only if the user configures JIRA: the JIRA site URL, email, and API token (stored locally in the browser only) |

### 3. How We Use Information
Collected information is used **only to generate and display QA reports** (bug reproduction steps; network, console, performance, and accessibility findings), and to create JIRA tickets when the user has explicitly configured the integration.

### 4. Data Storage & Retention
- By default, all data is stored only within the user's browser (the Extension's local storage). JIRA integration settings (site, email, API token) are also stored only in the browser's local storage.
- The Extension runs no server of its own and transmits no user data to any external server for analytics or advertising.
- **Exception — JIRA integration:** Only when the user has configured the JIRA integration and clicks "Create ticket", the selected QA report data (summary, environment info, network/console summary, reproduction steps, screenshot) is **sent to the JIRA instance specified by the user**. This transfer happens solely as a result of the user's explicit action.
- When the link-checking feature is used, the Extension contacts the link URLs found on the user-inspected page solely to verify their response status (no separate data is sent to those servers).
- Data is removed when the user deletes it or uninstalls the Extension.

### 5. Third-Party Sharing
The Extension does not sell user data, nor use or share it for advertising, creditworthiness, or any purpose unrelated to its core functionality. The only external transfer is the JIRA integration described in section 4, which sends data to **the user's own JIRA workspace, configured by the user, at the user's direction**. Transferred data is then handled under Atlassian's privacy policy.

### 6. Your Rights
Users may delete data within the Extension at any time, or uninstall the Extension to remove all local data.

### 7. Contact
For privacy inquiries: dltkdtn56@naver.com (제공자: 이광민)
