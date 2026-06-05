import type { TabId, TabSessionState } from '../messaging/types';

const tabs = new Map<TabId, TabSessionState>();

function createDefault(tabId: TabId): TabSessionState {
  return {
    tabId,
    url: null,
    injectReady: false,
    lastPingNonce: null,
    picking: false,
    pickedElement: null,
    requests: [],
    logs: [],
    updatedAt: Date.now(),
  };
}

/** Returns the stored state object directly; do not mutate it — use updateTabState. */
export function getTabState(tabId: TabId): TabSessionState {
  let s = tabs.get(tabId);
  if (!s) {
    s = createDefault(tabId);
    tabs.set(tabId, s);
  }
  return s;
}

export function updateTabState(
  tabId: TabId,
  patch: Partial<Omit<TabSessionState, 'tabId' | 'updatedAt'>>,
): TabSessionState {
  const current = getTabState(tabId);
  const next: TabSessionState = { ...current, ...patch, tabId, updatedAt: Date.now() };
  tabs.set(tabId, next);
  return next;
}

export function clearTabState(tabId: TabId): void {
  tabs.delete(tabId);
}
