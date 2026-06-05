import type { PerfResource } from '../messaging/types';

/** PerformanceResourceTiming 에서 우리가 읽는 필드만 추린 형태 (테스트 주입용) */
export interface PerfEntryLike {
  entryType: string;
  initiatorType: string;
  name: string;
  startTime: number;
  duration: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  transferSize?: number;
  decodedBodySize?: number;
}

const round = (n: number): number => Math.round(n);

/**
 * ResourceTiming 항목을 PerfResource 로 정규화한다.
 * cross-origin 리소스는 Timing-Allow-Origin 헤더가 없으면 requestStart/responseStart 가
 * 0 으로 보고되므로, 그 경우 단계 분해(ttfb/download)는 null 로 둔다(전체 duration 은 유효).
 */
export function normalizePerfEntry(e: PerfEntryLike, timeOrigin: number, id: string): PerfResource {
  const hasPhases = e.requestStart > 0 && e.responseStart > 0;
  const ttfbMs = hasPhases ? round(e.responseStart - e.requestStart) : null;
  const downloadMs = hasPhases && e.responseEnd > 0 ? round(e.responseEnd - e.responseStart) : null;
  const transferSize = e.transferSize ?? null;
  const decodedBodySize = e.decodedBodySize ?? null;
  return {
    id,
    url: e.name,
    initiatorType: e.initiatorType,
    startedAt: round(timeOrigin + e.startTime),
    durationMs: round(e.duration),
    ttfbMs,
    downloadMs,
    transferSize,
    decodedBodySize,
    fromCache: transferSize === 0 && (decodedBodySize ?? 0) > 0,
  };
}
