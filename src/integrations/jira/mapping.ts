import type { ReportInput, AdfDoc, AdfNode, JiraCreatePayload } from '../../messaging/types';

/** URL 에서 pathname 만 추출 (파싱 실패 시 원본 반환) */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * 리포트 입력에서 JIRA 이슈 제목을 자동 제안한다.
 * 우선순위: 실패 API > 콘솔 에러 > 페이지 URL > 기본값
 */
export function suggestTitle(input: ReportInput): string {
  // 1순위: 실패한 API 요청
  const fail = input.requests.find(
    (r) => r.ok === false || r.error != null || (r.status != null && r.status >= 400),
  );
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

// ── ADF 빌더 헬퍼 ─────────────────────────────────────────────

const text = (s: string): AdfNode => ({ type: 'text', text: s });

const para = (s: string): AdfNode => ({
  type: 'paragraph',
  content: [text(s)],
});

const heading = (s: string): AdfNode => ({
  type: 'heading',
  attrs: { level: 3 },
  content: [text(s)],
});

const bulletList = (items: string[]): AdfNode => ({
  type: 'bulletList',
  content: items.map((i) => ({
    type: 'listItem',
    content: [para(i)],
  })),
});

/**
 * 리포트 입력에서 Atlassian Document Format(ADF) 설명 문서를 빌드한다.
 * JIRA REST API v3 는 description 에 ADF JSON 을 요구한다.
 */
export function buildDescriptionADF(input: ReportInput): AdfDoc {
  const content: AdfNode[] = [];

  // 환경 정보 섹션
  if (input.env) {
    content.push(heading('환경'));
    content.push(
      bulletList([
        `URL: ${input.env.url ?? '(알 수 없음)'}`,
        `OS: ${input.env.os}`,
        `뷰포트: ${input.env.viewport.width}×${input.env.viewport.height}`,
        `언어: ${input.env.language}`,
      ]),
    );
  }

  // 실패한 API 섹션
  const fails = input.requests.filter((r) => r.ok === false || r.error != null);
  if (fails.length) {
    content.push(heading('실패한 API'));
    content.push(
      bulletList(
        fails.map((r) => `${r.status ?? r.error ?? '오류'} ${r.method} ${pathOf(r.url)}`),
      ),
    );
  }

  // 콘솔 에러·경고 섹션
  const errors = input.logs.filter((l) => l.level === 'error' || l.level === 'warn');
  if (errors.length) {
    content.push(heading('콘솔 에러·경고'));
    content.push(
      bulletList(errors.map((l) => `[${l.level}] ${l.text.slice(0, 200)}`)),
    );
  }

  // 검사한 요소 섹션
  if (input.pickedElement) {
    content.push(heading('검사한 요소'));
    content.push(
      bulletList([
        `셀렉터: ${input.pickedElement.selector}`,
        input.pickedElement.text
          ? `텍스트: ${input.pickedElement.text}`
          : '텍스트: —',
      ]),
    );
  }

  // 재현 절차 섹션
  if (input.steps.length) {
    content.push(heading('재현 절차'));
    content.push({
      type: 'orderedList',
      content: input.steps.map((s) => ({
        type: 'listItem',
        content: [
          para(`${s.kind}: ${s.selector ?? ''} ${s.value ?? ''}`.trim()),
        ],
      })),
    });
  }

  // 데이터가 없으면 안내 문단만
  if (content.length === 0) {
    content.push(para('첨부된 분석 데이터가 없습니다.'));
  }

  return { type: 'doc', version: 1, content };
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
 */
export function buildIssueFields(payload: JiraCreatePayload): JiraFields {
  return {
    project: { id: payload.projectId },
    issuetype: { id: payload.issueTypeId },
    summary: payload.summary,
    description: buildDescriptionADF(payload.report),
    labels: ['qa-companion'],
  };
}
