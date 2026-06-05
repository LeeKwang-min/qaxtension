import type { BodyCapture, NetEnd, NetStart, RequestRecord, TreemapCell } from '../messaging/types';

/** 본문 절단 상한 (문자 수) — 설계상 기본 32KB */
export const MAX_BODY = 32 * 1024;
/** tabId별 보관 요청 상한 (메모리 보호) */
export const MAX_REQUESTS = 500;

/** 본문 문자열을 절단 가능한 BodyCapture 로. null 이면 null. */
export function captureBody(text: string | null, contentType: string | null): BodyCapture | null {
  if (text == null) return null;
  const size = text.length;
  const truncated = size > MAX_BODY;
  return {
    text: truncated ? text.slice(0, MAX_BODY) : text,
    truncated,
    size,
    contentType,
  };
}

/** NET_START → 진행 중 RequestRecord */
export function recordFromStart(s: NetStart): RequestRecord {
  return {
    id: s.id,
    source: s.source,
    method: s.method,
    url: s.url,
    status: null,
    statusText: null,
    ok: null,
    error: null,
    startedAt: s.startedAt,
    durationMs: null,
    requestBody: s.requestBody,
    responseBody: null,
  };
}

/** 진행 중 레코드에 NET_END 를 병합한 새 레코드 반환 (불변) */
export function applyEnd(r: RequestRecord, e: NetEnd): RequestRecord {
  return {
    ...r,
    status: e.status ?? r.status,
    statusText: e.statusText ?? r.statusText,
    ok: e.ok ?? r.ok,
    error: e.error ?? r.error,
    durationMs: e.durationMs ?? r.durationMs,
    responseBody: e.responseBody ?? r.responseBody,
  };
}

/** id 로 upsert + 상한 유지(초과 시 가장 오래된 것부터 제거). 불변 반환. */
export function pushBounded(list: RequestRecord[], rec: RequestRecord): RequestRecord[] {
  const idx = list.findIndex((r) => r.id === rec.id);
  let next: RequestRecord[];
  if (idx >= 0) {
    next = list.slice();
    next[idx] = rec;
  } else {
    next = [...list, rec];
  }
  if (next.length > MAX_REQUESTS) {
    next = next.slice(next.length - MAX_REQUESTS);
  }
  return next;
}

/** 4xx/5xx 또는 네트워크 오류만 (진행 중·성공 제외) */
export function failedRequests(list: RequestRecord[]): RequestRecord[] {
  return list.filter((r) => r.error != null || (r.status != null && r.status >= 400));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || '(기타)';
  } catch {
    return '(기타)';
  }
}

/** host 그룹별 집계 → 호출 수 내림차순 정렬된 트리맵 셀 */
export function treemapCells(list: RequestRecord[]): TreemapCell[] {
  const map = new Map<string, TreemapCell>();
  for (const r of list) {
    const key = hostOf(r.url);
    let cell = map.get(key);
    if (!cell) {
      cell = { key, count: 0, errorCount: 0, errorRate: 0, bytes: 0 };
      map.set(key, cell);
    }
    cell.count += 1;
    const isError = r.error != null || (r.status != null && r.status >= 400);
    if (isError) cell.errorCount += 1;
    cell.bytes += r.responseBody?.size ?? 0;
  }
  const cells = Array.from(map.values());
  for (const c of cells) c.errorRate = c.count > 0 ? c.errorCount / c.count : 0;
  cells.sort((a, b) => b.count - a.count);
  return cells;
}
