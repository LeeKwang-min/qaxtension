import type { JiraConfig, JiraProject, JiraIssueType } from '../../messaging/types';
import type { JiraFields } from './mapping';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Basic 인증 헤더를 생성한다. */
export function authHeader(cfg: JiraConfig): string {
  return 'Basic ' + btoa(`${cfg.email}:${cfg.token}`);
}

/** Authorization·Accept·Content-Type 헤더를 조합한다. */
function jsonHeaders(cfg: JiraConfig): Record<string, string> {
  return { Authorization: authHeader(cfg), Accept: 'application/json', 'Content-Type': 'application/json' };
}

/** 끝 슬래시를 제거한 base URL */
function base(cfg: JiraConfig): string {
  return cfg.site.replace(/\/+$/, '');
}

/**
 * JIRA REST API /myself 로 연결을 테스트한다.
 * 200 이면 ok=true + displayName 반환, 그 외엔 ok=false.
 */
export async function testConnection(
  cfg: JiraConfig, fetchFn: FetchLike = fetch,
): Promise<{ ok: boolean; displayName?: string }> {
  const res = await fetchFn(`${base(cfg)}/rest/api/3/myself`, { headers: jsonHeaders(cfg) });
  if (!res.ok) return { ok: false };
  const body = (await res.json()) as { displayName?: string };
  return { ok: true, displayName: body.displayName };
}

/**
 * 접근 가능한 프로젝트 목록을 조회해 JiraProject[] 로 반환한다.
 * maxResults=50 고정.
 */
export async function listProjects(cfg: JiraConfig, fetchFn: FetchLike = fetch): Promise<JiraProject[]> {
  const res = await fetchFn(`${base(cfg)}/rest/api/3/project/search?maxResults=50`, { headers: jsonHeaders(cfg) });
  if (!res.ok) throw new Error(`프로젝트 조회 실패 (${res.status})`);
  const body = (await res.json()) as { values: JiraProject[] };
  return body.values.map((p) => ({ id: p.id, key: p.key, name: p.name }));
}

/**
 * 지정 프로젝트의 이슈 타입 목록을 조회한다.
 * subtask 는 제외하고 반환한다.
 */
export async function listIssueTypes(cfg: JiraConfig, projectId: string, fetchFn: FetchLike = fetch): Promise<JiraIssueType[]> {
  const res = await fetchFn(`${base(cfg)}/rest/api/3/project/${projectId}`, { headers: jsonHeaders(cfg) });
  if (!res.ok) throw new Error(`이슈타입 조회 실패 (${res.status})`);
  const body = (await res.json()) as { issueTypes?: { id: string; name: string; subtask: boolean }[] };
  return (body.issueTypes ?? []).filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name }));
}

/**
 * JIRA 이슈를 생성한다.
 * 성공 시 이슈 key 와 브라우저 접근 URL 을 반환한다.
 */
export async function createIssue(
  cfg: JiraConfig, fields: JiraFields, fetchFn: FetchLike = fetch,
): Promise<{ key: string; url: string }> {
  const res = await fetchFn(`${base(cfg)}/rest/api/3/issue`, {
    method: 'POST', headers: jsonHeaders(cfg), body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`이슈 생성 실패 (${res.status}) ${t.slice(0, 200)}`);
  }
  const body = (await res.json()) as { key: string };
  return { key: body.key, url: `${base(cfg)}/browse/${body.key}` };
}

/** dataURL 을 Blob 으로 변환한다 (첨부 파일 업로드용). */
function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * 지정 이슈에 스크린샷을 첨부한다.
 * dataURL → Blob 변환 후 multipart/form-data 로 POST.
 * 성공 여부를 boolean 으로 반환한다.
 */
export async function attachScreenshot(
  cfg: JiraConfig, issueKey: string, dataUrl: string, fetchFn: FetchLike = fetch,
): Promise<boolean> {
  const form = new FormData();
  form.append('file', dataUrlToBlob(dataUrl), 'screenshot.png');
  const res = await fetchFn(`${base(cfg)}/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: { Authorization: authHeader(cfg), 'X-Atlassian-Token': 'no-check' },
    body: form,
  });
  return res.ok;
}
