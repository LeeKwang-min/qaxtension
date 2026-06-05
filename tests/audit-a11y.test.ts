import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { auditA11y, type ContrastStyle } from '../src/audit/a11y';

/** 대비를 절대 트리거하지 않는 기본 스타일 (검정 글자 / 흰 배경 = 21:1) */
const safeStyle = (): ContrastStyle => ({
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgb(255, 255, 255)',
  fontSize: '16px',
  fontWeight: '400',
});

function audit(html: string, getStyle: (el: Element) => ContrastStyle = safeStyle) {
  const dom = new JSDOM(html);
  return auditA11y(dom.window.document, getStyle);
}

describe('auditA11y', () => {
  it('flags <img> without alt attribute', () => {
    const issues = audit('<html lang="ko"><body><img src="a.png"></body></html>');
    expect(issues.some((i) => i.kind === 'img-alt')).toBe(true);
  });

  it('does not flag <img> with alt (including empty decorative alt)', () => {
    const issues = audit('<html lang="ko"><body><img src="a.png" alt=""><img src="b.png" alt="로고"></body></html>');
    expect(issues.some((i) => i.kind === 'img-alt')).toBe(false);
  });

  it('flags button with no accessible name', () => {
    const issues = audit('<html lang="ko"><body><button></button></body></html>');
    expect(issues.some((i) => i.kind === 'control-name')).toBe(true);
  });

  it('does not flag button named by text, aria-label, or title', () => {
    const issues = audit(
      '<html lang="ko"><body><button>저장</button><button aria-label="닫기"></button><button title="메뉴"></button></body></html>',
    );
    expect(issues.some((i) => i.kind === 'control-name')).toBe(false);
  });

  it('flags link with no accessible name', () => {
    const issues = audit('<html lang="ko"><body><a href="/x"></a></body></html>');
    expect(issues.some((i) => i.kind === 'control-name')).toBe(true);
  });

  it('flags text input without a label', () => {
    const issues = audit('<html lang="ko"><body><input type="text"></body></html>');
    expect(issues.some((i) => i.kind === 'input-label')).toBe(true);
  });

  it('does not flag input labeled by for/id, aria-label, or wrapping label', () => {
    const issues = audit(
      '<html lang="ko"><body>' +
        '<label for="a">이름</label><input id="a" type="text">' +
        '<input type="text" aria-label="검색">' +
        '<label>이메일<input type="text"></label>' +
        '</body></html>',
    );
    expect(issues.some((i) => i.kind === 'input-label')).toBe(false);
  });

  it('does not flag hidden or non-text inputs', () => {
    const issues = audit('<html lang="ko"><body><input type="hidden"><input type="submit" value="전송"></body></html>');
    expect(issues.some((i) => i.kind === 'input-label')).toBe(false);
  });

  it('flags missing <html lang>', () => {
    const issues = audit('<html><body><p>x</p></body></html>');
    expect(issues.some((i) => i.kind === 'html-lang')).toBe(true);
  });

  it('flags low-contrast text (WCAG Fail)', () => {
    // 옅은 회색 글자 / 흰 배경 → Fail
    const lowContrast = (el: Element): ContrastStyle =>
      el.tagName === 'P'
        ? { color: 'rgb(200, 200, 200)', backgroundColor: 'rgb(255, 255, 255)', fontSize: '14px', fontWeight: '400' }
        : safeStyle();
    const issues = audit('<html lang="ko"><body><p>읽기 어려운 글자</p></body></html>', lowContrast);
    expect(issues.some((i) => i.kind === 'contrast')).toBe(true);
  });

  it('does not flag contrast for empty/whitespace text elements', () => {
    const lowContrast = (): ContrastStyle => ({
      color: 'rgb(200, 200, 200)',
      backgroundColor: 'rgb(255, 255, 255)',
      fontSize: '14px',
      fontWeight: '400',
    });
    const issues = audit('<html lang="ko"><body><p>   </p></body></html>', lowContrast);
    expect(issues.some((i) => i.kind === 'contrast')).toBe(false);
  });

  it('includes selector and human-readable message', () => {
    const issues = audit('<html lang="ko"><body><img id="hero" src="a.png"></body></html>');
    const issue = issues.find((i) => i.kind === 'img-alt');
    expect(issue?.selector).toBe('#hero');
    expect(issue?.message.length).toBeGreaterThan(0);
  });
});
