import type {
  BodyCapture,
  NetEnd,
  NetStart,
  RequestRecord,
  TreemapCell,
  WebReqEnd,
} from '../messaging/types';

/** 본문 절단 상한 (문자 수) — 설계상 기본 32KB */
export const MAX_BODY = 32 * 1024;
/** tabId별 보관 요청 상한 (메모리 보호) */
export const MAX_REQUESTS = 500;
/** webRequest 보조 소스를 inject 레코드와 매칭하는 시간 허용폭 (ms) */
export const WEBREQ_MATCH_WINDOW_MS = 15_000;

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
    fromCache: null,
    webReqId: null,
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

function okFromStatus(status: number | null): boolean | null {
  if (status == null) return null;
  return status >= 200 && status < 400;
}

/**
 * webRequest 정보를 한 레코드에 반영.
 * @param authoritative 같은 requestId 재이벤트면 true (webRequest 가 권위 → status 갱신).
 *   신규 inject 보완이면 false (inject 의 status·본문을 신뢰, 빈 status 만 채움).
 */
function applyWebReq(r: RequestRecord, wr: WebReqEnd, authoritative: boolean): RequestRecord {
  const status = authoritative ? (wr.status ?? r.status) : r.status == null ? wr.status : r.status;
  // webRequest 가 구체적 error(net::ERR_...) 를 주면 inject 의 모호한 메시지를 교체
  const error = wr.error != null ? wr.error : r.error;
  return {
    ...r,
    status,
    ok: okFromStatus(status) ?? r.ok,
    error,
    fromCache: wr.fromCache,
    webReqId: wr.requestId,
  };
}

/**
 * chrome.webRequest 보조 종료 정보를 store 의 요청 목록에 병합(불변 반환).
 * 1) 같은 requestId 재이벤트 → 해당 레코드 갱신.
 * 2) method+url 일치 & 미보완 & 시간근접(WEBREQ_MATCH_WINDOW_MS) → 가장 가까운 inject 레코드 보완.
 * 3) 매칭 실패 → source:'webRequest' 독립 레코드 추가.
 */
export function mergeWebReq(list: RequestRecord[], wr: WebReqEnd): RequestRecord[] {
  // 1) 같은 requestId 로 이미 만든/보완한 레코드 갱신 (리다이렉트→완료 등)
  const existingIdx = list.findIndex((r) => r.webReqId === wr.requestId);
  if (existingIdx >= 0) {
    const next = list.slice();
    next[existingIdx] = applyWebReq(next[existingIdx], wr, true);
    return next;
  }
  // 2) inject 레코드 보완 — 시작 시각이 가장 가까운 미보완 후보 1개 소비
  let bestIdx = -1;
  let bestDelta = Infinity;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.source === 'webRequest' || r.webReqId != null) continue;
    if (r.method !== wr.method || r.url !== wr.url) continue;
    const delta = Math.abs(r.startedAt - wr.timeStamp);
    if (delta <= WEBREQ_MATCH_WINDOW_MS && delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) {
    const next = list.slice();
    next[bestIdx] = applyWebReq(next[bestIdx], wr, false);
    return next;
  }
  // 3) 독립 레코드 (inject 후킹 전 발생 또는 후킹이 못 본 요청)
  const standalone: RequestRecord = {
    id: `wr-${wr.requestId}`,
    source: 'webRequest',
    method: wr.method,
    url: wr.url,
    status: wr.status,
    statusText: null,
    ok: okFromStatus(wr.status),
    error: wr.error,
    startedAt: wr.timeStamp,
    durationMs: null,
    requestBody: null,
    responseBody: null,
    fromCache: wr.fromCache,
    webReqId: wr.requestId,
  };
  return pushBounded(list, standalone);
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
