export type TabId = number;

/** 요청/응답 본문 캡처 (대용량은 절단) */
export interface BodyCapture {
  /** 절단됐을 수 있는 본문 텍스트 */
  text: string;
  /** 절단 여부 (UI 표시용) */
  truncated: boolean;
  /** 원본 길이(문자 수) */
  size: number;
  /** content-type 헤더 (없으면 null) */
  contentType: string | null;
}

/** 네트워크 요청 출처 ('webRequest' 는 chrome.webRequest 보조 소스) */
export type NetworkSource = 'fetch' | 'xhr' | 'webRequest';

/** chrome.webRequest 가 제공하는 보조 종료 정보 (본문 없음) */
export interface WebReqEnd {
  /** chrome.webRequest requestId (재이벤트/리다이렉트 추적용) */
  requestId: string;
  method: string;
  url: string;
  /** epoch ms (onCompleted/onErrorOccurred timeStamp) */
  timeStamp: number;
  /** onCompleted 의 statusCode, onErrorOccurred 면 null */
  status: number | null;
  /** onErrorOccurred 의 error 문자열(net::ERR_...), 성공이면 null */
  error: string | null;
  /** 캐시에서 응답됐는지 */
  fromCache: boolean;
}

/** inject 가 요청 시작 시 보내는 페이로드 */
export interface NetStart {
  id: string;
  source: NetworkSource;
  method: string;
  url: string;
  startedAt: number; // epoch ms
  requestBody: BodyCapture | null;
}

/** inject 가 요청 완료/실패 시 보내는 페이로드 (부분 갱신) */
export interface NetEnd {
  status?: number;
  statusText?: string;
  ok?: boolean;
  durationMs?: number;
  responseBody?: BodyCapture | null;
  /** 네트워크 오류/CORS 차단 시 메시지 (성공이면 없음) */
  error?: string;
}

/** 정규화된 네트워크 요청 레코드 (store/패널 표시 단위) */
export interface RequestRecord {
  id: string;
  source: NetworkSource;
  method: string;
  url: string;
  /** 진행 중이거나 네트워크 오류면 null */
  status: number | null;
  statusText: string | null;
  /** 2xx~3xx 면 true, 4xx/5xx 면 false, 진행 중/오류면 null */
  ok: boolean | null;
  /** 네트워크 오류/CORS 메시지 (없으면 null) */
  error: string | null;
  startedAt: number;
  durationMs: number | null;
  requestBody: BodyCapture | null;
  responseBody: BodyCapture | null;
  /** chrome.webRequest 가 캐시 응답이라고 보고했으면 true (없으면 null) */
  fromCache: boolean | null;
  /** 이 레코드를 보완한 webRequest requestId (재이벤트 매칭용, 미보완이면 null) */
  webReqId: string | null;
}

/** 트리맵 타일 한 칸 (host 또는 path 그룹 집계) */
export interface TreemapCell {
  /** 그룹 라벨 (host 또는 첫 path 세그먼트) */
  key: string;
  count: number;
  errorCount: number;
  /** 0~1 */
  errorRate: number;
  /** 원본(절단 전) 응답 본문 크기 합계(문자 수) */
  bytes: number;
}

/**
 * 리소스(이미지 등) 로딩 성능 한 건 — ResourceTiming 분해.
 * 네트워크 단계를 나눠 "서버 응답 대기(TTFB)" 와 "전송(다운로드)" 을 구분할 수 있게 한다.
 */
export interface PerfResource {
  id: string;
  url: string;
  /** initiatorType (예: 'img') */
  initiatorType: string;
  startedAt: number; // epoch ms
  /** 전체 소요 (responseEnd - startTime) */
  durationMs: number;
  /** 서버 응답 시작까지 (responseStart - requestStart). cross-origin TAO 없으면 null */
  ttfbMs: number | null;
  /** 본문 다운로드 (responseEnd - responseStart). TAO 없으면 null */
  downloadMs: number | null;
  /** 전송 바이트 (캐시면 0, 모르면 null) */
  transferSize: number | null;
  /** 디코드된 본문 크기 (모르면 null) */
  decodedBodySize: number | null;
  /** 캐시에서 제공됐는지(추정) */
  fromCache: boolean;
}

/** 로그 레벨 (v1 은 문제 신호인 error/warn 만 수집) */
export type LogLevel = 'error' | 'warn';

/** 로그 출처 */
export type LogSource = 'console' | 'onerror' | 'unhandledrejection';

/** inject 가 발신하는 로그 이벤트 (인자는 inject 에서 문자열로 직렬화 완료) */
export interface LogEvent {
  level: LogLevel;
  source: LogSource;
  /** 직렬화된 메시지 텍스트 */
  text: string;
  /** 스택 트레이스 (없으면 null) */
  stack: string | null;
  /** onerror 의 filename:line:col 등 위치 (없으면 null) */
  location: string | null;
  at: number; // epoch ms
}

/** 정규화된 로그 레코드 (store/패널 표시 단위) */
export interface LogRecord {
  id: string;
  level: LogLevel;
  source: LogSource;
  text: string;
  stack: string | null;
  location: string | null;
  /** 연속 동일 로그 병합 횟수 (1 이상) */
  count: number;
  firstAt: number;
  lastAt: number;
}

/** 색상 한 항목 — 스와치/표시용 */
export interface ColorInfo {
  /** 원본 computed 값 (예: 'rgb(255, 0, 0)') */
  raw: string;
  /** HEX 변환 (예: '#ff0000'), 투명은 'transparent' */
  hex: string;
}

/** 대비비 + WCAG 등급 */
export interface ContrastInfo {
  ratio: number; // 예: 4.53
  level: 'AAA' | 'AA' | 'Fail';
}

/** 선택된 요소의 검사 정보 */
export interface ElementInfo {
  tagName: string;
  id: string | null;
  classList: string[];
  selector: string;
  /** body 기준 DOM 트리 인덱스 경로 (트리 동기화용, body 밖이면 null) */
  domPath: number[] | null;
  text: string | null;
  colors: {
    color: ColorInfo;
    backgroundColor: ColorInfo;
    borderColor: ColorInfo;
  };
  typography: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
  };
  boxModel: {
    width: string;
    height: string;
    margin: string;
    padding: string;
    borderRadius: string;
    border: string;
  };
  accessibility: {
    contrast: ContrastInfo | null; // 배경이 투명하면 null
    alt: string | null;
    role: string | null;
    ariaLabel: string | null;
  };
}

/** best-effort 로그인 사용자 추정 (보장값 아님) */
export interface LoginGuess {
  /** 발견된 키 (예: 'email', 'token') */
  key: string;
  /** 출처 ('localStorage' | 'cookie') */
  from: 'localStorage' | 'cookie';
  /** 값 (민감정보 보호 위해 절단) */
  value: string;
}

/** 리포트용 환경정보 (best-effort, 페이지 컨텍스트에서 수집) */
export interface EnvInfo {
  url: string | null;
  userAgent: string;
  /** navigator.platform 등 원시 플랫폼 힌트 */
  platform: string;
  /** UA 에서 파싱한 사람이 읽는 OS 라벨 (예: 'macOS') */
  os: string;
  language: string;
  viewport: { width: number; height: number; dpr: number };
  screen: { width: number; height: number };
  /** best-effort 로그인 추정 (없으면 null) */
  loginGuess: LoginGuess | null;
  collectedAt: number; // epoch ms
}

// ── Phase 5: 추가 자동 검증 (audit) ──────────────────────────

/** 접근성 이슈 종류 */
export type A11yKind =
  | 'img-alt' // <img> alt 누락
  | 'control-name' // 버튼/링크에 접근가능 이름 없음
  | 'input-label' // 입력에 연결된 label/aria 없음
  | 'html-lang' // <html lang> 누락
  | 'contrast'; // 텍스트 색 대비 WCAG Fail

/** 접근성 이슈 한 건 */
export interface A11yIssue {
  kind: A11yKind;
  /** 위반 요소 selector (html-lang 은 'html') */
  selector: string;
  /** 비개발자용 평이한 설명 */
  message: string;
  severity: 'error' | 'warn';
}

/** 페이지가 참조하는 리소스 종류 */
export type ResourceKind = 'img' | 'link' | 'stylesheet' | 'script';

/** 수집된 리소스 참조 한 건 */
export interface ResourceRef {
  kind: ResourceKind;
  /** 절대 URL */
  url: string;
  /** 참조 요소 selector */
  selector: string;
  /** 이미지가 DOM 상 깨진(로드 실패) 것으로 확정됐는지 (img 외엔 false) */
  broken: boolean;
}

/** 링크/리소스 HTTP 상태 검증 결과 (background fetch) */
export interface LinkCheck {
  url: string;
  /** HTTP 상태코드 (네트워크 오류면 null) */
  status: number | null;
  /** 2xx~3xx 면 true */
  ok: boolean;
  /** 네트워크 오류 메시지 (없으면 null) */
  error: string | null;
}

/** 스토리지 항목 한 건 (localStorage) */
export interface StorageItem {
  key: string;
  value: string;
  /** 민감해 보여 마스킹된 값인지 */
  masked: boolean;
}

/** 쿠키 한 건 (chrome.cookies, httpOnly 포함) */
export interface CookieItem {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  masked: boolean;
}

/** 스토리지/쿠키 뷰어 모델 */
export interface StorageView {
  local: StorageItem[];
  cookies: CookieItem[];
}

/** 반응형 뷰포트 프리셋 */
export interface ViewportPreset {
  label: string;
  width: number;
  height: number;
}

/** content 가 보내는 audit 원시 수집 (쿠키/링크 검증 전) */
export interface AuditRaw {
  a11y: A11yIssue[];
  resources: ResourceRef[];
  /** localStorage 항목 (content 만 접근 가능) */
  local: StorageItem[];
  ranAt: number; // epoch ms
}

/** 최종 audit 결과 (store/패널 표시 단위) */
export interface AuditResult {
  a11y: A11yIssue[];
  resources: ResourceRef[];
  /** 링크/리소스 HTTP 검증 결과 (background fetch) */
  links: LinkCheck[];
  storage: StorageView;
  ranAt: number; // epoch ms
}

// ── Phase 6: 행동 기록 (recorder) ────────────────────────────

/** 기록되는 상호작용 종류 */
export type StepKind =
  | 'click' // 버튼·링크·클릭형 컨트롤 클릭
  | 'input' // 텍스트/textarea 입력
  | 'select' // <select> 옵션 선택
  | 'check' // checkbox/radio 체크 토글
  | 'navigate'; // 페이지 이동(네비게이션)

/** content 가 보내는 원시 상호작용 이벤트 (id 부여 전) */
export interface InteractionEvent {
  kind: StepKind;
  /** 대상 요소 시그니처 (태그#id.클래스[name/type], navigate 면 null) */
  selector: string | null;
  /** 사람이 읽는 요소 라벨 (버튼 텍스트·input 이름 등, 없으면 null) */
  label: string | null;
  /** input/select 값, check 는 'on'|'off', navigate 는 URL (없으면 null) */
  value: string | null;
  /** 요소가 속한 영역 이름 (모달·폼·섹션 등, '확인' 버튼 특정용, 없으면 null) */
  context: string | null;
  /** 같은 영역의 다른 라벨·버튼 텍스트 (요소 자신은 제외, 위치 단서) */
  nearby: string[];
  at: number; // epoch ms
}

/** id 가 부여된 기록 스텝 (store/패널 표시 단위) */
export interface Step extends InteractionEvent {
  id: string;
}

/** 리포트 빌더 입력 (세션 스냅샷) */
export interface ReportInput {
  generatedAt: number; // epoch ms
  env: EnvInfo | null;
  pickedElement: ElementInfo | null;
  requests: RequestRecord[];
  logs: LogRecord[];
  /** 기록된 재현 절차 스텝 */
  steps: Step[];
  /** 주석 적용된 스크린샷 dataURL (없으면 null) */
  screenshot: string | null;
}

/** 리포트 첨부 파일 디스크립터 (zip 번들용) */
export interface ReportAttachment {
  /** 파일명 (예: 'screenshot.png') */
  name: string;
  /** image/png dataURL */
  dataUrl: string;
}

// ── DOM 트리 뷰어 ────────────────────────────────────────────
// (DomNode 타입은 inspect/dom-tree.ts 가 소유. 메시지에서는 구조적으로 호환되는
//  형태를 직접 기술해 messaging 의 의존 방향을 깨지 않는다.)

/** 경량 DOM 노드 (트리 표시용) */
export interface DomTreeNode {
  tagName: string;
  id: string | null;
  classList: string[];
  childElementCount: number;
  textPreview: string | null;
  path: number[];
}

/** MAIN world(inject) → ISOLATED(content) 로 가는 메시지 봉투 */
export interface InjectEnvelope {
  source: 'qaxtension-inject';
  payload:
    | { type: 'INJECT_READY' }
    | { type: 'PING_REPLY'; nonce: string }
    | { type: 'NET_START'; record: NetStart }
    | { type: 'NET_END'; id: string; end: NetEnd }
    | { type: 'LOG'; event: LogEvent }
    | { type: 'PERF_RESOURCE'; resource: PerfResource };
}

/** ISOLATED(content) → MAIN world(inject) 로 가는 명령 봉투 */
export interface CmdEnvelope {
  source: 'qaxtension-cmd';
  payload:
    | { type: 'PING'; nonce: string }
    // 현재 readiness 를 다시 알려달라는 요청 (inject 는 INJECT_READY 를 재발신)
    | { type: 'RESYNC' };
}

/** chrome.runtime 메시지 (content↔background 양방향 공유 union) */
export type RuntimeMessage =
  | { type: 'INJECT_READY' }
  | { type: 'PING_REPLY'; nonce: string }
  | { type: 'PING'; nonce: string }
  | { type: 'RESYNC' }
  // background → content: 요소 피커 제어
  | { type: 'PICK_START' }
  | { type: 'PICK_STOP' }
  // content → background: 피커 결과
  | { type: 'ELEMENT_PICKED'; info: ElementInfo }
  | { type: 'PICK_CANCELLED' }
  // content → background: 피커 호버 중인 요소 정보 (실시간 미리보기)
  | { type: 'ELEMENT_HOVERED'; info: ElementInfo }
  // content → background: 네트워크 캡처 중계
  | { type: 'NET_START'; record: NetStart }
  | { type: 'NET_END'; id: string; end: NetEnd }
  // content → background: 콘솔/에러 로그 중계
  | { type: 'LOG'; event: LogEvent }
  // content → background: 리소스(이미지) 로딩 성능 중계
  | { type: 'PERF_RESOURCE'; resource: PerfResource }
  // background → content: 환경정보 수집 요청
  | { type: 'COLLECT_ENV' }
  // content → background: 환경정보 수집 결과
  | { type: 'ENV_RESULT'; env: EnvInfo }
  // background → content: 자동 검증 실행 요청
  | { type: 'RUN_AUDIT' }
  // content → background: 자동 검증 원시 수집 결과
  | { type: 'AUDIT_RESULT'; raw: AuditRaw }
  // background → content: DOM 트리 자식 조회
  | { type: 'DOM_CHILDREN'; path: number[] }
  // content → background: DOM 트리 자식 결과
  | { type: 'DOM_CHILDREN_RESULT'; path: number[]; nodes: DomTreeNode[] }
  // background → content: 경로로 요소 검사 (트리에서 선택)
  | { type: 'INSPECT_PATH'; path: number[] }
  // background → content: 경로 요소 하이라이트 (path=null 이면 숨김)
  | { type: 'HIGHLIGHT_PATH'; path: number[] | null }
  // background → content: 행동 기록 시작/중지 (capture-phase 리스너 무장/해제)
  | { type: 'RECORD_START' }
  | { type: 'RECORD_STOP' }
  // content → background: 기록된 상호작용 한 건
  | { type: 'INTERACTION'; event: InteractionEvent };

/** tabId별 세션 상태 */
export interface TabSessionState {
  tabId: TabId;
  url: string | null;
  injectReady: boolean;
  lastPingNonce: string | null;
  picking: boolean;
  pickedElement: ElementInfo | null;
  /** 피커 호버 중인 요소 (picking 중 실시간 미리보기, 아니면 null) */
  hoveredElement: ElementInfo | null;
  requests: RequestRecord[];
  logs: LogRecord[];
  /** 이미지 등 리소스 로딩 성능 (ResourceTiming) */
  perfResources: PerfResource[];
  /** 마지막으로 수집한 환경정보 (없으면 null) */
  env: EnvInfo | null;
  /** 마지막 자동 검증 결과 (없으면 null) */
  audit: AuditResult | null;
  /** 네트워크 캡처 일시중지 여부 (true 면 새 요청을 쌓지 않음) */
  networkPaused: boolean;
  /** 행동 기록 진행 여부 (네비게이션을 건너 유지됨) */
  recording: boolean;
  /** 기록된 재현 절차 스텝 (네비게이션을 건너 누적) */
  steps: Step[];
  updatedAt: number;
}

/** 사이드 패널 ↔ background 의 long-lived Port 메시지 */
export type PortMessage =
  | { type: 'SUBSCRIBE'; tabId: TabId }
  | { type: 'PING'; tabId: TabId }
  // 패널 → background: 요소 피커 토글
  | { type: 'PICK_START'; tabId: TabId }
  | { type: 'PICK_STOP'; tabId: TabId }
  // 패널 → background: 고정된 선택 요소 해제
  | { type: 'CLEAR_PICKED'; tabId: TabId }
  // 패널 → background: 네트워크 기록 초기화
  | { type: 'NETWORK_CLEAR'; tabId: TabId }
  // 패널 → background: 콘솔 로그 초기화
  | { type: 'CONSOLE_CLEAR'; tabId: TabId }
  // 패널 → background: 네트워크 캡처 일시중지/재개
  | { type: 'NETWORK_SET_PAUSED'; tabId: TabId; paused: boolean }
  // 패널 → background: 행동 기록 시작/중지
  | { type: 'RECORD_SET_ACTIVE'; tabId: TabId; active: boolean }
  // 패널 → background: 기록된 스텝 초기화
  | { type: 'RECORD_CLEAR'; tabId: TabId }
  // 패널 → background: 보이는 영역 스크린샷 캡처 요청
  | { type: 'CAPTURE_SCREENSHOT'; tabId: TabId }
  // background → 패널: 스크린샷 결과 (단발성, 대용량이라 state 에 싣지 않음)
  | { type: 'SCREENSHOT_RESULT'; dataUrl: string | null; error?: string }
  // 패널 → background: 환경정보 수집 요청
  | { type: 'COLLECT_ENV'; tabId: TabId }
  // 패널 → background: 자동 검증 실행
  | { type: 'RUN_AUDIT'; tabId: TabId }
  // 패널 → background: 반응형 프리셋으로 윈도우 리사이즈
  | { type: 'RESIZE_WINDOW'; tabId: TabId; width: number; height: number }
  // 패널 → background: content/inject 강제 재주입 (탭 전환·SPA·설치 전 로드 복구)
  | { type: 'REINJECT'; tabId: TabId }
  // 패널 → background: DOM 트리 자식 조회
  | { type: 'DOM_CHILDREN'; tabId: TabId; path: number[] }
  // 패널 → background: 경로로 요소 검사 (트리에서 선택)
  | { type: 'INSPECT_PATH'; tabId: TabId; path: number[] }
  // 패널 → background: 경로 요소 하이라이트 (path=null 이면 숨김)
  | { type: 'HIGHLIGHT_PATH'; tabId: TabId; path: number[] | null }
  // background → 패널: DOM 트리 자식 결과 (단발성, state 에 싣지 않음)
  | { type: 'DOM_CHILDREN_RESULT'; path: number[]; nodes: DomTreeNode[] }
  | { type: 'STATE_UPDATE'; state: TabSessionState };
