import type { LogEvent, LogLevel, LogRecord } from '../messaging/types';

/** tabId별 보관 로그 상한 (메모리 보호) */
export const MAX_LOGS = 500;
/** 직렬화 메시지 절단 상한 (문자 수) */
export const MAX_LOG_TEXT = 8 * 1024;

/** 순환참조·BigInt·함수에 안전한 JSON 직렬화. 실패하면 String() 폴백. */
function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') return `${val}n`;
      if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`;
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    });
  } catch {
    try {
      return String(value);
    } catch {
      return '[Unserializable]';
    }
  }
}

/**
 * console 인자 배열을 안전한 한 문자열로 직렬화(절단 포함).
 * 객체 참조는 postMessage 로 보낼 수 없으므로 inject 에서 여기로 문자열화한다.
 */
export function serializeArgs(args: unknown[]): string {
  const parts = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    if (typeof a === 'object' && a !== null) return safeJson(a);
    return String(a);
  });
  const text = parts.join(' ');
  return text.length > MAX_LOG_TEXT ? text.slice(0, MAX_LOG_TEXT) : text;
}

/** LogEvent → 새 LogRecord (count 1) */
export function recordFromLog(e: LogEvent, id: string): LogRecord {
  return {
    id,
    level: e.level,
    source: e.source,
    text: e.text,
    stack: e.stack,
    location: e.location,
    count: 1,
    firstAt: e.at,
    lastAt: e.at,
  };
}

/** 두 레코드가 "같은 로그"인지 (level·source·text 동일) */
function sameLog(a: LogRecord, b: LogRecord): boolean {
  return a.level === b.level && a.source === b.source && a.text === b.text;
}

/**
 * 로그를 목록에 추가. 직전 레코드와 동일하면 count++/lastAt 갱신(연속 병합),
 * 아니면 append + 상한(초과 시 가장 오래된 것 제거). 불변 반환.
 */
export function pushLog(list: LogRecord[], rec: LogRecord): LogRecord[] {
  const last = list[list.length - 1];
  if (last && sameLog(last, rec)) {
    const merged: LogRecord = {
      ...last,
      count: last.count + 1,
      lastAt: rec.lastAt,
    };
    const next = list.slice(0, -1);
    next.push(merged);
    return next;
  }
  let next = [...list, rec];
  if (next.length > MAX_LOGS) next = next.slice(next.length - MAX_LOGS);
  return next;
}

/** 레벨로 필터 ('all' 이면 전체) */
export function filterByLevel(list: LogRecord[], level: LogLevel | 'all'): LogRecord[] {
  if (level === 'all') return list;
  return list.filter((r) => r.level === level);
}
