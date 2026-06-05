import { useEffect, useRef, useState } from 'react';
import type { PortMessage, TabSessionState, TabId } from '../messaging/types';
import { InspectPanel } from './InspectPanel';

const PANEL_TABS = ['검사', '네트워크', '콘솔', '검증', '기록', '리포트'] as const;
type PanelTab = (typeof PANEL_TABS)[number];

export function App() {
  const [state, setState] = useState<TabSessionState | null>(null);
  const [active, setActive] = useState<PanelTab>('검사');
  const [tabId, setTabId] = useState<TabId | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    // `cancelled` 는 cleanup 이후 async .then() 이 실행되는 것을 막는다.
    // React 18 StrictMode 에선 dev 에서 effect/cleanup 가 두 번 도는데,
    // 이 플래그가 첫 .then() 해석을 no-op 으로 만든다.
    let cancelled = false;
    let port: chrome.runtime.Port | undefined;

    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (cancelled || tab?.id == null) return;
      setTabId(tab.id);
      port = chrome.runtime.connect({ name: 'qaxtension-panel' });
      portRef.current = port;
      port.onMessage.addListener((msg: PortMessage) => {
        if (msg.type === 'STATE_UPDATE') setState(msg.state);
      });
      port.onDisconnect.addListener(() => {
        // 서비스 워커가 종료/재시작되면 포트가 끊긴다 → 연결 끊김을 정직하게 표시
        portRef.current = null;
        setState(null);
      });
      port.postMessage({ type: 'SUBSCRIBE', tabId: tab.id } satisfies PortMessage);
    });

    return () => {
      cancelled = true;
      port?.disconnect();
      portRef.current = null;
    };
  }, []);

  const ping = () => {
    if (portRef.current && tabId != null) {
      portRef.current.postMessage({ type: 'PING', tabId } satisfies PortMessage);
    }
  };

  const togglePick = () => {
    if (!portRef.current || tabId == null) return;
    const type = state?.picking ? 'PICK_STOP' : 'PICK_START';
    portRef.current.postMessage({ type, tabId } satisfies PortMessage);
  };

  return (
    <div style={{ font: '13px system-ui', padding: 12 }}>
      <header style={{ marginBottom: 12 }}>
        <strong>QA Companion</strong>
        <div
          data-testid="status"
          style={{ marginTop: 4, color: state?.injectReady ? 'green' : '#999' }}
        >
          {state?.injectReady ? '주입됨 ✓' : '대기 중… (연결되지 않으면 페이지를 새로고침하세요)'}
        </div>
        <div style={{ fontSize: 11, color: '#666', wordBreak: 'break-all' }}>
          {state?.url ?? ''}
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={ping}>Ping</button>
          {state?.lastPingNonce && (
            <span data-testid="pong" style={{ marginLeft: 8 }}>
              pong: {state.lastPingNonce}
            </span>
          )}
        </div>
      </header>

      <nav style={{ display: 'flex', gap: 4, borderBottom: '1px solid #eee', marginBottom: 8 }}>
        {PANEL_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setActive(t)}
            style={{ fontWeight: active === t ? 700 : 400 }}
          >
            {t}
          </button>
        ))}
      </nav>

      <main>
        {active === '검사' ? (
          <InspectPanel
            picking={state?.picking ?? false}
            picked={state?.pickedElement ?? null}
            injectReady={state?.injectReady ?? false}
            onTogglePick={togglePick}
          />
        ) : (
          <p style={{ color: '#999' }}>{active} 패널 — 이후 Phase에서 구현</p>
        )}
      </main>
    </div>
  );
}
