import { Fragment } from 'react';
import { parseBlocks, type Inline, type Block } from '../report/markdown-render';

/** 인라인 토큰 배열 → React 노드 (dangerouslySetInnerHTML 없이 안전) */
function renderInlines(inlines: Inline[]) {
  return inlines.map((t, i) => {
    if (t.type === 'bold') return <strong key={i}>{t.value}</strong>;
    if (t.type === 'italic') return <em key={i} style={{ color: '#888' }}>{t.value}</em>;
    if (t.type === 'code')
      return (
        <code
          key={i}
          style={{ background: '#eceff1', borderRadius: 3, padding: '0 3px', fontSize: 11 }}
        >
          {t.value}
        </code>
      );
    return <Fragment key={i}>{t.value}</Fragment>;
  });
}

const TD: React.CSSProperties = {
  border: '1px solid #e0e0e0',
  padding: '3px 6px',
  textAlign: 'left',
  wordBreak: 'break-all',
};

function renderBlock(b: Block, key: number) {
  switch (b.type) {
    case 'heading':
      return b.level === 1 ? (
        <h1 key={key} style={{ fontSize: 15, margin: '4px 0 8px', borderBottom: '1px solid #eee', paddingBottom: 4 }}>
          {renderInlines(b.inlines)}
        </h1>
      ) : (
        <h2 key={key} style={{ fontSize: 13, margin: '12px 0 4px' }}>
          {renderInlines(b.inlines)}
        </h2>
      );
    case 'list':
      return (
        <ul key={key} style={{ margin: '4px 0', paddingLeft: 18 }}>
          {b.items.map((it, i) => (
            <li key={i} style={{ margin: '2px 0' }}>
              {renderInlines(it)}
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div key={key} style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', margin: '4px 0', fontSize: 11, width: '100%' }}>
            <thead>
              <tr>
                {b.headers.map((h, i) => (
                  <th key={i} style={{ ...TD, background: '#f5f5f5', fontWeight: 700 }}>
                    {renderInlines(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={TD}>
                      {renderInlines(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'paragraph':
      return (
        <p key={key} style={{ margin: '4px 0' }}>
          {renderInlines(b.inlines)}
        </p>
      );
  }
}

/** 리포트 마크다운을 렌더링된 미리보기로 표시 */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div
      data-testid="md-preview"
      style={{
        marginTop: 6,
        padding: 10,
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: 1.5,
        maxHeight: 320,
        overflow: 'auto',
      }}
    >
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  );
}
