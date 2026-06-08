import type { JiraConfig } from '../../messaging/types';

/** chrome.storage.local 에 사용하는 스토리지 키 */
const KEY = 'jiraConfig';

/** chrome.storage.local 의 필요한 부분만 추상화(테스트 주입용) */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 기본값: 실제 chrome.storage.local (프로덕션 경로) */
function defaultArea(): StorageArea {
  return chrome.storage.local as unknown as StorageArea;
}

/** 저장된 Jira 설정을 불러온다. 없으면 null 반환 */
export async function loadSettings(area: StorageArea = defaultArea()): Promise<JiraConfig | null> {
  const got = await area.get(KEY);
  const v = got[KEY];
  return v ? (v as JiraConfig) : null;
}

/** Jira 설정을 chrome.storage.local 에 저장한다 */
export async function saveSettings(cfg: JiraConfig, area: StorageArea = defaultArea()): Promise<void> {
  await area.set({ [KEY]: cfg });
}

/** 저장된 Jira 설정을 제거한다 */
export async function clearSettings(area: StorageArea = defaultArea()): Promise<void> {
  await area.remove(KEY);
}
