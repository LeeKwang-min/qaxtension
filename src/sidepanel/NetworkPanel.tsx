import { useState } from 'react';
import type { ReactNode } from 'react';
import type { RequestRecord, PerfResource } from '../messaging/types';
import { failedRequests, treemapCells, prettyBody } from '../capture/network';

interface Props {
  requests: RequestRecord[];
  perfResources: PerfResource[];
  injectReady: boolean;
  paused: boolean;
  onClear: () => void;
  onTogglePause: () => void;
}

/** 소요시간 → 색 (느릴수록 빨강) */
function durationColor(ms: number): string {
  if (ms >= 1000) return '#b00020';
  if (ms >= 500) return '#c47f00';
  return '#0a7d28';
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!text}
      style={{ fontSize: 10, padding: '1px 6px' }}
      title="본문을 클립보드에 복사"
    >
      {copied ? '복사됨 ✓' : '복사'}
    </button>
  );
}

function BodyBlock({ title, body }: { title: string; body: RequestRecord['requestBody'] }) {
  if (!body) return null;
  // JSON 이면 보기 좋게 정렬 (잘린 본문 등 파싱 실패 시 원본 유지)
  const display = prettyBody(body.text, body.contentType);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#666' }}>
        <span style={{ flex: 1 }}>
          {title}
          {body.contentType ? ` · ${body.contentType}` : ''}
          {body.truncated ? ` · 절단됨 (원본 ${body.size}자)` : ''}
        </span>
        <CopyButton text={display} />
      </div>
      <pre
        style={{
          margin: '2px 0 0',
          padding: 6,
          background: '#f6f6f6',
          fontSize: 11,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 200,
          overflow: 'auto',
        }}
      >
        {display || '(빈 본문)'}
      </pre>
    </div>
  );
}

/** 요청 한 건의 상세 (아코디언으로 펼쳐지는 본문) */
function Detail({ r }: { r: RequestRecord }) {
  return (
    <div
      style={{
        margin: '0 0 4px',
        padding: '6px 8px',
        background: '#f7faff',
        border: '1px solid #e3ecff',
        borderRadius: 4,
      }}
    >
      <Field label="메서드">{r.method}</Field>
      <Field label="URL">{r.url}</Field>
      <Field label="상태">
        <span style={{ color: statusColor(r), fontWeight: 700 }}>
          {r.status ?? '진행 중/오류'} {r.statusText ?? ''}
        </span>
      </Field>
      {r.error && <Field label="오류">{r.error}</Field>}
      <Field label="소요시간">{r.durationMs != null ? `${r.durationMs}ms` : '—'}</Field>
      <Field label="출처">{r.source}</Field>
      <BodyBlock title="요청 본문" body={r.requestBody} />
      <BodyBlock title="응답 본문" body={r.responseBody} />
    </div>
  );
}

/** 이미지 리소스 로딩 성능 섹션 (느린 순) */
function ImagePerfSection({ items }: { items: PerfResource[] }) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => b.durationMs - a.durationMs);
  return (
    <section style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 12, margin: '0 0 2px', color: '#333' }}>이미지 로딩 ({items.length})</h3>
      <p style={{ fontSize: 10, color: '#999', margin: '0 0 4px' }}>
        전체 = 요청~수신 완료 · TTFB = 서버 응답 대기 · 다운로드 = 전송. (화면 렌더/디코드는 미포함)
      </p>
      <div>
        {sorted.map((p) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'baseline',
              padding: '3px 4px',
              fontSize: 11,
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <span style={{ color: durationColor(p.durationMs), fontWeight: 700, minWidth: 52, textAlign: 'right' }}>
              {p.durationMs}ms
            </span>
            <span style={{ flex: 1, wordBreak: 'break-all' }}>{shortUrl(p.url)}</span>
            <span style={{ color: '#999', minWidth: 130, textAlign: 'right' }}>
              {p.fromCache
                ? '캐시'
                : p.ttfbMs != null
                  ? `TTFB ${p.ttfbMs} · DL ${p.downloadMs ?? '–'}`
                  : '타이밍 비공개'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function NetworkPanel({ requests, perfResources, injectReady, paused, onClear, onTogglePause }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fails = failedRequests(requests);
  const cells = treemapCells(requests);
  const maxCount = cells.reduce((m, c) => Math.max(m, c.count), 0) || 1;
  // 같은 항목을 다시 누르면 접힘 (아코디언)
  const toggle = (id: string) => setSelectedId((prev) => (prev === id ? null : id));

  if (!injectReady && requests.length === 0 && perfResources.length === 0) {
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
        <button onClick={onTogglePause} aria-pressed={paused} style={{ fontWeight: paused ? 700 : 400 }}>
          {paused ? '캡처 재개' : '캡처 중단'}
        </button>
        <button onClick={onClear} disabled={requests.length === 0}>
          초기화
        </button>
        {paused && <span style={{ fontSize: 11, color: '#c47f00' }}>● 일시중지됨</span>}
      </div>

      {requests.length === 0 && (
        <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>
          아직 포착된 요청이 없습니다. 패널을 켜기 전에 끝난 요청은 잡히지 않으니,
          페이지를 <strong>새로고침</strong>하면 처음부터 잡습니다.
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
            <div key={r.id}>
              <div
                onClick={() => toggle(r.id)}
                style={{ cursor: 'pointer', fontSize: 11, padding: '2px 0', color: '#b00020', wordBreak: 'break-all' }}
              >
                <strong>{statusLabel(r)}</strong> {r.method} {shortUrl(r.url)}
              </div>
              {r.id === selectedId && <Detail r={r} />}
            </div>
          ))}
        </section>
      )}

      {requests.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#333' }}>요청 ({requests.length})</h3>
          <div>
            {requests.map((r) => (
              <div key={r.id}>
                <div
                  onClick={() => toggle(r.id)}
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
                {r.id === selectedId && <Detail r={r} />}
              </div>
            ))}
          </div>
        </section>
      )}

      <ImagePerfSection items={perfResources} />
    </div>
  );
}
