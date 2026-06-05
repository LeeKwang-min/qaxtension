import { useState } from 'react';
import type { DomTreeNode } from '../messaging/types';

interface Props {
  /** path 키('a.b.c') → 그 노드의 직계 자식들 (루트는 '') */
  childrenMap: Record<string, DomTreeNode[]>;
  /** 노드 펼치기 — 해당 path 의 자식을 요청 */
  onExpand: (path: number[]) => void;
  /** 노드 선택 — 해당 path 요소를 검사(상세 표시) */
  onSelect: (path: number[]) => void;
  /** 노드 호버 — 화면에서 해당 영역 하이라이트 (null 이면 숨김) */
  onHighlight: (path: number[] | null) => void;
}

const keyOf = (p: number[]): string => p.join('.');

function label(node: DomTreeNode): string {
  let s = node.tagName;
  if (node.id) s += `#${node.id}`;
  else if (node.classList.length) s += `.${node.classList.slice(0, 2).join('.')}`;
  return s;
}

function TreeNode({
  node,
  depth,
  childrenMap,
  expanded,
  selectedKey,
  onToggle,
  onHighlight,
}: {
  node: DomTreeNode;
  depth: number;
  childrenMap: Record<string, DomTreeNode[]>;
  expanded: Set<string>;
  selectedKey: string | null;
  onToggle: (node: DomTreeNode) => void;
  onHighlight: (path: number[] | null) => void;
}) {
  const k = keyOf(node.path);
  const open = expanded.has(k);
  const kids = childrenMap[k];
  const hasChildren = node.childElementCount > 0;
  const selected = selectedKey === k;
  const hiddenCount = kids ? node.childElementCount - kids.length : 0;

  return (
    <div>
      <div
        onClick={() => onToggle(node)}
        onMouseEnter={() => onHighlight(node.path)}
        style={{
          display: 'flex',
          gap: 4,
          alignItems: 'baseline',
          padding: '2px 4px',
          paddingLeft: 4 + depth * 12,
          fontSize: 11,
          fontFamily: 'monospace',
          cursor: 'pointer',
          background: selected ? '#eef4ff' : 'transparent',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <span style={{ width: 10, color: '#999' }}>{hasChildren ? (open ? '▾' : '▸') : ''}</span>
        <span style={{ color: '#0a58ca' }}>{label(node)}</span>
        {node.childElementCount > 0 && (
          <span style={{ color: '#bbb' }}>({node.childElementCount})</span>
        )}
        {node.textPreview && (
          <span style={{ color: '#888', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {node.textPreview}
          </span>
        )}
      </div>
      {open &&
        (kids ? (
          <>
            {kids.map((c) => (
              <TreeNode
                key={keyOf(c.path)}
                node={c}
                depth={depth + 1}
                childrenMap={childrenMap}
                expanded={expanded}
                selectedKey={selectedKey}
                onToggle={onToggle}
                onHighlight={onHighlight}
              />
            ))}
            {hiddenCount > 0 && (
              <div style={{ paddingLeft: 4 + (depth + 1) * 12, fontSize: 10, color: '#aaa' }}>
                …외 {hiddenCount}개 생략
              </div>
            )}
          </>
        ) : (
          <div style={{ paddingLeft: 4 + (depth + 1) * 12, fontSize: 10, color: '#aaa' }}>로딩…</div>
        ))}
    </div>
  );
}

export function DomTree({ childrenMap, onExpand, onSelect, onHighlight }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const roots = childrenMap[''];

  const onToggle = (node: DomTreeNode): void => {
    const k = keyOf(node.path);
    setSelectedKey(k);
    onSelect(node.path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
        if (!childrenMap[k] && node.childElementCount > 0) onExpand(node.path);
      }
      return next;
    });
  };

  if (!roots) {
    return <p style={{ fontSize: 11, color: '#999', margin: '4px 0' }}>DOM 트리를 불러오는 중…</p>;
  }

  return (
    <div
      onMouseLeave={() => onHighlight(null)}
      style={{ maxHeight: 240, overflow: 'auto', border: '1px solid #eee', borderRadius: 4, padding: '2px 0' }}
    >
      {roots.map((n) => (
        <TreeNode
          key={keyOf(n.path)}
          node={n}
          depth={0}
          childrenMap={childrenMap}
          expanded={expanded}
          selectedKey={selectedKey}
          onToggle={onToggle}
          onHighlight={onHighlight}
        />
      ))}
    </div>
  );
}
