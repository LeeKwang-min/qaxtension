// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPicker } from '../src/inspect/picker';

afterEach(() => {
  document.body.innerHTML = '';
  document.querySelectorAll('[data-qaxtension-overlay]').forEach((n) => n.remove());
});

describe('createPicker', () => {
  it('inserts an overlay element on start and removes it on stop', () => {
    const picker = createPicker(() => {});
    picker.start();
    expect(document.querySelector('[data-qaxtension-overlay]')).not.toBeNull();
    picker.stop();
    expect(document.querySelector('[data-qaxtension-overlay]')).toBeNull();
  });

  it('invokes onPick with the clicked element, suppresses the page click, and stops', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    const pageHandler = vi.fn(); // 페이지 자신의 버블 단계 클릭 핸들러
    target.addEventListener('click', pageHandler);

    const onPick = vi.fn();
    const picker = createPicker(onPick);
    picker.start();

    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(evt);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toBe(target);
    // 피커가 capture 단계에서 가로채 preventDefault + stopPropagation 했는지
    expect(evt.defaultPrevented).toBe(true);
    expect(pageHandler).not.toHaveBeenCalled();
    // 클릭 후 자동 종료
    expect(document.querySelector('[data-qaxtension-overlay]')).toBeNull();
  });

  it('invokes onCancel and stops when Escape is pressed', () => {
    const onCancel = vi.fn();
    const picker = createPicker(() => {}, onCancel);
    picker.start();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-qaxtension-overlay]')).toBeNull();
  });

  it('ignores its own overlay element as a pick target', () => {
    const onPick = vi.fn();
    const picker = createPicker(onPick);
    picker.start();
    const overlay = document.querySelector('[data-qaxtension-overlay]') as HTMLElement;
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPick).not.toHaveBeenCalled();
    picker.stop();
  });
});
