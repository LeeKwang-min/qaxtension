import { CMD_SOURCE, isInjectEnvelope } from '../messaging';
import type { CmdEnvelope, RuntimeMessage } from '../messaging/types';

// MAIN world(inject) → background 로 중계
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  if (!isInjectEnvelope(ev.data)) return;
  const payload = ev.data.payload;

  if (payload.type === 'INJECT_READY') {
    // e2e 관측용 마킹
    document.documentElement.dataset.qaxtensionContent = 'ready';
    const msg: RuntimeMessage = { type: 'INJECT_READY' };
    void chrome.runtime.sendMessage(msg).catch(() => {});
  } else if (payload.type === 'PING_REPLY') {
    const msg: RuntimeMessage = { type: 'PING_REPLY', nonce: payload.nonce };
    void chrome.runtime.sendMessage(msg).catch(() => {});
  }
});

// background → MAIN world(inject) 명령 중계
chrome.runtime.onMessage.addListener((msg: RuntimeMessage) => {
  if (msg.type === 'PING') {
    const envelope: CmdEnvelope = { source: CMD_SOURCE, payload: { type: 'PING', nonce: msg.nonce } };
    window.postMessage(envelope, '*');
  }
});
