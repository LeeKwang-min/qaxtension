// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownPreview } from '../src/sidepanel/MarkdownPreview';

function html(md: string): string {
  return renderToStaticMarkup(<MarkdownPreview markdown={md} />);
}

describe('MarkdownPreview rendering', () => {
  it('renders headings as <h1>/<h2>, not literal "#"', () => {
    const out = html('# 버그 리포트\n\n## 환경');
    expect(out).toContain('<h1');
    expect(out).toContain('버그 리포트');
    expect(out).toContain('<h2');
    expect(out).not.toContain('# 버그 리포트');
  });

  it('renders "- " lines as a <ul> with <li>, not literal dashes', () => {
    const out = html('- a\n- b');
    expect(out).toContain('<ul');
    expect((out.match(/<li/g) ?? []).length).toBe(2);
    expect(out).not.toContain('- a');
  });

  it('renders a pipe table as a real <table>', () => {
    const out = html(['| M | URL |', '|---|---|', '| GET | /a |'].join('\n'));
    expect(out).toContain('<table');
    expect(out).toContain('<th');
    expect(out).toContain('<td');
    expect(out).not.toContain('|---|');
  });

  it('renders **bold** as <strong> and `code` as <code>', () => {
    const out = html('- **생성:** `2024`');
    expect(out).toContain('<strong>생성:</strong>');
    expect(out).toContain('<code');
    expect(out).toContain('2024');
  });

  it('escapes user content (no raw HTML injection)', () => {
    const out = html('## <img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });
});
