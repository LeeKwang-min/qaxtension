import { useState } from 'react';
import type { LogLevel, LogRecord } from '../messaging/types';
import { filterByLevel } from '../capture/console';

interface Props {
  logs: LogRecord[];
  injectReady: boolean;
  onClear: () => void;
}

type Filter = LogLevel | 'all';

const LEVEL_COLOR: Record<LogLevel, string> = {
  error: '#b00020',
  warn: '#c47f00',
};

const SOURCE_LABEL: Record<LogRecord['source'], string> = {
  console: 'console',
  onerror: '런타임 에러',
  unhandledrejection: '미처리 거부',
};

function timeOf(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return '';
  }
}

export function ConsolePanel({ logs, injectReady, onClear }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;
  const shown = filterByLevel(logs, filter);

  if (!injectReady && logs.length === 0) {
    return (
      <p style={{ color: '#999', fontSize: 12 }}>
        페이지가 연결되면 콘솔 에러·경고가 여기에 표시됩니다. 연결되지 않으면 페이지를
        새로고침하세요.
      </p>
    );
  }

  const tab = (f: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      aria-pressed={filter === f}
      style={{ fontWeight: filter === f ? 700 : 400 }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#666' }}>
          오류 {errorCount} · 경고 {warnCount}
        </span>
        <span style={{ display: 'flex', gap: 4 }}>
          {tab('all', '전체')}
          {tab('error', '오류')}
          {tab('warn', '경고')}
        </span>
        <button type="button" onClick={onClear} disabled={logs.length === 0}>
          초기화
        </button>
      </div>

      {shown.length === 0 && (
        <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>
          {logs.length === 0
            ? '아직 수집된 에러·경고가 없습니다.'
            : '이 필터에 해당하는 로그가 없습니다.'}
        </p>
      )}

      <div style={{ marginTop: 8 }}>
        {shown.map((l) => {
          const open = l.id === expandedId;
          const hasDetail = l.stack != null || l.location != null;
          return (
            <div
              key={l.id}
              style={{ borderBottom: '1px solid #f0f0f0', padding: '4px 2px', fontSize: 11 }}
            >
              <div
                onClick={() => hasDetail && setExpandedId(open ? null : l.id)}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'baseline',
                  cursor: hasDetail ? 'pointer' : 'default',
                }}
              >
                <span
                  style={{
                    color: LEVEL_COLOR[l.level],
                    fontWeight: 700,
                    minWidth: 36,
                    textTransform: 'uppercase',
                  }}
                >
                  {l.level}
                </span>
                <span style={{ flex: 1, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                  {l.text || '(빈 메시지)'}
                  {l.count > 1 && (
                    <span
                      style={{
                        marginLeft: 6,
                        background: '#ddd',
                        color: '#333',
                        borderRadius: 8,
                        padding: '0 6px',
                        fontSize: 10,
                      }}
                    >
                      ×{l.count}
                    </span>
                  )}
                </span>
                <span style={{ color: '#999', minWidth: 64, textAlign: 'right' }}>
                  {timeOf(l.lastAt)}
                </span>
              </div>
              <div style={{ color: '#999', fontSize: 10, marginTop: 1 }}>
                {SOURCE_LABEL[l.source]}
                {l.location ? ` · ${l.location}` : ''}
                {hasDetail ? (open ? ' · 접기' : ' · 자세히') : ''}
              </div>
              {open && l.stack && (
                <pre
                  style={{
                    margin: '4px 0 0',
                    padding: 6,
                    background: '#f6f6f6',
                    fontSize: 10,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {l.stack}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
