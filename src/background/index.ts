import { getTabState, updateTabState, clearTabState } from './store';
import type { RuntimeMessage, PortMessage, TabId } from '../messaging/types';

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
    } else if (msg.type === 'PING') {
      const n = nonce();
      pendingNonces.set(msg.tabId, n);
      updateTabState(msg.tabId, { lastPingNonce: null });
      const cmd: RuntimeMessage = { type: 'PING', nonce: n };
      chrome.tabs.sendMessage(msg.tabId, cmd).catch(() => {});
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
