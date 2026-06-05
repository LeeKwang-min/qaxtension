import { useEffect, useRef, useState } from 'react';
import type { PortMessage, TabSessionState, TabId } from '../messaging/types';
import { InspectPanel } from './InspectPanel';
import { NetworkPanel } from './NetworkPanel';
import { ConsolePanel } from './ConsolePanel';
import { ReportPanel } from './ReportPanel';
import { AuditPanel } from './AuditPanel';

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
  const [runningAudit, setRunningAudit] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  // 재연결 버튼이 호출하는 함수 (effect 내부에서 주입). reinject=true 면 강제 재주입.
  const reconnectRef = useRef<(reinject: boolean) => void>(() => {});

  // env 가 갱신되면 수집 중 표시 해제
  useEffect(() => {
    setCollectingEnv(false);
  }, [state?.env?.collectedAt]);

  // audit 결과가 갱신되면 검사 중 표시 해제
  useEffect(() => {
    setRunningAudit(false);
  }, [state?.audit?.ranAt]);

  useEffect(() => {
    // `cancelled` 는 cleanup 이후 async .then() 이 실행되는 것을 막는다.
    let cancelled = false;

    // 현재 활성 탭에 (재)연결한다. 탭 전환·SW 재시작 시 재호출돼 패널이 항상
    // "지금 보고 있는 탭" 을 따라가도록 한다. reinject=true 면 content 강제 재주입.
    const connect = async (reinject: boolean): Promise<void> => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (cancelled || tab?.id == null) return;
      // 기존 포트 정리 (onDisconnect 가 상태를 비우지 않도록 ref 를 먼저 끊는다)
      const prev = portRef.current;
      portRef.current = null;
      prev?.disconnect();

      setTabId(tab.id);
      const port = chrome.runtime.connect({ name: 'qaxtension-panel' });
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
        // 우리가 교체한 옛 포트의 끊김이면 무시 (재연결 race 방지)
        if (portRef.current !== port) return;
        portRef.current = null;
        setState(null);
        setCapturing(false);
        setCollectingEnv(false);
        setRunningAudit(false);
      });
      port.postMessage({ type: 'SUBSCRIBE', tabId: tab.id } satisfies PortMessage);
      if (reinject) port.postMessage({ type: 'REINJECT', tabId: tab.id } satisfies PortMessage);
    };

    reconnectRef.current = (reinject: boolean) => void connect(reinject);
    void connect(false);

    // 활성 탭/창이 바뀌면 그 탭으로 자동 재구독 (껏다 켤 필요 없이 따라감)
    const onActivated = () => void connect(false);
    const onFocusChanged = (winId: number) => {
      if (winId !== chrome.windows.WINDOW_ID_NONE) void connect(false);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.windows.onFocusChanged.addListener(onFocusChanged);

    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.windows.onFocusChanged.removeListener(onFocusChanged);
      portRef.current?.disconnect();
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

  const toggleNetworkPause = () => {
    if (!portRef.current || tabId == null) return;
    portRef.current.postMessage({
      type: 'NETWORK_SET_PAUSED',
      tabId,
      paused: !(state?.networkPaused ?? false),
    } satisfies PortMessage);
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

  const runAudit = () => {
    if (!portRef.current || tabId == null) return;
    setRunningAudit(true);
    portRef.current.postMessage({ type: 'RUN_AUDIT', tabId } satisfies PortMessage);
  };

  const resizeWindow = (width: number, height: number) => {
    if (!portRef.current || tabId == null) return;
    portRef.current.postMessage({ type: 'RESIZE_WINDOW', tabId, width, height } satisfies PortMessage);
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
        <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={ping}>Ping</button>
          <button onClick={() => reconnectRef.current(true)} title="현재 탭에 다시 연결하고 검사 기능을 재주입합니다">
            재연결
          </button>
          {state?.lastPingNonce && (
            <span data-testid="pong" style={{ marginLeft: 2 }}>
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
            hovered={state?.hoveredElement ?? null}
            injectReady={state?.injectReady ?? false}
            onTogglePick={togglePick}
          />
        ) : active === '네트워크' ? (
          <NetworkPanel
            requests={state?.requests ?? []}
            injectReady={state?.injectReady ?? false}
            paused={state?.networkPaused ?? false}
            onClear={clearNetwork}
            onTogglePause={toggleNetworkPause}
          />
        ) : active === '콘솔' ? (
          <ConsolePanel
            logs={state?.logs ?? []}
            injectReady={state?.injectReady ?? false}
            onClear={clearConsole}
          />
        ) : active === '검증' ? (
          <AuditPanel
            audit={state?.audit ?? null}
            injectReady={state?.injectReady ?? false}
            running={runningAudit}
            onRunAudit={runAudit}
            onResize={resizeWindow}
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
