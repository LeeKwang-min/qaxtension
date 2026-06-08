import { describe, it, expect } from 'vitest';
import { suggestTitle, buildDescriptionADF, buildIssueFields } from '../src/integrations/jira/mapping';
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

describe('buildDescriptionADF', () => {
  it('doc/version 형태이며 실패 API 섹션을 포함', () => {
    const adf = buildDescriptionADF(emptyInput({ requests: [failReq()] }));
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    const json = JSON.stringify(adf);
    expect(json).toContain('실패한 API');
    expect(json).toContain('/login');
  });
  it('데이터 없으면 빈 안내 문단만', () => {
    const adf = buildDescriptionADF(emptyInput());
    expect(adf.content.length).toBeGreaterThan(0);
  });
});

describe('buildIssueFields', () => {
  it('project/issuetype/summary/labels 를 구성하고 qa-companion 라벨 포함', () => {
    const fields = buildIssueFields({
      projectId: '10001', issueTypeId: '10002', summary: '제목',
      screenshot: null, report: emptyInput(),
    });
    expect(fields.project).toEqual({ id: '10001' });
    expect(fields.issuetype).toEqual({ id: '10002' });
    expect(fields.summary).toBe('제목');
    expect(fields.labels).toContain('qa-companion');
    expect(fields.description.type).toBe('doc');
  });
});
