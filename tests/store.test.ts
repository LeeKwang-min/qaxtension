import { describe, it, expect, beforeEach } from 'vitest';
import { getTabState, updateTabState, clearTabState } from '../src/background/store';

describe('tab session store', () => {
  beforeEach(() => clearTabState(1));

  it('creates default state on first access', () => {
    const s = getTabState(1);
    expect(s.tabId).toBe(1);
    expect(s.injectReady).toBe(false);
    expect(s.url).toBeNull();
    expect(s.lastPingNonce).toBeNull();
    expect(s.picking).toBe(false);
    expect(s.pickedElement).toBeNull();
  });

  it('merges partial patches and keeps tabId fixed', () => {
    updateTabState(1, { injectReady: true, url: 'https://x.test' });
    const s = getTabState(1);
    expect(s.injectReady).toBe(true);
    expect(s.url).toBe('https://x.test');
    expect(s.tabId).toBe(1);
  });

  it('clears state back to default', () => {
    updateTabState(1, { injectReady: true });
    clearTabState(1);
    expect(getTabState(1).injectReady).toBe(false);
  });

  it('refreshes updatedAt on update', () => {
    const before = getTabState(1).updatedAt;
    updateTabState(1, { injectReady: true });
    expect(getTabState(1).updatedAt).toBeGreaterThanOrEqual(before);
  });
});
