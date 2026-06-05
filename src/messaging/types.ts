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

/** MAIN world(inject) → ISOLATED(content) 로 가는 메시지 봉투 */
export interface InjectEnvelope {
  source: 'qaxtension-inject';
  payload:
    | { type: 'INJECT_READY' }
    | { type: 'PING_REPLY'; nonce: string }
    | { type: 'NET_START'; record: NetStart }
    | { type: 'NET_END'; id: string; end: NetEnd };
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
  // content → background: 네트워크 캡처 중계
  | { type: 'NET_START'; record: NetStart }
  | { type: 'NET_END'; id: string; end: NetEnd };

/** tabId별 세션 상태 */
export interface TabSessionState {
  tabId: TabId;
  url: string | null;
  injectReady: boolean;
  lastPingNonce: string | null;
  picking: boolean;
  pickedElement: ElementInfo | null;
  requests: RequestRecord[];
  updatedAt: number;
}

/** 사이드 패널 ↔ background 의 long-lived Port 메시지 */
export type PortMessage =
  | { type: 'SUBSCRIBE'; tabId: TabId }
  | { type: 'PING'; tabId: TabId }
  // 패널 → background: 요소 피커 토글
  | { type: 'PICK_START'; tabId: TabId }
  | { type: 'PICK_STOP'; tabId: TabId }
  // 패널 → background: 네트워크 기록 초기화
  | { type: 'NETWORK_CLEAR'; tabId: TabId }
  | { type: 'STATE_UPDATE'; state: TabSessionState };
