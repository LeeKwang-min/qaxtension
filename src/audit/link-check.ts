import type { LinkCheck } from '../messaging/types';

/** 주입 가능한 fetch 시그니처 (테스트는 모킹, 런타임은 전역 fetch) */
export type FetchFn = (url: string, init?: { method?: string; signal?: AbortSignal }) => Promise<Response>;

/** HEAD 가 거부될 때 GET 으로 재시도할 상태코드 */
const HEAD_UNSUPPORTED = new Set([405, 501]);

async function checkOne(url: string, fetchFn: FetchFn): Promise<LinkCheck> {
  try {
    let resp = await fetchFn(url, { method: 'HEAD' });
    if (HEAD_UNSUPPORTED.has(resp.status)) {
      resp = await fetchFn(url, { method: 'GET' });
    }
    return { url, status: resp.status, ok: resp.ok, error: null };
  } catch (e) {
    return { url, status: null, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * URL 목록의 HTTP 상태를 동시성 제한 풀로 검증한다.
 * HEAD 우선, 405/501 이면 GET 으로 폴백. 네트워크 오류는 status:null·error 로 기록.
 */
export async function checkLinks(urls: string[], fetchFn: FetchFn, concurrency: number): Promise<LinkCheck[]> {
  const results: LinkCheck[] = new Array(urls.length);
  let next = 0;
  const limit = Math.max(1, concurrency);

  async function worker(): Promise<void> {
    while (next < urls.length) {
      const i = next++;
      results[i] = await checkOne(urls[i], fetchFn);
    }
  }

  const workers = Array.from({ length: Math.min(limit, urls.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
