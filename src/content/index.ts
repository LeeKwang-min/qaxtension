import { CMD_SOURCE, isInjectEnvelope } from '../messaging';
import type { CmdEnvelope, RuntimeMessage } from '../messaging/types';

// inject 에게 현재 readiness 를 다시 알려달라고 요청한다.
function requestResync(): void {
  const envelope: CmdEnvelope = { source: CMD_SOURCE, payload: { type: 'RESYNC' } };
  window.postMessage(envelope, '*');
}

// MAIN world(inject) → background 로 중계
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  if (!isInjectEnvelope(ev.data)) return;
  const payload = ev.data.payload;

  if (payload.type === 'INJECT_READY') {
    // e2e 관측용 마킹
    document.documentElement.dataset.qaxtensionContent = 'ready';
    const msg: RuntimeMessage = { type: 'INJECT_READY' };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (payload.type === 'PING_REPLY') {
    const msg: RuntimeMessage = { type: 'PING_REPLY', nonce: payload.nonce };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  }
});

// background → MAIN world(inject) 명령 중계
chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'PING') {
    const envelope: CmdEnvelope = { source: CMD_SOURCE, payload: { type: 'PING', nonce: msg.nonce } };
    window.postMessage(envelope, '*');
  } else if (msg.type === 'RESYNC') {
    // 패널이 SUBSCRIBE 할 때 background 가 보낸다 → inject 에게 재확인 요청
    requestResync();
  }
});

// 로드 시 inject 에게 현재 상태를 물어본다.
// inject 의 spontaneous INJECT_READY 와 함께 두 방향(누가 먼저 로드되든)을 모두 커버해
// document_start 로더 경합으로 최초 신호를 놓치는 문제를 보정한다.
requestResync();
