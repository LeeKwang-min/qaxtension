import { describe, it, expect } from 'vitest';
import { suggestTitle, markdownToAdf, buildIssueFields, isFailedRequest } from '../src/integrations/jira/mapping';
import type { ReportInput, RequestRecord, LogRecord } from '../src/messaging/types';

function emptyInput(over: Partial<ReportInput> = {}): ReportInput {
  return {
    generatedAt: 0, env: null, pickedElement: null,
    requests: [], logs: [], steps: [], screenshot: null, ...over,
  };
}
function failReq(): RequestRecord {
  return {
    id: 'r1', source: 'fetch', method: 'POST', url: 'https://api.test/login',
    status: 500, statusText: 'Error', ok: false, error: null,
    durationMs: 12, startedAt: 0, requestBody: null, responseBody: null,
    fromCache: null, webReqId: null,
  } as RequestRecord;
}
function errLog(text: string): LogRecord {
  return { id: 'l1', level: 'error', source: 'console', text, count: 1, firstAt: 0, lastAt: 0, stack: null, location: null } as LogRecord;
}

describe('suggestTitle', () => {
  it('실패 API 가 있으면 그 정보로 제목', () => {
    expect(suggestTitle(emptyInput({ requests: [failReq()] }))).toBe('[QA] POST /login 500');
  });
  it('실패 API 없고 콘솔 에러 있으면 첫 에러', () => {
    expect(suggestTitle(emptyInput({ logs: [errLog('TypeError: x is undefined')] }))).toBe('[QA] TypeError: x is undefined');
  });
  it('둘 다 없으면 URL 기반', () => {
    expect(suggestTitle(emptyInput({ env: { url: 'https://shop.test/cart' } as ReportInput['env'] }))).toBe('[QA] https://shop.test/cart 이슈');
  });
});

/** webRequest-only 레코드: ok=null, status=500, error=null */
function webReqOnlyFailReq(): RequestRecord {
  return {
    id: 'r2', source: 'webRequest', method: 'GET', url: 'https://api.test/data',
    status: 500, statusText: 'Internal Server Error', ok: null, error: null,
    durationMs: 10, startedAt: 0, requestBody: null, responseBody: null,
    fromCache: null, webReqId: 'w1',
  } as RequestRecord;
}

describe('isFailedRequest', () => {
  it('ok=false 이면 실패', () => {
    expect(isFailedRequest(failReq())).toBe(true);
  });
  it('ok=null, status=500 이면 실패 (webRequest-only)', () => {
    expect(isFailedRequest(webReqOnlyFailReq())).toBe(true);
  });
  it('ok=true, status=200 이면 성공', () => {
    const r: RequestRecord = {
      id: 'r3', source: 'fetch', method: 'GET', url: 'https://api.test/ok',
      status: 200, statusText: 'OK', ok: true, error: null,
      durationMs: 5, startedAt: 0, requestBody: null, responseBody: null,
      fromCache: null, webReqId: null,
    } as RequestRecord;
    expect(isFailedRequest(r)).toBe(false);
  });
});

describe('markdownToAdf', () => {
  it('heading: ## 환경 → ADF heading level 3', () => {
    const adf = markdownToAdf('## 환경');
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    const h = adf.content[0];
    expect(h.type).toBe('heading');
    expect(h.attrs?.level).toBe(3);
    expect(h.content?.[0]?.text).toBe('환경');
  });

  it('heading: # h1 → ADF heading level 2', () => {
    const adf = markdownToAdf('# 제목');
    const h = adf.content[0];
    expect(h.type).toBe('heading');
    expect(h.attrs?.level).toBe(2);
  });

  it('table: 헤더+행 → ADF table/tableRow/tableHeader/tableCell 포함', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const adf = markdownToAdf(md);
    const json = JSON.stringify(adf);
    expect(json).toContain('"table"');
    expect(json).toContain('"tableHeader"');
    expect(json).toContain('"tableCell"');
    expect(json).toContain('"A"');
    expect(json).toContain('"1"');
  });

  it('table: tableRow 는 헤더 1개 + 데이터 행만큼', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const adf = markdownToAdf(md);
    const table = adf.content[0];
    // tableRow 3개: 헤더행 1 + 데이터행 2
    expect(table.content?.length).toBe(3);
    expect(table.content?.[0].content?.[0].type).toBe('tableHeader');
    expect(table.content?.[1].content?.[0].type).toBe('tableCell');
  });

  it('bold: **굵게** → marks:[{type:strong}]', () => {
    const adf = markdownToAdf('**굵게**');
    const para = adf.content[0];
    const node = para.content?.[0];
    expect(node?.type).toBe('text');
    expect(node?.text).toBe('굵게');
    expect(node?.marks).toEqual([{ type: 'strong' }]);
  });

  it('italic: _기울임_ → marks:[{type:em}]', () => {
    const adf = markdownToAdf('_기울임_');
    const para = adf.content[0];
    const node = para.content?.[0];
    expect(node?.marks).toEqual([{ type: 'em' }]);
  });

  it('code: `코드` → marks:[{type:code}]', () => {
    const adf = markdownToAdf('`코드`');
    const para = adf.content[0];
    const node = para.content?.[0];
    expect(node?.marks).toEqual([{ type: 'code' }]);
  });

  it('list: - 항목1\\n- 항목2 → bulletList + listItem 2개', () => {
    const adf = markdownToAdf('- 항목1\n- 항목2');
    const bl = adf.content[0];
    expect(bl.type).toBe('bulletList');
    expect(bl.content?.length).toBe(2);
    expect(bl.content?.[0].type).toBe('listItem');
    expect(bl.content?.[1].type).toBe('listItem');
  });

  it('빈 markdown → doc with 빈 paragraph (깨지지 않음)', () => {
    const adf = markdownToAdf('');
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(adf.content.length).toBe(1);
    expect(adf.content[0].type).toBe('paragraph');
  });

  it('공백만 있는 markdown → 빈 paragraph', () => {
    const adf = markdownToAdf('   \n\n   ');
    expect(adf.content.length).toBe(1);
    expect(adf.content[0].type).toBe('paragraph');
  });
});

describe('buildIssueFields', () => {
  it('project/issuetype/summary/labels 를 구성하고 qa-companion 라벨 포함', () => {
    const fields = buildIssueFields({
      projectId: '10001', issueTypeId: '10002', summary: '제목',
      screenshot: null, descriptionMarkdown: '## 테스트\n\n내용',
    });
    expect(fields.project).toEqual({ id: '10001' });
    expect(fields.issuetype).toEqual({ id: '10002' });
    expect(fields.summary).toBe('제목');
    expect(fields.labels).toContain('qa-companion');
    expect(fields.description.type).toBe('doc');
  });

  it('descriptionMarkdown 의 내용이 ADF 에 반영됨', () => {
    const fields = buildIssueFields({
      projectId: '10001', issueTypeId: '10002', summary: '제목',
      screenshot: null,
      descriptionMarkdown: '## 환경\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
    });
    const json = JSON.stringify(fields.description);
    expect(json).toContain('"heading"');
    expect(json).toContain('"table"');
    expect(json).toContain('"A"');
  });
});
