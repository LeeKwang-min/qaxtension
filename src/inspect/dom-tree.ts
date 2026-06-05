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
/** 한 번에 직렬화/전송할 자식 수 상한 (대형 리스트의 메시지 직렬화 지연 방지) */
export const DEFAULT_CHILDREN_LIMIT = 300;

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

/**
 * 루트 기준으로 요소까지의 인덱스 경로를 계산한다(elementByPath 의 역). 트리 동기화용.
 * 요소가 루트 자신이면 [], 루트 하위가 아니면 null.
 */
export function pathOfElement(root: Element, el: Element): number[] | null {
  const path: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) return null; // 루트에 도달하지 못함
    const idx = Array.prototype.indexOf.call(parent.children, cur);
    if (idx < 0) return null;
    path.unshift(idx);
    cur = parent;
  }
  return cur === root ? path : null;
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
 * `limit` 으로 자식 수를 제한해 대형 리스트에서도 메시지가 작게 유지된다
 * (잘렸는지는 부모의 childElementCount 와 비교해 UI 가 판단).
 */
export function domChildren(root: Element, path: number[], limit = DEFAULT_CHILDREN_LIMIT): DomNode[] {
  const parent = elementByPath(root, path);
  if (!parent) return [];
  const out: DomNode[] = [];
  const kids = parent.children;
  const n = Math.min(kids.length, Math.max(0, limit));
  for (let i = 0; i < n; i++) out.push(toDomNode(kids[i], [...path, i]));
  return out;
}
