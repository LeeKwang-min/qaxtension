import { describe, it, expect } from 'vitest';
import {
  authHeader, testConnection, listProjects, listIssueTypes, createIssue,
} from '../src/integrations/jira/client';
import type { JiraConfig } from '../src/messaging/types';

const cfg: JiraConfig = { site: 'https://acme.atlassian.net', email: 'a@b.com', token: 't0ken' };

/** 호출 1건을 기록하고 지정 응답을 돌려주는 fake fetch */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fn, calls };
}

describe('authHeader', () => {
  it('Basic base64(email:token)', () => {
    expect(authHeader(cfg)).toBe('Basic ' + btoa('a@b.com:t0ken'));
  });
});

describe('testConnection', () => {
  it('200 이면 ok=true + displayName', async () => {
    const { fn, calls } = fakeFetch(200, { displayName: '홍길동' });
    const res = await testConnection(cfg, fn);
    expect(res.ok).toBe(true);
    expect(res.displayName).toBe('홍길동');
    expect(calls[0].url).toBe('https://acme.atlassian.net/rest/api/3/myself');
  });
  it('401 이면 ok=false', async () => {
    const { fn } = fakeFetch(401, {});
    expect((await testConnection(cfg, fn)).ok).toBe(false);
  });
});

describe('listProjects', () => {
  it('values 를 JiraProject[] 로 매핑', async () => {
    const { fn, calls } = fakeFetch(200, { values: [{ id: '1', key: 'QA', name: 'QA 프로젝트' }] });
    const projects = await listProjects(cfg, fn);
    expect(projects).toEqual([{ id: '1', key: 'QA', name: 'QA 프로젝트' }]);
    expect(calls[0].url).toContain('/rest/api/3/project/search');
  });
});

describe('listIssueTypes', () => {
  it('subtask 를 제외하고 매핑', async () => {
    const { fn } = fakeFetch(200, { issueTypes: [
      { id: '10', name: '버그', subtask: false },
      { id: '11', name: '하위작업', subtask: true },
    ]});
    expect(await listIssueTypes(cfg, '1', fn)).toEqual([{ id: '10', name: '버그' }]);
  });
});

describe('createIssue', () => {
  it('POST /issue 후 key·url 반환', async () => {
    const { fn, calls } = fakeFetch(201, { key: 'QA-7' });
    const res = await createIssue(cfg, { project: { id: '1' }, issuetype: { id: '10' }, summary: 's', description: { type: 'doc', version: 1, content: [] }, labels: [] }, fn);
    expect(res.key).toBe('QA-7');
    expect(res.url).toBe('https://acme.atlassian.net/browse/QA-7');
    expect(calls[0].init?.method).toBe('POST');
  });
});
