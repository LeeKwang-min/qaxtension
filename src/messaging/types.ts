export type TabId = number;

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
  payload: { type: 'PING'; nonce: string };
}

/** chrome.runtime 메시지 (content↔background 양방향 공유 union) */
export type RuntimeMessage =
  | { type: 'INJECT_READY' }
  | { type: 'PING_REPLY'; nonce: string }
  | { type: 'PING'; nonce: string };

/** tabId별 세션 상태 */
export interface TabSessionState {
  tabId: TabId;
  url: string | null;
  injectReady: boolean;
  lastPingNonce: string | null;
  updatedAt: number;
}

/** 사이드 패널 ↔ background 의 long-lived Port 메시지 */
export type PortMessage =
  | { type: 'SUBSCRIBE'; tabId: TabId }
  | { type: 'PING'; tabId: TabId }
  | { type: 'STATE_UPDATE'; state: TabSessionState };
