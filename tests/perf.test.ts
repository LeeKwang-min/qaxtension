import { describe, it, expect } from 'vitest';
import { normalizePerfEntry, type PerfEntryLike } from '../src/capture/perf';

const base: PerfEntryLike = {
  entryType: 'resource',
  initiatorType: 'img',
  name: 'https://cdn.test/a.png',
  startTime: 1000,
  duration: 350,
  requestStart: 1010,
  responseStart: 1300, // 서버 응답 시작
  responseEnd: 1350, // 다운로드 완료
  transferSize: 20480,
  decodedBodySize: 18000,
};

describe('normalizePerfEntry', () => {
  it('splits TTFB and download from a same-origin (TAO-allowed) entry', () => {
    const r = normalizePerfEntry(base, 0, 'p1');
    expect(r.ttfbMs).toBe(290); // 1300 - 1010
    expect(r.downloadMs).toBe(50); // 1350 - 1300
    expect(r.durationMs).toBe(350);
    expect(r.url).toBe('https://cdn.test/a.png');
    expect(r.initiatorType).toBe('img');
  });

  it('returns null TTFB/download when cross-origin timings are hidden (TAO missing)', () => {
    // TAO 없으면 requestStart/responseStart 가 0 으로 보고됨
    const r = normalizePerfEntry({ ...base, requestStart: 0, responseStart: 0 }, 0, 'p2');
    expect(r.ttfbMs).toBeNull();
    expect(r.downloadMs).toBeNull();
    expect(r.durationMs).toBe(350); // 전체 시간은 여전히 의미 있음
  });

  it('adds timeOrigin to startTime for an absolute epoch timestamp', () => {
    const r = normalizePerfEntry(base, 1_700_000_000_000, 'p3');
    expect(r.startedAt).toBe(1_700_000_001_000);
  });

  it('flags fromCache when transferSize is 0 but body was decoded', () => {
    const r = normalizePerfEntry({ ...base, transferSize: 0 }, 0, 'p4');
    expect(r.fromCache).toBe(true);
  });

  it('is not fromCache when bytes were transferred', () => {
    expect(normalizePerfEntry(base, 0, 'p5').fromCache).toBe(false);
  });

  it('rounds fractional milliseconds', () => {
    const r = normalizePerfEntry({ ...base, duration: 350.7 }, 0, 'p6');
    expect(Number.isInteger(r.durationMs)).toBe(true);
  });
});
