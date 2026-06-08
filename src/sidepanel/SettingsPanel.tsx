import { useEffect, useState } from 'react';
import type { JiraConfig } from '../messaging/types';
import { loadSettings, saveSettings } from '../integrations/jira/settings';

interface Props {
  onBack: () => void;
  /** 연결 테스트 요청 — background 로 JIRA_TEST 전송. 결과는 testResult prop 으로 받음 */
  onTest: (config: JiraConfig) => void;
  testResult: { ok: boolean; displayName?: string; error?: string } | null;
  testing: boolean;
}

export function SettingsPanel({ onBack, onTest, testResult, testing }: Props) {
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  // token は設定 UI 특성상 패널 state 및 JIRA_TEST PortMessage 에 존재하나,
  // 이는 모두 확장 프로그램 내부(패널↔background IPC)이며 외부 웹페이지/content script
  // 에는 노출되지 않는다. 실제 JIRA HTTP 호출은 background 에서만 수행된다.
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadSettings().then((cfg) => {
      if (cfg) { setSite(cfg.site); setEmail(cfg.email); setToken(cfg.token); }
    });
  }, []);

  const normalizedSite = site.trim().replace(/\/+$/, '');
  const config: JiraConfig = { site: normalizedSite, email: email.trim(), token: token.trim() };
  const filled = config.site && config.email && config.token;

  const save = () => {
    void saveSettings(config).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); });
  };

  return (
    <div className="app">
      <header className="app-header">
        <button onClick={onBack}>← 뒤로</button>
        {/* marginTop: 8 — "← 뒤로" 버튼과의 수직 간격 */}
        <div className="app-title" style={{ marginTop: 8 }}>⚙️ 설정</div>
      </header>
      <section style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 12 }}>JIRA 연결</h3>
        <p style={{ fontSize: 11, color: 'var(--fg-subtle)', margin: '4px 0 8px' }}>
          API 토큰은{' '}
          <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">
            Atlassian 계정 설정
          </a>
          에서 발급합니다.
        </p>
        <label style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>
          사이트
          <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://회사.atlassian.net"
            style={{ width: '100%', marginTop: 2 }} />
        </label>
        <label style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>
          이메일
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
            style={{ width: '100%', marginTop: 2 }} />
        </label>
        <label style={{ display: 'block', fontSize: 11, marginBottom: 8 }}>
          API 토큰
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="토큰 붙여넣기"
            style={{ width: '100%', marginTop: 2 }} />
        </label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => onTest(config)} disabled={!filled || testing}>
            {testing ? '확인 중…' : '연결 테스트'}
          </button>
          <button onClick={save} disabled={!filled}>{saved ? '저장됨 ✓' : '저장'}</button>
        </div>
        {testResult && (
          <p style={{ fontSize: 11, marginTop: 6, color: testResult.ok ? 'var(--success)' : 'var(--danger)' }}>
            {testResult.ok ? `🟢 연결됨${testResult.displayName ? ` — ${testResult.displayName}` : ''}` : `🔴 실패: ${testResult.error ?? '인증 확인'}`}
          </p>
        )}
      </section>
    </div>
  );
}
