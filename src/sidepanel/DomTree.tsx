import { useEffect, useRef, useState } from 'react';
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
  /** 페이지에서 가리킨 요소의 경로 — 트리를 그 위치로 펼치고 강조 (null 이면 동기화 안 함) */
  syncPath: number[] | null;
  /** 값이 바뀌면 모든 노드를 접는다 (0 은 초기값, 무시) */
  collapseSignal: number;
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
  const rowRef = useRef<HTMLDivElement>(null);

  // 선택(동기화)된 노드가 트리 뷰 밖이면 보이도록 스크롤
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div>
      <div
        ref={rowRef}
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

export function DomTree({ childrenMap, onExpand, onSelect, onHighlight, syncPath, collapseSignal }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const roots = childrenMap[''];
  const syncKey = syncPath ? keyOf(syncPath) : null;

  // "모두 접기" — collapseSignal 이 바뀌면 모든 노드를 접고 선택 해제
  useEffect(() => {
    if (collapseSignal === 0) return;
    setExpanded(new Set());
    setSelectedKey(null);
  }, [collapseSignal]);

  // 페이지 → 트리 동기화: 가리킨 요소의 조상을 모두 펼치고 그 노드를 선택
  useEffect(() => {
    if (!syncPath) return;
    setSelectedKey(keyOf(syncPath));
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < syncPath.length; i++) next.add(keyOf(syncPath.slice(0, i)));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  // 펼쳐졌지만 자식이 아직 없는 조상을 점진적으로 로드 (응답이 오면 다음 단계 진행)
  useEffect(() => {
    if (!syncPath) return;
    for (let i = 0; i < syncPath.length; i++) {
      const ancestor = syncPath.slice(0, i);
      const key = keyOf(ancestor);
      if (expanded.has(key) && !childrenMap[key]) onExpand(ancestor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey, childrenMap, expanded]);

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
