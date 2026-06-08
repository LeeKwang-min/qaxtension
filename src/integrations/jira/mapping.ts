import type { AdfDoc, AdfNode, JiraCreatePayload, ReportInput, RequestRecord } from '../../messaging/types';
import { parseBlocks, type Block, type Inline } from '../../report/markdown-render';

/** URL 에서 pathname 만 추출 (파싱 실패 시 원본 반환) */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * 요청 레코드가 실패로 간주되는지 판정한다.
 * ok === false | error 존재 | status >= 400 중 하나라도 해당하면 실패.
 * webRequest-only 레코드(ok=null, status>=400)도 올바르게 감지한다.
 */
export function isFailedRequest(r: RequestRecord): boolean {
  return r.ok === false || r.error != null || (r.status != null && r.status >= 400);
}

/**
 * 리포트 입력에서 JIRA 이슈 제목을 자동 제안한다.
 * 우선순위: 실패 API > 콘솔 에러 > 페이지 URL > 기본값
 */
export function suggestTitle(input: ReportInput): string {
  // 1순위: 실패한 API 요청
  const fail = input.requests.find(isFailedRequest);
  if (fail) {
    return `[QA] ${fail.method} ${pathOf(fail.url)} ${fail.status ?? '오류'}`;
  }

  // 2순위: 콘솔 에러 로그
  const err = input.logs.find((l) => l.level === 'error');
  if (err) {
    return `[QA] ${err.text.slice(0, 80)}`;
  }

  // 3순위: 환경 URL
  const url = input.env?.url;
  return url ? `[QA] ${url} 이슈` : '[QA] 이슈';
}

// ── Markdown → ADF 변환 ────────────────────────────────────────

function inlinesToAdf(inlines: Inline[]): AdfNode[] {
  return inlines
    .filter((t) => t.value !== '')
    .map((t) => {
      if (t.type === 'bold') return { type: 'text', text: t.value, marks: [{ type: 'strong' }] };
      if (t.type === 'italic') return { type: 'text', text: t.value, marks: [{ type: 'em' }] };
      if (t.type === 'code') return { type: 'text', text: t.value, marks: [{ type: 'code' }] };
      return { type: 'text', text: t.value };
    });
}

// ADF paragraph 는 content 가 비면 안 되는 경우가 있어, 빈 줄은 텍스트 없는 paragraph 로
function paragraphFrom(inlines: Inline[]): AdfNode {
  const content = inlinesToAdf(inlines);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function cellFrom(kind: 'tableHeader' | 'tableCell', inlines: Inline[]): AdfNode {
  return { type: kind, attrs: {}, content: [paragraphFrom(inlines)] };
}

function blocksToAdf(blocks: Block[]): AdfNode[] {
  return blocks.map((b): AdfNode => {
    switch (b.type) {
      case 'heading':
        return { type: 'heading', attrs: { level: b.level === 1 ? 2 : 3 }, content: inlinesToAdf(b.inlines) };
      case 'paragraph':
        return paragraphFrom(b.inlines);
      case 'list':
        return { type: 'bulletList', content: b.items.map((it) => ({ type: 'listItem', content: [paragraphFrom(it)] })) };
      case 'table':
        return {
          type: 'table',
          content: [
            { type: 'tableRow', content: b.headers.map((h) => cellFrom('tableHeader', h)) },
            ...b.rows.map((row) => ({ type: 'tableRow', content: row.map((c) => cellFrom('tableCell', c)) })),
          ],
        };
    }
  });
}

/**
 * markdown 문자열을 Atlassian Document Format(ADF) doc 으로 변환한다.
 * 미리보기와 동일한 parseBlocks 를 재사용하므로 티켓 본문 = 미리보기.
 */
export function markdownToAdf(markdown: string): AdfDoc {
  const content = blocksToAdf(parseBlocks(markdown));
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph' }] };
}

/** buildIssueFields 의 반환 타입 */
export interface JiraFields {
  project: { id: string };
  issuetype: { id: string };
  summary: string;
  description: AdfDoc;
  labels: string[];
}

/**
 * JIRA 이슈 생성 페이로드의 fields 객체를 빌드한다.
 * project/issuetype/summary/description/labels 를 구성하며,
 * labels 에는 항상 'qa-companion' 태그를 포함한다.
 * description 은 미리보기와 동일한 markdown 을 ADF 로 변환해 사용한다.
 */
export function buildIssueFields(payload: JiraCreatePayload): JiraFields {
  return {
    project: { id: payload.projectId },
    issuetype: { id: payload.issueTypeId },
    summary: payload.summary,
    description: markdownToAdf(payload.descriptionMarkdown),
    labels: ['qa-companion'],
  };
}
