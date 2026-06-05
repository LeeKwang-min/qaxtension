export interface Highlighter {
  /** 요소 위에 하이라이트 오버레이를 표시 */
  show(el: Element): void;
  /** 오버레이 숨김 */
  hide(): void;
}

const HIGHLIGHT_ATTR = 'data-qaxtension-highlight';

/**
 * 페이지 위에 비파괴적 하이라이트 오버레이를 그린다(피커 오버레이와 별개).
 * DOM 트리에서 노드에 호버할 때 해당 영역을 화면에서 가리키는 용도.
 */
export function createHighlighter(): Highlighter {
  let overlay: HTMLElement | null = null;

  const ensure = (): HTMLElement => {
    if (overlay && overlay.isConnected) return overlay;
    overlay = document.createElement('div');
    overlay.setAttribute(HIGHLIGHT_ATTR, '');
    overlay.style.cssText = [
      'position:absolute',
      'z-index:2147483646',
      'pointer-events:none',
      'background:rgba(255,145,0,0.22)',
      'outline:2px solid rgba(255,145,0,0.95)',
      'border-radius:1px',
      'display:none',
      'top:0;left:0;width:0;height:0',
    ].join(';');
    document.body.appendChild(overlay);
    return overlay;
  };

  return {
    show(el: Element): void {
      const o = ensure();
      const r = el.getBoundingClientRect();
      o.style.top = `${r.top + window.scrollY}px`;
      o.style.left = `${r.left + window.scrollX}px`;
      o.style.width = `${r.width}px`;
      o.style.height = `${r.height}px`;
      o.style.display = 'block';
      // 화면 밖이면 보이도록 스크롤
      if (r.top < 0 || r.bottom > window.innerHeight) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    },
    hide(): void {
      if (overlay) overlay.style.display = 'none';
    },
  };
}
