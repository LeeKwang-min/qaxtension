import { describe, it, expect } from 'vitest';
import { checkLinks } from '../src/audit/link-check';

/** 응답을 흉내내는 가벼운 객체 */
const res = (status: number) => ({ status, ok: status >= 200 && status < 400 }) as Response;

describe('checkLinks', () => {
  it('maps 2xx to ok, 4xx/5xx to not-ok', async () => {
    const fetchFn = async (url: string) =>
      url.includes('good') ? res(200) : url.includes('missing') ? res(404) : res(500);
    const out = await checkLinks(
      ['https://x/good', 'https://x/missing', 'https://x/boom'],
      fetchFn,
      4,
    );
    expect(out.find((c) => c.url.endsWith('good'))).toMatchObject({ status: 200, ok: true });
    expect(out.find((c) => c.url.endsWith('missing'))).toMatchObject({ status: 404, ok: false });
    expect(out.find((c) => c.url.endsWith('boom'))).toMatchObject({ status: 500, ok: false });
  });

  it('records network errors with null status', async () => {
    const fetchFn = async () => {
      throw new Error('net::ERR_FAILED');
    };
    const out = await checkLinks(['https://x/dead'], fetchFn, 2);
    expect(out[0]).toMatchObject({ status: null, ok: false });
    expect(out[0].error).toContain('ERR_FAILED');
  });

  it('falls back to GET when HEAD yields 405/501', async () => {
    const methods: string[] = [];
    const fetchFn = async (_url: string, init?: { method?: string }) => {
      methods.push(init?.method ?? 'GET');
      if (init?.method === 'HEAD') return res(405);
      return res(200);
    };
    const out = await checkLinks(['https://x/a'], fetchFn, 1);
    expect(methods).toEqual(['HEAD', 'GET']);
    expect(out[0]).toMatchObject({ status: 200, ok: true });
  });

  it('respects the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const fetchFn = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      await Promise.resolve();
      active--;
      return res(200);
    };
    const urls = Array.from({ length: 10 }, (_, i) => `https://x/${i}`);
    await checkLinks(urls, fetchFn, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('returns one result per input url', async () => {
    const out = await checkLinks(['https://x/1', 'https://x/2'], async () => res(200), 5);
    expect(out).toHaveLength(2);
  });

  it('handles an empty url list', async () => {
    const out = await checkLinks([], async () => res(200), 5);
    expect(out).toEqual([]);
  });
});
