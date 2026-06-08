import { describe, it, expect } from 'vitest';
import { suggestTitle, buildDescriptionADF, buildIssueFields, isFailedRequest } from '../src/integrations/jira/mapping';
import type { ReportInput, RequestRecord, LogRecord, Step, ElementInfo } from '../src/messaging/types';

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

describe('buildDescriptionADF', () => {
  it('doc/version 형태이며 실패 API 섹션을 포함', () => {
    const adf = buildDescriptionADF(emptyInput({ requests: [failReq()] }));
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    const json = JSON.stringify(adf);
    expect(json).toContain('실패한 API');
    expect(json).toContain('/login');
  });

  it('데이터 없으면 fallback 안내 문단만', () => {
    const adf = buildDescriptionADF(emptyInput());
    expect(adf.content.length).toBeGreaterThan(0);
    expect(JSON.stringify(adf)).toContain('첨부된 분석 데이터가 없습니다');
  });

  it('steps/pickedElement/logs(error) 포함 시 각 섹션 제목이 ADF 에 존재', () => {
    const step: Step = {
      id: 's1', kind: 'click', selector: 'button#submit', label: '제출',
      value: null, context: null, nearby: [], at: 1000,
    };
    const element: ElementInfo = {
      tagName: 'BUTTON', id: 'submit', classList: [], selector: 'button#submit',
      domPath: null, text: '제출',
      colors: {
        color: { hex: '#000', alpha: 1 },
        backgroundColor: { hex: '#fff', alpha: 1 },
        borderColor: { hex: '#000', alpha: 1 },
      },
      typography: { fontFamily: 'sans-serif', fontSize: '14px', fontWeight: '400', lineHeight: '1.5', letterSpacing: '0' },
      boxModel: { width: '100px', height: '40px', margin: '0', padding: '8px', borderRadius: '4px', border: '1px solid' },
      accessibility: { contrast: null } as ElementInfo['accessibility'],
    } as unknown as ElementInfo;

    const adf = buildDescriptionADF(emptyInput({
      steps: [step],
      pickedElement: element,
      logs: [errLog('TypeError: cannot read')],
    }));
    const json = JSON.stringify(adf);
    expect(json).toContain('재현 절차');
    expect(json).toContain('검사한 요소');
    expect(json).toContain('콘솔 에러·경고');
  });

  it('webRequest-only 레코드(ok=null, status=500)가 "실패한 API" 섹션에 나타남 (회귀 방지)', () => {
    const adf = buildDescriptionADF(emptyInput({ requests: [webReqOnlyFailReq()] }));
    const json = JSON.stringify(adf);
    expect(json).toContain('실패한 API');
    expect(json).toContain('/data');
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
