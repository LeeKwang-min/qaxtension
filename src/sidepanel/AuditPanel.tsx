import type { AuditResult, A11yKind, ResourceKind } from '../messaging/types';
import { VIEWPORT_PRESETS } from '../audit/responsive';

interface Props {
  audit: AuditResult | null;
  injectReady: boolean;
  running: boolean;
  onRunAudit: () => void;
  onResize: (width: number, height: number) => void;
}

const A11Y_LABEL: Record<A11yKind, string> = {
  'img-alt': '대체 텍스트',
  'control-name': '컨트롤 이름',
  'input-label': '입력 라벨',
  'html-lang': '페이지 언어',
  contrast: '색 대비',
};

const RES_LABEL: Record<ResourceKind, string> = {
  img: '이미지',
  link: '링크',
  stylesheet: '스타일시트',
  script: '스크립트',
};

function timeOf(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return '';
  }
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 14 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 12, color: '#444' }}>
        {title}
        {count != null && <span style={{ color: '#999', fontWeight: 400 }}> ({count})</span>}
      </h3>
      {children}
    </section>
  );
}

export function AuditPanel({ audit, injectReady, running, onRunAudit, onResize }: Props) {
  // 깨진 리소스: DOM 상 깨진 이미지 + HTTP 검증 실패 링크
  const brokenImages = audit?.resources.filter((r) => r.broken) ?? [];
  const failedLinks = audit?.links.filter((l) => !l.ok) ?? [];
  const brokenCount = brokenImages.length + failedLinks.length;
  const linkUrlKind = new Map(audit?.resources.map((r) => [r.url, r.kind]) ?? []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onRunAudit} disabled={running}>
          {running ? '검사 중…' : '검사 실행'}
        </button>
        {audit && (
          <span style={{ fontSize: 11, color: '#999' }}>마지막 검사 {timeOf(audit.ranAt)}</span>
        )}
      </div>

      {!injectReady && !audit && (
        <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>
          페이지가 연결되면 검사를 실행할 수 있습니다. 연결되지 않으면 페이지를 새로고침하세요.
        </p>
      )}

      {/* 반응형 뷰 — audit 없이도 항상 사용 가능 */}
      <Section title="반응형 뷰 (창 크기 변경)">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {VIEWPORT_PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => onResize(p.width, p.height)}>
              {p.label} {p.width}×{p.height}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 10, color: '#999', margin: '4px 0 0' }}>
          현재 창을 해당 크기로 조정해 레이아웃 깨짐을 확인합니다.
        </p>
      </Section>

      {audit && (
        <>
          <Section title="접근성" count={audit.a11y.length}>
            {audit.a11y.length === 0 ? (
              <p style={{ fontSize: 11, color: '#2e7d32' }}>발견된 접근성 문제가 없습니다. 👍</p>
            ) : (
              <div>
                {audit.a11y.map((i, idx) => (
                  <div
                    key={`${i.kind}-${i.selector}-${idx}`}
                    style={{ borderBottom: '1px solid #f0f0f0', padding: '4px 2px', fontSize: 11 }}
                  >
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span
                        style={{
                          color: i.severity === 'error' ? '#b00020' : '#c47f00',
                          fontWeight: 700,
                          minWidth: 64,
                        }}
                      >
                        {A11Y_LABEL[i.kind]}
                      </span>
                      <span style={{ flex: 1, color: '#333' }}>{i.message}</span>
                    </div>
                    <code style={{ fontSize: 10, color: '#888', wordBreak: 'break-all' }}>{i.selector}</code>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="깨진 이미지·링크" count={brokenCount}>
            {brokenCount === 0 ? (
              <p style={{ fontSize: 11, color: '#2e7d32' }}>깨진 리소스가 없습니다. 👍</p>
            ) : (
              <div style={{ fontSize: 11 }}>
                {brokenImages.map((r, idx) => (
                  <div key={`img-${idx}`} style={{ padding: '3px 2px', borderBottom: '1px solid #f0f0f0' }}>
                    <span style={{ color: '#b00020', fontWeight: 700, marginRight: 6 }}>이미지 깨짐</span>
                    <span style={{ wordBreak: 'break-all', color: '#555' }}>{r.url}</span>
                  </div>
                ))}
                {failedLinks.map((l, idx) => (
                  <div key={`lnk-${idx}`} style={{ padding: '3px 2px', borderBottom: '1px solid #f0f0f0' }}>
                    <span style={{ color: '#b00020', fontWeight: 700, marginRight: 6 }}>
                      {l.status ?? l.error ?? '오류'}
                    </span>
                    <span style={{ color: '#999', marginRight: 6 }}>
                      {RES_LABEL[linkUrlKind.get(l.url) ?? 'link']}
                    </span>
                    <span style={{ wordBreak: 'break-all', color: '#555' }}>{l.url}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="localStorage" count={audit.storage.local.length}>
            <StorageTable
              rows={audit.storage.local.map((e) => ({ k: e.key, v: e.value, masked: e.masked }))}
              empty="저장된 항목이 없습니다."
            />
          </Section>

          <Section title="쿠키" count={audit.storage.cookies.length}>
            <StorageTable
              rows={audit.storage.cookies.map((c) => ({
                k: c.name,
                v: c.value,
                masked: c.masked,
                tag: [c.httpOnly ? 'httpOnly' : null, c.secure ? 'secure' : null].filter(Boolean).join(' '),
              }))}
              empty="쿠키가 없습니다."
            />
          </Section>
        </>
      )}
    </div>
  );
}

function StorageTable({
  rows,
  empty,
}: {
  rows: { k: string; v: string; masked: boolean; tag?: string }[];
  empty: string;
}) {
  if (rows.length === 0) return <p style={{ fontSize: 11, color: '#999' }}>{empty}</p>;
  return (
    <div style={{ fontSize: 11 }}>
      {rows.map((r, idx) => (
        <div
          key={`${r.k}-${idx}`}
          style={{ display: 'flex', gap: 6, padding: '3px 2px', borderBottom: '1px solid #f6f6f6' }}
        >
          <span style={{ fontWeight: 600, minWidth: 90, wordBreak: 'break-all' }}>{r.k}</span>
          <span style={{ flex: 1, color: r.masked ? '#999' : '#333', wordBreak: 'break-all' }}>
            {r.v}
          </span>
          {r.tag && <span style={{ fontSize: 9, color: '#c47f00' }}>{r.tag}</span>}
        </div>
      ))}
    </div>
  );
}
