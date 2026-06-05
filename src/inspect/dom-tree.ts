/** 경량 DOM 노드 (트리 표시용 — ElementInfo 보다 가벼움) */
export interface DomNode {
  tagName: string;
  id: string | null;
  classList: string[];
  /** 직계 자식 요소 수 (확장 가능 여부 판단) */
  childElementCount: number;
  /** 직접 텍스트 미리보기 (짧게, 없으면 null) */
  textPreview: string | null;
  /** 루트 기준 자식 인덱스 경로 (확장/조회 키) */
  path: number[];
}

const MAX_PREVIEW = 40;

/** 루트 기준 인덱스 경로로 요소를 찾는다. 경로가 잘못되면 null. */
export function elementByPath(root: Element, path: number[]): Element | null {
  let cur: Element = root;
  for (const idx of path) {
    const child = cur.children[idx];
    if (!child) return null;
    cur = child;
  }
  return cur;
}

/** 요소의 직접 텍스트(자식 텍스트 노드)를 짧게 추출 */
function textPreviewOf(el: Element): string | null {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) text += node.textContent ?? '';
  }
  text = text.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
}

function toDomNode(el: Element, path: number[]): DomNode {
  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || null,
    classList: Array.from(el.classList),
    childElementCount: el.childElementCount,
    textPreview: textPreviewOf(el),
    path,
  };
}

/**
 * 루트 기준 path 노드의 직계 자식 요소들을 경량 DomNode 로 직렬화한다.
 * 트리를 lazy 하게 한 단계씩 펼치기 위한 단위. 경로가 잘못되면 빈 배열.
 */
export function domChildren(root: Element, path: number[]): DomNode[] {
  const parent = elementByPath(root, path);
  if (!parent) return [];
  return Array.from(parent.children).map((child, i) => toDomNode(child, [...path, i]));
}
