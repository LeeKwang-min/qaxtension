export interface Picker {
  start(): void;
  stop(): void;
}

const OVERLAY_ATTR = 'data-qaxtension-overlay';

/**
 * 호버 하이라이트 + 클릭 선택 피커.
 * - start(): 오버레이 삽입 + mousemove/click/keydown 리스너 등록
 * - 클릭 시 onPick(element) 호출 후 자동 stop
 * - Escape 시 onCancel() 호출 후 자동 stop
 * 우리 오버레이는 pointer-events:none 이며 pick 대상에서 제외한다.
 */
export function createPicker(
  onPick: (el: Element) => void,
  onCancel?: () => void,
): Picker {
  let overlay: HTMLElement | null = null;
  let active = false;

  const isOurs = (node: EventTarget | null): boolean =>
    node instanceof Element && node.hasAttribute(OVERLAY_ATTR);

  const moveOverlay = (el: Element): void => {
    if (!overlay) return;
    const r = el.getBoundingClientRect();
    overlay.style.top = `${r.top + window.scrollY}px`;
    overlay.style.left = `${r.left + window.scrollX}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
  };

  const onMove = (e: MouseEvent): void => {
    const t = e.target;
    if (!(t instanceof Element) || isOurs(t)) return;
    moveOverlay(t);
  };

  const onClick = (e: MouseEvent): void => {
    const t = e.target;
    if (!(t instanceof Element) || isOurs(t)) return;
    e.preventDefault();
    e.stopPropagation();
    const picked = t;
    stop();
    onPick(picked);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      stop();
      onCancel?.();
    }
  };

  function start(): void {
    if (active) return;
    active = true;
    overlay = document.createElement('div');
    overlay.setAttribute(OVERLAY_ATTR, '');
    overlay.style.cssText = [
      'position:absolute',
      'z-index:2147483647',
      'pointer-events:none',
      'background:rgba(56,135,255,0.25)',
      'outline:2px solid rgba(56,135,255,0.9)',
      'top:0;left:0;width:0;height:0',
    ].join(';');
    document.body.appendChild(overlay);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function stop(): void {
    if (!active) return;
    active = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    overlay?.remove();
    overlay = null;
  }

  return { start, stop };
}
