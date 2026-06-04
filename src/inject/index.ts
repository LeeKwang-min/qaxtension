import { INJECT_SOURCE, CMD_SOURCE } from '../messaging';
import type { InjectEnvelope, CmdEnvelope } from '../messaging/types';

// e2e 관측용 플래그 (호스트 페이지에 부수효과 최소)
(window as unknown as { __qaxtensionInjectReady?: boolean }).__qaxtensionInjectReady = true;

function post(payload: InjectEnvelope['payload']): void {
  const envelope: InjectEnvelope = { source: INJECT_SOURCE, payload };
  try {
    window.postMessage(envelope, '*');
  } catch {
    // 페이지를 절대 깨뜨리지 않는다 (fail-open)
  }
}

// 준비 신호 발신
post({ type: 'INJECT_READY' });

// content → inject 명령(PING) 수신 후 응답
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as CmdEnvelope | null;
  if (!data || data.source !== CMD_SOURCE) return;
  if (data.payload.type === 'PING') {
    post({ type: 'PING_REPLY', nonce: data.payload.nonce });
  }
});
