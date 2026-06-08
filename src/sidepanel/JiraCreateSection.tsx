import { useEffect, useState } from 'react';
import type { JiraProject, JiraIssueType, JiraIssueResult, ReportInput } from '../messaging/types';
import { suggestTitle } from '../integrations/jira/mapping';

interface Props {
  report: ReportInput;
  screenshot: string | null;
  projects: JiraProject[];
  issueTypes: JiraIssueType[];
  result: JiraIssueResult | null;
  error: string | null;
  busy: boolean;
  onLoadProjects: () => void;
  onSelectProject: (projectId: string) => void;
  onCreate: (projectId: string, issueTypeId: string, summary: string, screenshot: string | null) => void;
}

export function JiraCreateSection(props: Props) {
  const { report, projects, issueTypes, result, error, busy } = props;
  const [projectId, setProjectId] = useState('');
  const [issueTypeId, setIssueTypeId] = useState('');
  const [summary, setSummary] = useState('');

  // 섹션이 열리면 프로젝트 로드 + 제목 자동 제안
  useEffect(() => { props.onLoadProjects(); setSummary(suggestTitle(report)); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (projectId) { props.onSelectProject(projectId); setIssueTypeId(''); } /* eslint-disable-next-line */ }, [projectId]);

  return (
    <section style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <h3 style={{ fontSize: 12, margin: '0 0 6px' }}>🎫 JIRA 티켓 생성</h3>

      <label style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>
        프로젝트
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ width: '100%', marginTop: 2 }}>
          <option value="">선택…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.key})</option>)}
        </select>
      </label>

      <label style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>
        이슈 타입
        <select value={issueTypeId} onChange={(e) => setIssueTypeId(e.target.value)} disabled={!projectId} style={{ width: '100%', marginTop: 2 }}>
          <option value="">선택…</option>
          {issueTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>

      <label style={{ display: 'block', fontSize: 11, marginBottom: 8 }}>
        제목
        <input value={summary} onChange={(e) => setSummary(e.target.value)} style={{ width: '100%', marginTop: 2 }} />
      </label>

      <button
        type="button"
        disabled={!projectId || !issueTypeId || !summary || busy}
        onClick={() => props.onCreate(projectId, issueTypeId, summary, props.screenshot)}
        style={{ fontWeight: 700 }}
      >
        {busy ? '생성 중…' : '티켓 생성'}
      </button>

      {result && (
        <p style={{ fontSize: 11, marginTop: 6, color: 'var(--success)' }}>
          ✅ 생성됨: <a href={result.url} target="_blank" rel="noreferrer">{result.key}</a>
          {result.screenshotAttached ? ' · 스크린샷 첨부됨' : ''}
        </p>
      )}
      {error && <p style={{ fontSize: 11, marginTop: 6, color: 'var(--danger)' }}>🔴 {error}</p>}
    </section>
  );
}
