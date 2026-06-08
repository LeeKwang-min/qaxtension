import { describe, it, expect } from 'vitest';
import { loadSettings, saveSettings, clearSettings, type StorageArea } from '../src/integrations/jira/settings';
import type { JiraConfig } from '../src/messaging/types';

/** chrome.storage.local.get/set/remove 를 흉내내는 fake */
function fakeArea(initial: Record<string, unknown> = {}): StorageArea {
  let store: Record<string, unknown> = { ...initial };
  return {
    get: async (key) => ({ [key]: store[key] }),
    set: async (items) => { store = { ...store, ...items }; },
    remove: async (key) => { delete store[key]; },
  };
}

const cfg: JiraConfig = { site: 'https://acme.atlassian.net', email: 'a@b.com', token: 't0ken' };

describe('jira settings', () => {
  it('저장 후 로드하면 같은 값을 돌려준다', async () => {
    const area = fakeArea();
    await saveSettings(cfg, area);
    expect(await loadSettings(area)).toEqual(cfg);
  });

  it('저장된 값이 없으면 null', async () => {
    expect(await loadSettings(fakeArea())).toBeNull();
  });

  it('clear 후 로드하면 null', async () => {
    const area = fakeArea();
    await saveSettings(cfg, area);
    await clearSettings(area);
    expect(await loadSettings(area)).toBeNull();
  });
});
