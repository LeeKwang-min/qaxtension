import { describe, it, expect } from 'vitest';
import { parseInline, parseBlocks } from '../src/report/markdown-render';

describe('parseInline', () => {
  it('returns a single text token for plain text', () => {
    expect(parseInline('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });
  it('parses **bold**', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', value: 'b' },
      { type: 'text', value: ' c' },
    ]);
  });
  it('parses `code`', () => {
    expect(parseInline('run `npm test` now')).toEqual([
      { type: 'text', value: 'run ' },
      { type: 'code', value: 'npm test' },
      { type: 'text', value: ' now' },
    ]);
  });
  it('parses _italic_', () => {
    expect(parseInline('_검사한 요소 없음_')).toEqual([{ type: 'italic', value: '검사한 요소 없음' }]);
  });
  it('does not treat code content as bold/italic (code wins, literal inside)', () => {
    expect(parseInline('`a_b_c`')).toEqual([{ type: 'code', value: 'a_b_c' }]);
  });
  it('unescapes \\| to | in text', () => {
    expect(parseInline('a=1\\|2')).toEqual([{ type: 'text', value: 'a=1|2' }]);
  });
  it('handles multiple tokens in order', () => {
    expect(parseInline('**생성:** `2024` 끝')).toEqual([
      { type: 'bold', value: '생성:' },
      { type: 'text', value: ' ' },
      { type: 'code', value: '2024' },
      { type: 'text', value: ' 끝' },
    ]);
  });
});

describe('parseBlocks', () => {
  it('parses an h1', () => {
    expect(parseBlocks('# 버그 리포트')).toEqual([
      { type: 'heading', level: 1, inlines: [{ type: 'text', value: '버그 리포트' }] },
    ]);
  });
  it('parses an h2', () => {
    expect(parseBlocks('## 환경')).toEqual([
      { type: 'heading', level: 2, inlines: [{ type: 'text', value: '환경' }] },
    ]);
  });
  it('groups consecutive "- " lines into one list', () => {
    const blocks = parseBlocks('- a\n- b\n- c');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('list');
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(3);
  });
  it('parses a paragraph with inline formatting', () => {
    const blocks = parseBlocks('_없음_');
    expect(blocks).toEqual([
      { type: 'paragraph', inlines: [{ type: 'italic', value: '없음' }] },
    ]);
  });
  it('separates blocks on blank lines', () => {
    const blocks = parseBlocks('# Title\n\n## Section\n\ntext');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'heading', 'paragraph']);
  });
  it('parses a table with header and rows, dropping the separator row', () => {
    const md = ['| 메서드 | URL |', '|---|---|', '| GET | /a |', '| POST | /b |'].join('\n');
    const blocks = parseBlocks(md);
    expect(blocks).toHaveLength(1);
    const t = blocks[0] as {
      type: string;
      headers: { value: string }[][];
      rows: { value: string }[][][];
    };
    expect(t.type).toBe('table');
    expect(t.headers.map((c) => c[0].value)).toEqual(['메서드', 'URL']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].map((c) => c[0].value)).toEqual(['GET', '/a']);
  });
  it('unescapes pipes inside table cells', () => {
    const md = ['| URL |', '|---|', '| a=1\\|2 |'].join('\n');
    const blocks = parseBlocks(md);
    const t = blocks[0] as { rows: { value: string }[][][] };
    expect(t.rows[0][0][0].value).toBe('a=1|2');
  });
  it('parses a full report shape without throwing', () => {
    const md = [
      '# 버그 리포트',
      '',
      '- **생성:** 2024-06-05 08:00:00 UTC',
      '- **URL:** https://example.com',
      '',
      '## 실패한 API (1건)',
      '',
      '| 메서드 | URL | 상태 | 소요 |',
      '|---|---|---|---|',
      '| GET | https://api/x | 500 | 120ms |',
    ].join('\n');
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'heading', 'table']);
  });
});
