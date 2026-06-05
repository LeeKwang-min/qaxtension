import { useState } from 'react';
import type { ReactNode } from 'react';
import type { RequestRecord } from '../messaging/types';
import { failedRequests, treemapCells } from '../capture/network';

interface Props {
  requests: RequestRecord[];
  injectReady: boolean;
  onClear: () => void;
}

/** host 만 잘라 표시 (긴 URL 축약용) */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function statusColor(r: RequestRecord): string {
  if (r.error != null) return '#b00020';
  if (r.status == null) return '#999'; // 진행 중
  if (r.status >= 500) return '#b00020';
  if (r.status >= 400) return '#c47f00';
  return '#0a7d28';
}

function statusLabel(r: RequestRecord): string {
  if (r.error != null) return '오류';
  if (r.status == null) return '…';
  return String(r.status);
}

/** 에러율(0~1) → 녹→적 배경색 */
function heatColor(rate: number): string {
  const hue = Math.round(120 - 120 * rate); // 120=녹, 0=적
  return `hsl(${hue}, 70%, 45%)`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12 }}>
      <span style={{ minWidth: 72, color: '#666' }}>{label}</span>
      <span style={{ wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}

function BodyBlock({ title, body }: { title: string; body: RequestRecord['requestBody'] }) {
  if (!body) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: '#666' }}>
        {title}
        {body.contentType ? ` · ${body.contentType}` : ''}
        {body.truncated ? ` · 절단됨 (원본 ${body.size}자)` : ''}
      </div>
      <pre
        style={{
          margin: '2px 0 0',
          padding: 6,
          background: '#f6f6f6',
          fontSize: 11,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 160,
          overflow: 'auto',
        }}
      >
        {body.text || '(빈 본문)'}
      </pre>
    </div>
  );
}

export function NetworkPanel({ requests, injectReady, onClear }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fails = failedRequests(requests);
  const cells = treemapCells(requests);
  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const maxCount = cells.reduce((m, c) => Math.max(m, c.count), 0) || 1;

  if (!injectReady && requests.length === 0) {
    return (
      <p style={{ color: '#999', fontSize: 12 }}>
        페이지가 연결되면 호출한 API 가 여기에 표시됩니다. 연결되지 않으면 페이지를 새로고침하세요.
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#666' }}>
          총 {requests.length}건 · 실패 {fails.length}건
        </span>
        <button onClick={onClear} disabled={requests.length === 0}>
          초기화
        </button>
      </div>

      {requests.length === 0 && (
        <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>
          아직 포착된 요청이 없습니다. 페이지에서 API 를 호출해 보세요.
        </p>
      )}

      {cells.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#333' }}>트리맵 (호스트별)</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {cells.map((c) => (
              <div
                key={c.key}
                title={`${c.key} · ${c.count}건 · 에러 ${Math.round(c.errorRate * 100)}%`}
                style={{
                  flexGrow: c.count,
                  flexBasis: `${Math.max(20, (c.count / maxCount) * 100)}px`,
                  minWidth: 56,
                  height: 44,
                  background: heatColor(c.errorRate),
                  color: '#fff',
                  borderRadius: 3,
                  padding: 4,
                  fontSize: 10,
                  overflow: 'hidden',
                }}
              >
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.key}
                </div>
                <div>{c.count}건 · {Math.round(c.errorRate * 100)}%</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {fails.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#b00020' }}>실패 ({fails.length})</h3>
          {fails.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              style={{ cursor: 'pointer', fontSize: 11, padding: '2px 0', color: '#b00020', wordBreak: 'break-all' }}
            >
              <strong>{statusLabel(r)}</strong> {r.method} {shortUrl(r.url)}
            </div>
          ))}
        </section>
      )}

      {requests.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#333' }}>요청 ({requests.length})</h3>
          <div>
            {requests.map((r) => (
              <div
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'baseline',
                  padding: '3px 4px',
                  fontSize: 11,
                  cursor: 'pointer',
                  background: r.id === selectedId ? '#eef4ff' : 'transparent',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <span style={{ color: statusColor(r), fontWeight: 700, minWidth: 30 }}>{statusLabel(r)}</span>
                <span style={{ minWidth: 36, color: '#555' }}>{r.method}</span>
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{shortUrl(r.url)}</span>
                <span style={{ color: '#999', minWidth: 44, textAlign: 'right' }}>
                  {r.durationMs != null ? `${r.durationMs}ms` : '…'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {selected && (
        <section style={{ marginTop: 12, borderTop: '2px solid #eee', paddingTop: 8 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#333' }}>상세</h3>
          <Field label="메서드">{selected.method}</Field>
          <Field label="URL">{selected.url}</Field>
          <Field label="상태">
            <span style={{ color: statusColor(selected), fontWeight: 700 }}>
              {selected.status ?? '진행 중/오류'} {selected.statusText ?? ''}
            </span>
          </Field>
          {selected.error && <Field label="오류">{selected.error}</Field>}
          <Field label="소요시간">{selected.durationMs != null ? `${selected.durationMs}ms` : '—'}</Field>
          <Field label="출처">{selected.source}</Field>
          <BodyBlock title="요청 본문" body={selected.requestBody} />
          <BodyBlock title="응답 본문" body={selected.responseBody} />
        </section>
      )}
    </div>
  );
}
