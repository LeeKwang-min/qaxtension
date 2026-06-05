import { useEffect, useRef, useState } from 'react';
import type { PortMessage, TabSessionState, TabId } from '../messaging/types';
import { InspectPanel } from './InspectPanel';
import { NetworkPanel } from './NetworkPanel';
import { ConsolePanel } from './ConsolePanel';
import { ReportPanel } from './ReportPanel';

const PANEL_TABS = ['검사', '네트워크', '콘솔', '검증', '기록', '리포트'] as const;
type PanelTab = (typeof PANEL_TABS)[number];

export function App() {
  const [state, setState] = useState<TabSessionState | null>(null);
  const [active, setActive] = useState<PanelTab>('검사');
  const [tabId, setTabId] = useState<TabId | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [collectingEnv, setCollectingEnv] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  // env 가 갱신되면 수집 중 표시 해제
  useEffect(() => {
    setCollectingEnv(false);
  }, [state?.env?.collectedAt]);

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
        else if (msg.type === 'SCREENSHOT_RESULT') {
          setCapturing(false);
          setScreenshotError(msg.error ?? null);
          if (msg.dataUrl) setScreenshot(msg.dataUrl);
        }
      });
      port.onDisconnect.addListener(() => {
        // 서비스 워커가 종료/재시작되면 포트가 끊긴다 → 연결 끊김을 정직하게 표시
        portRef.current = null;
        setState(null);
        setCapturing(false);
        setCollectingEnv(false);
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

  const clearNetwork = () => {
    if (!portRef.current || tabId == null) return;
    portRef.current.postMessage({ type: 'NETWORK_CLEAR', tabId } satisfies PortMessage);
  };

  const clearConsole = () => {
    if (!portRef.current || tabId == null) return;
    portRef.current.postMessage({ type: 'CONSOLE_CLEAR', tabId } satisfies PortMessage);
  };

  const captureScreenshot = () => {
    if (!portRef.current || tabId == null) return;
    setScreenshotError(null);
    setCapturing(true);
    portRef.current.postMessage({ type: 'CAPTURE_SCREENSHOT', tabId } satisfies PortMessage);
  };

  const collectEnv = () => {
    if (!portRef.current || tabId == null) return;
    setCollectingEnv(true);
    portRef.current.postMessage({ type: 'COLLECT_ENV', tabId } satisfies PortMessage);
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
        ) : active === '네트워크' ? (
          <NetworkPanel
            requests={state?.requests ?? []}
            injectReady={state?.injectReady ?? false}
            onClear={clearNetwork}
          />
        ) : active === '콘솔' ? (
          <ConsolePanel
            logs={state?.logs ?? []}
            injectReady={state?.injectReady ?? false}
            onClear={clearConsole}
          />
        ) : active === '리포트' ? (
          <ReportPanel
            env={state?.env ?? null}
            requests={state?.requests ?? []}
            logs={state?.logs ?? []}
            pickedElement={state?.pickedElement ?? null}
            screenshot={screenshot}
            screenshotError={screenshotError}
            capturing={capturing}
            collectingEnv={collectingEnv}
            onCaptureScreenshot={captureScreenshot}
            onCollectEnv={collectEnv}
          />
        ) : (
          <p style={{ color: '#999' }}>{active} 패널 — 이후 Phase에서 구현</p>
        )}
      </main>
    </div>
  );
}
