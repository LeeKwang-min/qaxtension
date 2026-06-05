import type { StorageItem, CookieItem, StorageView } from '../messaging/types';

/** 민감해 보이는 키 패턴 (값을 마스킹) */
const SENSITIVE = /(token|password|passwd|secret|auth|jwt|session|api[-_]?key|credential|bearer)/i;

/** 쿠키 입력 (chrome.cookies.Cookie 의 부분 집합) */
export interface CookieLike {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
}

/** 민감 키면 값을 마스킹한다. (앞 2자만 노출 + 길이 힌트) */
export function maskIfSensitive(key: string, value: string): { value: string; masked: boolean } {
  if (!SENSITIVE.test(key)) return { value, masked: false };
  const head = value.slice(0, 2);
  return { value: `${head}••••(${value.length}자)`, masked: true };
}

/** localStorage + 쿠키를 정렬·마스킹된 뷰어 모델로 변환한다. */
export function toStorageEntries(local: { key: string; value: string }[], cookies: CookieLike[]): StorageView {
  const localItems: StorageItem[] = local
    .map((e) => {
      const m = maskIfSensitive(e.key, e.value);
      return { key: e.key, value: m.value, masked: m.masked };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const cookieItems: CookieItem[] = cookies
    .map((c) => {
      const m = maskIfSensitive(c.name, c.value);
      return {
        name: c.name,
        value: m.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        masked: m.masked,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { local: localItems, cookies: cookieItems };
}
