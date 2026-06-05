// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { cssPath, buildElementInfo } from '../src/inspect/element-info';
import type { StyleLike } from '../src/inspect/element-info';

function makeStyle(overrides: Partial<StyleLike> = {}): StyleLike {
  return {
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgb(255, 255, 255)',
    borderColor: 'rgb(0, 0, 0)',
    fontFamily: 'Arial',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '24px',
    letterSpacing: 'normal',
    width: '100px',
    height: '20px',
    margin: '0px',
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid rgb(0, 0, 0)',
    ...overrides,
  };
}

describe('cssPath', () => {
  it('uses #id when present', () => {
    const el = document.createElement('div');
    el.id = 'hero';
    expect(cssPath(el)).toBe('#hero');
  });
  it('falls back to tag + classes', () => {
    const el = document.createElement('button');
    el.className = 'btn primary';
    expect(cssPath(el)).toBe('button.btn.primary');
  });
});

describe('buildElementInfo', () => {
  it('extracts colors, typography, box model', () => {
    const el = document.createElement('p');
    el.textContent = 'Hello';
    const info = buildElementInfo(el, makeStyle());
    expect(info.tagName).toBe('p');
    expect(info.colors.color.hex).toBe('#000000');
    expect(info.colors.backgroundColor.hex).toBe('#ffffff');
    expect(info.typography.fontSize).toBe('16px');
    expect(info.boxModel.padding).toBe('8px');
    expect(info.text).toBe('Hello');
  });

  it('computes contrast when background is opaque', () => {
    const el = document.createElement('p');
    const info = buildElementInfo(el, makeStyle());
    expect(info.accessibility.contrast).not.toBeNull();
    expect(info.accessibility.contrast!.level).toBe('AAA'); // black on white, 16px
  });

  it('returns null contrast when background is transparent', () => {
    const el = document.createElement('p');
    const info = buildElementInfo(el, makeStyle({ backgroundColor: 'rgba(0, 0, 0, 0)' }));
    expect(info.accessibility.contrast).toBeNull();
  });

  it('captures img alt and role', () => {
    const el = document.createElement('img');
    el.setAttribute('alt', 'logo');
    el.setAttribute('role', 'img');
    const info = buildElementInfo(el, makeStyle());
    expect(info.accessibility.alt).toBe('logo');
    expect(info.accessibility.role).toBe('img');
  });

  it('keeps null (not empty string) when alt/role/aria-label absent', () => {
    const el = document.createElement('div');
    const info = buildElementInfo(el, makeStyle());
    expect(info.accessibility.alt).toBeNull();
    expect(info.accessibility.role).toBeNull();
    expect(info.accessibility.ariaLabel).toBeNull();
  });
});
