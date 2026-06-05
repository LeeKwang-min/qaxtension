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

  it('invokes onPick with the clicked element and stops', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    const onPick = vi.fn();
    const picker = createPicker(onPick);
    picker.start();

    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toBe(target);
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
