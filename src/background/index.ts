import { getTabState, updateTabState, clearTabState } from './store';
import type { RuntimeMessage, PortMessage, TabId } from '../messaging/types';
import { recordFromStart, applyEnd, pushBounded } from '../capture/network';

// 액션 아이콘 클릭 시 사이드 패널 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// tabId → 연결된 패널 Port 집합
const panelPorts = new Map<TabId, Set<chrome.runtime.Port>>();
// tabId → 발신했지만 아직 응답받지 못한 PING nonce (상관관계 검증용)
const pendingNonces = new Map<TabId, string>();

function pushState(tabId: TabId): void {
  const ports = panelPorts.get(tabId);
  if (!ports || ports.size === 0) return;
  const state = getTabState(tabId);
  const msg: PortMessage = { type: 'STATE_UPDATE', state };
  for (const port of ports) {
    try {
      port.postMessage(msg);
    } catch {
      // 이미 끊긴 포트 — 집합에서 제거
      ports.delete(port);
    }
  }
}

function nonce(): string {
  return Math.random().toString(36).slice(2);
}

// content script → background
chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  // content 로부터 온 어떤 메시지든(NET_START·PING_REPLY·ELEMENT_PICKED 등) 주입이
  // 살아있다는 증거다. 단일 INJECT_READY 핸드셰이크가 로더 경합으로 유실되거나
  // 네비게이션 초기화로 readiness 가 stale 해져도, 후속 메시지로 복구한다.
  // (네트워크는 잡히는데 헤더가 "대기 중" 으로 남는 모순을 방지)
  if (!getTabState(tabId).injectReady) {
    updateTabState(tabId, { injectReady: true, url: sender.tab?.url ?? getTabState(tabId).url });
    pushState(tabId);
  }
  switch (msg.type) {
    case 'INJECT_READY':
      updateTabState(tabId, { injectReady: true, url: sender.tab?.url ?? null });
      pushState(tabId);
      break;
    case 'PING_REPLY': {
      // 우리가 보낸 nonce 와 일치하는 응답만 수용 (stale/위조 응답 무시)
      const pending = pendingNonces.get(tabId);
      if (pending != null && msg.nonce === pending) {
        pendingNonces.delete(tabId);
        updateTabState(tabId, { lastPingNonce: msg.nonce });
        pushState(tabId);
      }
      break;
    }
    case 'ELEMENT_PICKED':
      updateTabState(tabId, { pickedElement: msg.info, picking: false });
      pushState(tabId);
      break;
    case 'PICK_CANCELLED':
      updateTabState(tabId, { picking: false });
      pushState(tabId);
      break;
    case 'NET_START': {
      const state = getTabState(tabId);
      updateTabState(tabId, { requests: pushBounded(state.requests, recordFromStart(msg.record)) });
      pushState(tabId);
      break;
    }
    case 'NET_END': {
      const state = getTabState(tabId);
      const next = state.requests.map((r) => (r.id === msg.id ? applyEnd(r, msg.end) : r));
      updateTabState(tabId, { requests: next });
      pushState(tabId);
      break;
    }
    // 'PING' 은 background→content 방향이라 여기선 무시
  }
});

// 사이드 패널 Port 연결
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'qaxtension-panel') return;
  let boundTab: TabId | null = null;

  port.onMessage.addListener((msg: PortMessage) => {
    if (msg.type === 'SUBSCRIBE') {
      boundTab = msg.tabId;
      let set = panelPorts.get(msg.tabId);
      if (!set) {
        set = new Set();
        panelPorts.set(msg.tabId, set);
      }
      set.add(port);
      port.postMessage({ type: 'STATE_UPDATE', state: getTabState(msg.tabId) } satisfies PortMessage);
      // 살아있는 content/inject 에게 현재 readiness 재확인 요청.
      // (SW 재시작으로 store 가 비었거나 패널을 늦게 연 경우를 복구한다.
      //  content 가 없으면 sendMessage 가 조용히 실패 → 상태는 그대로 '대기 중')
      const resync: RuntimeMessage = { type: 'RESYNC' };
      chrome.tabs.sendMessage(msg.tabId, resync).catch(() => {});
    } else if (msg.type === 'PING') {
      const n = nonce();
      pendingNonces.set(msg.tabId, n);
      updateTabState(msg.tabId, { lastPingNonce: null });
      const cmd: RuntimeMessage = { type: 'PING', nonce: n };
      chrome.tabs.sendMessage(msg.tabId, cmd).catch(() => {});
    } else if (msg.type === 'PICK_START') {
      updateTabState(msg.tabId, { picking: true, pickedElement: null });
      pushState(msg.tabId);
      const cmd: RuntimeMessage = { type: 'PICK_START' };
      chrome.tabs.sendMessage(msg.tabId, cmd).catch(() => {
        // content 가 없으면(미주입 페이지) 피커를 켤 수 없으므로 picking 복구
        updateTabState(msg.tabId, { picking: false });
        pushState(msg.tabId);
      });
    } else if (msg.type === 'PICK_STOP') {
      updateTabState(msg.tabId, { picking: false });
      const cmd: RuntimeMessage = { type: 'PICK_STOP' };
      chrome.tabs.sendMessage(msg.tabId, cmd).catch(() => {});
      pushState(msg.tabId);
    } else if (msg.type === 'NETWORK_CLEAR') {
      updateTabState(msg.tabId, { requests: [] });
      pushState(msg.tabId);
    }
  });

  port.onDisconnect.addListener(() => {
    if (boundTab != null) panelPorts.get(boundTab)?.delete(port);
  });
});

// 네비게이션/리로드 시 상태 초기화
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // 'loading' 진입 시 url 유무와 무관하게 상태를 초기화한다.
  // (Chrome 은 url 변경과 status 전이를 별도 이벤트로 보낼 수 있다)
  if (info.status === 'loading') {
    clearTabState(tabId);
    pendingNonces.delete(tabId);
    if (info.url) updateTabState(tabId, { url: info.url });
    pushState(tabId);
  } else if (info.url) {
    // status 전이 없이 url 만 갱신되는 경우 (예: history.pushState 동반 네비)
    updateTabState(tabId, { url: info.url });
    pushState(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
  pendingNonces.delete(tabId);
  panelPorts.delete(tabId);
});
