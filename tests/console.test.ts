import { describe, it, expect } from 'vitest';
import {
  serializeArgs,
  recordFromLog,
  pushLog,
  filterByLevel,
  MAX_LOGS,
  MAX_LOG_TEXT,
} from '../src/capture/console';
import type { LogEvent, LogRecord } from '../src/messaging/types';

function ev(over: Partial<LogEvent> = {}): LogEvent {
  return {
    level: 'error',
    source: 'console',
    text: 'boom',
    stack: null,
    location: null,
    at: 1000,
    ...over,
  };
}

describe('serializeArgs', () => {
  it('passes strings through and joins with spaces', () => {
    expect(serializeArgs(['hello', 'world'])).toBe('hello world');
  });
  it('stringifies numbers, booleans, null, undefined', () => {
    expect(serializeArgs([1, true, null, undefined])).toBe('1 true null undefined');
  });
  it('JSON-stringifies plain objects', () => {
    expect(serializeArgs([{ a: 1, b: 'x' }])).toBe('{"a":1,"b":"x"}');
  });
  it('renders Error as name: message', () => {
    expect(serializeArgs([new TypeError('nope')])).toBe('TypeError: nope');
  });
  it('survives circular references', () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    const s = serializeArgs([o]);
    expect(s).toContain('[Circular]');
  });
  it('truncates very long output to MAX_LOG_TEXT', () => {
    const big = 'x'.repeat(MAX_LOG_TEXT + 100);
    expect(serializeArgs([big]).length).toBe(MAX_LOG_TEXT);
  });
});

describe('recordFromLog', () => {
  it('builds a record with count 1 and firstAt=lastAt=at', () => {
    const r = recordFromLog(ev({ at: 1234 }), 'log-1');
    expect(r.id).toBe('log-1');
    expect(r.level).toBe('error');
    expect(r.count).toBe(1);
    expect(r.firstAt).toBe(1234);
    expect(r.lastAt).toBe(1234);
  });
});

describe('pushLog', () => {
  it('appends a new record', () => {
    const list = pushLog([], recordFromLog(ev(), 'a'));
    expect(list).toHaveLength(1);
  });
  it('merges consecutive identical logs (count++, lastAt updated)', () => {
    let list = pushLog([], recordFromLog(ev({ at: 1000 }), 'a'));
    list = pushLog(list, recordFromLog(ev({ at: 1500 }), 'b'));
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(2);
    expect(list[0].firstAt).toBe(1000);
    expect(list[0].lastAt).toBe(1500);
  });
  it('does not merge when text differs', () => {
    let list = pushLog([], recordFromLog(ev({ text: 'a' }), '1'));
    list = pushLog(list, recordFromLog(ev({ text: 'b' }), '2'));
    expect(list).toHaveLength(2);
  });
  it('does not merge when level or source differs', () => {
    let list = pushLog([], recordFromLog(ev({ level: 'error' }), '1'));
    list = pushLog(list, recordFromLog(ev({ level: 'warn' }), '2'));
    list = pushLog(list, recordFromLog(ev({ level: 'warn', source: 'onerror' }), '3'));
    expect(list).toHaveLength(3);
  });
  it('caps the list at MAX_LOGS (drops oldest)', () => {
    let list: LogRecord[] = [];
    for (let i = 0; i < MAX_LOGS + 5; i++) {
      list = pushLog(list, recordFromLog(ev({ text: `msg-${i}` }), `r${i}`));
    }
    expect(list).toHaveLength(MAX_LOGS);
    expect(list[0].text).toBe('msg-5');
  });
});

describe('filterByLevel', () => {
  const logs = [
    recordFromLog(ev({ level: 'error', text: 'e' }), '1'),
    recordFromLog(ev({ level: 'warn', text: 'w' }), '2'),
  ];
  it('returns all for "all"', () => {
    expect(filterByLevel(logs, 'all')).toHaveLength(2);
  });
  it('filters to a single level', () => {
    expect(filterByLevel(logs, 'error').map((r) => r.text)).toEqual(['e']);
    expect(filterByLevel(logs, 'warn').map((r) => r.text)).toEqual(['w']);
  });
});
