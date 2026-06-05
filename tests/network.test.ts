import { describe, it, expect } from 'vitest';
import {
  captureBody,
  recordFromStart,
  applyEnd,
  pushBounded,
  failedRequests,
  treemapCells,
  mergeWebReq,
  prettyBody,
  MAX_BODY,
  MAX_REQUESTS,
  WEBREQ_MATCH_WINDOW_MS,
} from '../src/capture/network';
import type { NetStart, RequestRecord, WebReqEnd } from '../src/messaging/types';

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

function webreq(over: Partial<WebReqEnd> = {}): WebReqEnd {
  return {
    requestId: 'wr1',
    method: 'GET',
    url: 'https://api.example.com/users',
    timeStamp: 1100,
    status: 200,
    error: null,
    fromCache: false,
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

describe('mergeWebReq', () => {
  it('fills a pending inject record status from webRequest (status was null)', () => {
    const pending = recordFromStart(start({ id: 'inj', startedAt: 1000 }));
    const list = mergeWebReq([pending], webreq({ status: 200, timeStamp: 1100 }));
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('inj'); // 같은 레코드 보완(중복 추가 아님)
    expect(list[0].source).toBe('fetch');
    expect(list[0].status).toBe(200);
    expect(list[0].ok).toBe(true);
    expect(list[0].webReqId).toBe('wr1');
  });

  it('upgrades a vague inject error with the concrete webRequest error', () => {
    const errored = applyEnd(recordFromStart(start({ id: 'inj' })), {
      error: 'network error or CORS',
      durationMs: 5,
    });
    const list = mergeWebReq([errored], webreq({ status: null, error: 'net::ERR_BLOCKED_BY_CLIENT' }));
    expect(list).toHaveLength(1);
    expect(list[0].error).toBe('net::ERR_BLOCKED_BY_CLIENT');
  });

  it('does not overwrite an inject status that is already filled (dedupe, only fromCache meta)', () => {
    const ok = applyEnd(recordFromStart(start({ id: 'inj' })), { status: 200, ok: true, durationMs: 5 });
    const list = mergeWebReq([ok], webreq({ status: 304, fromCache: true }));
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe(200); // inject 본문 포함 레코드를 신뢰, 덮어쓰지 않음
    expect(list[0].fromCache).toBe(true); // 메타는 보완
    expect(list[0].webReqId).toBe('wr1');
  });

  it('creates a standalone webRequest record when nothing matches', () => {
    const other = recordFromStart(start({ id: 'inj', url: 'https://api.example.com/other' }));
    const list = mergeWebReq([other], webreq({ url: 'https://api.example.com/lonely', status: 500 }));
    expect(list).toHaveLength(2);
    const wr = list.find((r) => r.source === 'webRequest')!;
    expect(wr.url).toBe('https://api.example.com/lonely');
    expect(wr.status).toBe(500);
    expect(wr.ok).toBe(false);
    expect(wr.webReqId).toBe('wr1');
    expect(wr.requestBody).toBeNull();
  });

  it('does not match outside the time window', () => {
    const pending = recordFromStart(start({ id: 'inj', startedAt: 1000 }));
    const far = webreq({ timeStamp: 1000 + WEBREQ_MATCH_WINDOW_MS + 1, status: 200 });
    const list = mergeWebReq([pending], far);
    expect(list).toHaveLength(2); // 매칭 실패 → 독립 레코드
    expect(list[0].webReqId).toBeNull();
  });

  it('updates the same record on a re-event with the same requestId (redirect→complete)', () => {
    const pending = recordFromStart(start({ id: 'inj', startedAt: 1000 }));
    let list = mergeWebReq([pending], webreq({ requestId: 'wrX', status: 301, timeStamp: 1050 }));
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe(301);
    // 같은 requestId 로 최종 200 이 오면 같은 레코드를 갱신(추가 아님)
    list = mergeWebReq(list, webreq({ requestId: 'wrX', status: 200, timeStamp: 1200 }));
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe(200);
  });

  it('matches the closest inject record by start time (1:1 consume)', () => {
    const a = recordFromStart(start({ id: 'a', startedAt: 1000 }));
    const b = recordFromStart(start({ id: 'b', startedAt: 1400 }));
    const list = mergeWebReq([a, b], webreq({ status: 200, timeStamp: 1450 }));
    expect(list).toHaveLength(2);
    const consumed = list.find((r) => r.webReqId === 'wr1')!;
    expect(consumed.id).toBe('b'); // 1400 이 1450 에 더 가깝다
  });
});

describe('prettyBody', () => {
  it('pretty-prints valid JSON with 2-space indentation', () => {
    const out = prettyBody('{"a":1,"b":{"c":2}}', 'application/json');
    expect(out).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}');
  });

  it('detects JSON by leading brace/bracket even without a content-type', () => {
    expect(prettyBody('[1,2]', null)).toBe('[\n  1,\n  2\n]');
  });

  it('returns the original text for non-JSON', () => {
    expect(prettyBody('hello world', 'text/plain')).toBe('hello world');
  });

  it('returns the original text for invalid/truncated JSON', () => {
    const truncated = '{"a":1,"b":';
    expect(prettyBody(truncated, 'application/json')).toBe(truncated);
  });

  it('leaves an empty string untouched', () => {
    expect(prettyBody('', null)).toBe('');
  });
});
