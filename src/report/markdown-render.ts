// 리포트가 생성하는 제한된 마크다운 문법만 다루는 경량 파서.
// (전체 CommonMark 가 아님 — builder.ts 가 내보내는 헤딩/리스트/표/인라인만)
// React 미리보기가 dangerouslySetInnerHTML 없이 안전하게 렌더링하도록 토큰을 반환한다.

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string };

export type Block =
  | { type: 'heading'; level: 1 | 2; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'table'; headers: Inline[][]; rows: Inline[][][] };

/** 표 셀 등에서 escape 된 파이프를 복원 */
function unescape(s: string): string {
  return s.replace(/\\\|/g, '|');
}

// `code` > **bold** > _italic_ 순으로 매칭 (code 안은 리터럴)
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g;

/** 한 줄의 인라인 마크다운을 토큰 배열로 파싱 */
export function parseInline(text: string): Inline[] {
  const tokens: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ type: 'text', value: unescape(text.slice(last, idx)) });
    const tok = m[0];
    if (tok.startsWith('`')) {
      tokens.push({ type: 'code', value: tok.slice(1, -1) });
    } else if (tok.startsWith('**')) {
      tokens.push({ type: 'bold', value: unescape(tok.slice(2, -2)) });
    } else {
      tokens.push({ type: 'italic', value: unescape(tok.slice(1, -1)) });
    }
    last = idx + tok.length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: unescape(text.slice(last)) });
  return tokens;
}

/** '| a | b |' → ['a', 'b'] (escape 된 파이프는 분리하지 않음) */
function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  // escape 안 된 '|' 만 분리: 부정형 룩비하인드로 '\|' 제외
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** '|---|---|' 같은 표 구분선인지 */
function isSeparator(line: string): boolean {
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(line.trim());
}

/** 마크다운 문자열을 블록 배열로 파싱 */
export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      i++;
      continue;
    }

    // 헤딩
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'heading', level: 2, inlines: parseInline(trimmed.slice(3)) });
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'heading', level: 1, inlines: parseInline(trimmed.slice(2)) });
      i++;
      continue;
    }

    // 표: '|' 로 시작하고 다음 줄이 구분선
    if (trimmed.startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      // parseInline 이 셀 내부 escape 를 처리하므로 여기서 별도 unescape 불필요
      const headers = splitRow(line).map((c) => parseInline(c));
      i += 2; // 헤더 + 구분선 소비
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]).map((c) => parseInline(c)));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // 리스트: 연속된 '- ' 줄
    if (trimmed.startsWith('- ')) {
      const items: Inline[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        items.push(parseInline(lines[i].trim().slice(2)));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // 문단: 빈 줄/헤딩/표/리스트 전까지 모으되, 리포트는 한 줄 문단이 대부분
    blocks.push({ type: 'paragraph', inlines: parseInline(trimmed) });
    i++;
  }

  return blocks;
}
