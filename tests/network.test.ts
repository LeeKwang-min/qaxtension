import { describe, it, expect } from 'vitest';
import {
  captureBody,
  recordFromStart,
  applyEnd,
  pushBounded,
  failedRequests,
  treemapCells,
  MAX_BODY,
  MAX_REQUESTS,
} from '../src/capture/network';
import type { NetStart, RequestRecord } from '../src/messaging/types';

function start(over: Partial<NetStart> = {}): NetStart {
  return {
    id: 'r1',
    source: 'fetch',
    method: 'GET',
    url: 'https://api.example.com/users',
    startedAt: 1000,
    requestBody: null,
    ...over,
  };
}

describe('captureBody', () => {
  it('returns null for null input', () => {
    expect(captureBody(null, null)).toBeNull();
  });
  it('keeps short bodies intact', () => {
    const b = captureBody('hello', 'text/plain');
    expect(b).toEqual({ text: 'hello', truncated: false, size: 5, contentType: 'text/plain' });
  });
  it('truncates bodies over MAX_BODY and flags truncated', () => {
    const big = 'x'.repeat(MAX_BODY + 10);
    const b = captureBody(big, null)!;
    expect(b.truncated).toBe(true);
    expect(b.text.length).toBe(MAX_BODY);
    expect(b.size).toBe(MAX_BODY + 10);
    expect(b.contentType).toBeNull();
  });
});

describe('recordFromStart', () => {
  it('builds a pending record (status/ok null)', () => {
    const r = recordFromStart(start());
    expect(r.id).toBe('r1');
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://api.example.com/users');
    expect(r.status).toBeNull();
    expect(r.ok).toBeNull();
    expect(r.error).toBeNull();
    expect(r.durationMs).toBeNull();
    expect(r.responseBody).toBeNull();
  });
});

describe('applyEnd', () => {
  it('fills status/ok/duration on success', () => {
    const r = recordFromStart(start());
    const done = applyEnd(r, { status: 200, statusText: 'OK', ok: true, durationMs: 42, responseBody: null });
    expect(done.status).toBe(200);
    expect(done.ok).toBe(true);
    expect(done.durationMs).toBe(42);
  });
  it('records 4xx as not ok', () => {
    const r = recordFromStart(start());
    const done = applyEnd(r, { status: 404, statusText: 'Not Found', ok: false, durationMs: 5 });
    expect(done.status).toBe(404);
    expect(done.ok).toBe(false);
  });
  it('records network error (status stays null)', () => {
    const r = recordFromStart(start());
    const done = applyEnd(r, { error: 'network error or CORS', durationMs: 7 });
    expect(done.status).toBeNull();
    expect(done.error).toBe('network error or CORS');
  });
});

describe('pushBounded', () => {
  it('appends a new record by id', () => {
    const list = pushBounded([], recordFromStart(start()));
    expect(list).toHaveLength(1);
  });
  it('replaces an existing record with the same id (upsert)', () => {
    const a = recordFromStart(start({ id: 'dup' }));
    let list = pushBounded([], a);
    const b = { ...recordFromStart(start({ id: 'dup' })), method: 'POST' };
    list = pushBounded(list, b);
    expect(list).toHaveLength(1);
    expect(list[0].method).toBe('POST');
  });
  it('caps the list at MAX_REQUESTS (drops oldest)', () => {
    let list: RequestRecord[] = [];
    for (let i = 0; i < MAX_REQUESTS + 5; i++) {
      list = pushBounded(list, recordFromStart(start({ id: `r${i}` })));
    }
    expect(list).toHaveLength(MAX_REQUESTS);
    // 가장 오래된 r0..r4 가 밀려나고 r5 가 맨 앞
    expect(list[0].id).toBe('r5');
  });
});

describe('failedRequests', () => {
  it('returns 4xx/5xx and network errors only', () => {
    const ok = applyEnd(recordFromStart(start({ id: 'ok' })), { status: 200, ok: true, durationMs: 1 });
    const notFound = applyEnd(recordFromStart(start({ id: 'nf' })), { status: 404, ok: false, durationMs: 1 });
    const err = applyEnd(recordFromStart(start({ id: 'er' })), { error: 'boom', durationMs: 1 });
    const pending = recordFromStart(start({ id: 'pd' }));
    const fails = failedRequests([ok, notFound, err, pending]);
    expect(fails.map((r) => r.id).sort()).toEqual(['er', 'nf']);
  });
});

describe('treemapCells', () => {
  it('groups by host with count, errorRate, bytes', () => {
    const recs: RequestRecord[] = [
      applyEnd(recordFromStart(start({ id: '1', url: 'https://a.com/x' })), { status: 200, ok: true, durationMs: 1, responseBody: { text: 'ab', truncated: false, size: 2, contentType: null } }),
      applyEnd(recordFromStart(start({ id: '2', url: 'https://a.com/y' })), { status: 500, ok: false, durationMs: 1 }),
      applyEnd(recordFromStart(start({ id: '3', url: 'https://b.com/z' })), { status: 200, ok: true, durationMs: 1 }),
    ];
    const cells = treemapCells(recs);
    const a = cells.find((c) => c.key === 'a.com')!;
    expect(a.count).toBe(2);
    expect(a.errorCount).toBe(1);
    expect(a.errorRate).toBeCloseTo(0.5, 5);
    expect(a.bytes).toBe(2);
    const b = cells.find((c) => c.key === 'b.com')!;
    expect(b.count).toBe(1);
    expect(b.errorRate).toBe(0);
  });
  it('sorts cells by count descending', () => {
    const recs: RequestRecord[] = [
      recordFromStart(start({ id: '1', url: 'https://solo.com/a' })),
      recordFromStart(start({ id: '2', url: 'https://many.com/a' })),
      recordFromStart(start({ id: '3', url: 'https://many.com/b' })),
    ];
    const cells = treemapCells(recs);
    expect(cells[0].key).toBe('many.com');
  });
  it('uses a fallback label for unparseable urls', () => {
    const recs = [recordFromStart(start({ id: '1', url: 'not a url' }))];
    const cells = treemapCells(recs);
    expect(cells[0].key).toBe('(기타)');
  });
});
