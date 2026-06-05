import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { domChildren, elementByPath } from '../src/inspect/dom-tree';

function bodyOf(html: string): Element {
  return new JSDOM(html).window.document.body;
}

describe('domChildren', () => {
  it('returns direct element children of the root for an empty path', () => {
    const body = bodyOf('<body><header></header><main></main><footer></footer></body>');
    const nodes = domChildren(body, []);
    expect(nodes.map((n) => n.tagName)).toEqual(['header', 'main', 'footer']);
    expect(nodes.map((n) => n.path)).toEqual([[0], [1], [2]]);
  });

  it('descends into the child at the given index path', () => {
    const body = bodyOf('<body><main><section></section><article></article></main></body>');
    const nodes = domChildren(body, [0]);
    expect(nodes.map((n) => n.tagName)).toEqual(['section', 'article']);
    expect(nodes.map((n) => n.path)).toEqual([[0, 0], [0, 1]]);
  });

  it('reports id, classList and childElementCount', () => {
    const body = bodyOf('<body><div id="box" class="a b"><span></span><span></span></div></body>');
    const [node] = domChildren(body, []);
    expect(node.id).toBe('box');
    expect(node.classList).toEqual(['a', 'b']);
    expect(node.childElementCount).toBe(2);
  });

  it('captures a short text preview for leaf-ish nodes', () => {
    const body = bodyOf('<body><button>저장하기</button></body>');
    const [node] = domChildren(body, []);
    expect(node.textPreview).toBe('저장하기');
  });

  it('returns an empty array for an out-of-range or invalid path', () => {
    const body = bodyOf('<body><div></div></body>');
    expect(domChildren(body, [5])).toEqual([]);
    expect(domChildren(body, [0, 0])).toEqual([]);
  });

  it('ignores non-element nodes (text/comment) in children', () => {
    const body = bodyOf('<body>text<!--c--><div></div></body>');
    const nodes = domChildren(body, []);
    expect(nodes.map((n) => n.tagName)).toEqual(['div']);
  });

  it('caps the number of returned children (large lists stay fast)', () => {
    const items = Array.from({ length: 500 }, () => '<li></li>').join('');
    const body = bodyOf(`<body><ul>${items}</ul></body>`);
    const nodes = domChildren(body, [0], 100);
    expect(nodes).toHaveLength(100);
  });

  it('defaults to a reasonable cap when no limit is given', () => {
    const items = Array.from({ length: 1000 }, () => '<li></li>').join('');
    const body = bodyOf(`<body><ul>${items}</ul></body>`);
    const nodes = domChildren(body, [0]);
    expect(nodes.length).toBeLessThan(1000);
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe('elementByPath', () => {
  it('resolves the element at an index path', () => {
    const body = bodyOf('<body><main><section id="target"></section></main></body>');
    const el = elementByPath(body, [0, 0]);
    expect(el?.id).toBe('target');
  });

  it('returns the root for an empty path', () => {
    const body = bodyOf('<body><div></div></body>');
    expect(elementByPath(body, [])).toBe(body);
  });

  it('returns null for an invalid path', () => {
    const body = bodyOf('<body><div></div></body>');
    expect(elementByPath(body, [9])).toBeNull();
    expect(elementByPath(body, [0, 0])).toBeNull();
  });
});
