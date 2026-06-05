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
  it('caps classes at 3 per level', () => {
    const el = document.createElement('span');
    el.className = 'a b c d';
    expect(cssPath(el)).toBe('span.a.b.c');
  });
  it('terminates the chain at an ancestor id', () => {
    const wrap = document.createElement('section');
    wrap.id = 'main';
    const child = document.createElement('p');
    wrap.appendChild(child);
    expect(cssPath(child)).toBe('#main > p');
  });
  it('limits depth to 4 levels', () => {
    // 6단계 중첩 → 시작 요소 포함 최대 4단계만 (id 없음)
    const root = document.createElement('div');
    let cur: HTMLElement = root;
    for (const tag of ['section', 'article', 'ul', 'li', 'a']) {
      const next = document.createElement(tag);
      cur.appendChild(next);
      cur = next;
    }
    // cur = <a>, 조상 체인: li > ul > article > section > div(root)
    const path = cssPath(cur);
    expect(path.split(' > ').length).toBe(4);
    expect(path.endsWith('a')).toBe(true);
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
  it('returns null text for empty or whitespace-only content', () => {
    const el = document.createElement('div');
    el.textContent = '   ';
    expect(buildElementInfo(el, makeStyle()).text).toBeNull();
  });
  it('truncates long text to 80 chars', () => {
    const el = document.createElement('p');
    el.textContent = 'x'.repeat(100);
    expect(buildElementInfo(el, makeStyle()).text).toHaveLength(80);
  });

  it('computes domPath relative to body for attached elements', () => {
    const wrap = document.createElement('section');
    const el = document.createElement('span');
    wrap.appendChild(el);
    document.body.appendChild(wrap);
    const info = buildElementInfo(el, makeStyle());
    expect(info.domPath).not.toBeNull();
    // body 의 마지막 자식(wrap) 하위 첫 요소(span)
    const bodyIdx = Array.prototype.indexOf.call(document.body.children, wrap);
    expect(info.domPath).toEqual([bodyIdx, 0]);
    wrap.remove();
  });

  it('domPath is null for detached elements', () => {
    const el = document.createElement('div');
    expect(buildElementInfo(el, makeStyle()).domPath).toBeNull();
  });
});
