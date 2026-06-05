import { CMD_SOURCE, isInjectEnvelope } from '../messaging';
import type { CmdEnvelope, RuntimeMessage } from '../messaging/types';
import { createPicker } from '../inspect/picker';
import { buildElementInfo, type StyleLike } from '../inspect/element-info';

// inject 에게 현재 readiness 를 다시 알려달라고 요청한다.
function requestResync(): void {
  const envelope: CmdEnvelope = { source: CMD_SOURCE, payload: { type: 'RESYNC' } };
  window.postMessage(envelope, '*');
}

// ── 요소 피커 ──────────────────────────────────────────────
function styleOf(el: Element): StyleLike {
  const c = getComputedStyle(el);
  return {
    color: c.color,
    backgroundColor: c.backgroundColor,
    borderColor: c.borderTopColor, // borderColor 단축은 빈 문자열일 수 있어 top 으로 대체
    fontFamily: c.fontFamily,
    fontSize: c.fontSize,
    fontWeight: c.fontWeight,
    lineHeight: c.lineHeight,
    letterSpacing: c.letterSpacing,
    width: c.width,
    height: c.height,
    margin: `${c.marginTop} ${c.marginRight} ${c.marginBottom} ${c.marginLeft}`,
    padding: `${c.paddingTop} ${c.paddingRight} ${c.paddingBottom} ${c.paddingLeft}`,
    borderRadius: `${c.borderTopLeftRadius} ${c.borderTopRightRadius} ${c.borderBottomRightRadius} ${c.borderBottomLeftRadius}`,
    border: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`,
  };
}

const picker = createPicker(
  (el) => {
    const info = buildElementInfo(el, styleOf(el));
    // e2e 관측용 마킹
    document.documentElement.dataset.qaxtensionPicked = info.selector;
    const msg: RuntimeMessage = { type: 'ELEMENT_PICKED', info };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  },
  () => {
    delete document.documentElement.dataset.qaxtensionPicked;
    const msg: RuntimeMessage = { type: 'PICK_CANCELLED' };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  },
);

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

// background → MAIN world(inject) 명령 중계 + 피커 제어
chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'PING') {
    const envelope: CmdEnvelope = { source: CMD_SOURCE, payload: { type: 'PING', nonce: msg.nonce } };
    window.postMessage(envelope, '*');
  } else if (msg.type === 'RESYNC') {
    // 패널이 SUBSCRIBE 할 때 background 가 보낸다 → inject 에게 재확인 요청
    requestResync();
  } else if (msg.type === 'PICK_START') {
    delete document.documentElement.dataset.qaxtensionPicked;
    picker.start();
  } else if (msg.type === 'PICK_STOP') {
    picker.stop();
  }
});

// 로드 시 inject 에게 현재 상태를 물어본다.
// inject 의 spontaneous INJECT_READY 와 함께 두 방향(누가 먼저 로드되든)을 모두 커버해
// document_start 로더 경합으로 최초 신호를 놓치는 문제를 보정한다.
requestResync();
