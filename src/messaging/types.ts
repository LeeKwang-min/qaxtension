export type TabId = number;

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
    | { type: 'PING_REPLY'; nonce: string };
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
  | { type: 'PICK_CANCELLED' };

/** tabId별 세션 상태 */
export interface TabSessionState {
  tabId: TabId;
  url: string | null;
  injectReady: boolean;
  lastPingNonce: string | null;
  picking: boolean;
  pickedElement: ElementInfo | null;
  updatedAt: number;
}

/** 사이드 패널 ↔ background 의 long-lived Port 메시지 */
export type PortMessage =
  | { type: 'SUBSCRIBE'; tabId: TabId }
  | { type: 'PING'; tabId: TabId }
  // 패널 → background: 요소 피커 토글
  | { type: 'PICK_START'; tabId: TabId }
  | { type: 'PICK_STOP'; tabId: TabId }
  | { type: 'STATE_UPDATE'; state: TabSessionState };
