import { CMD_SOURCE, isInjectEnvelope } from '../messaging';
import type { CmdEnvelope, RuntimeMessage } from '../messaging/types';
import { createPicker } from '../inspect/picker';
import { buildElementInfo, type StyleLike } from '../inspect/element-info';
import { collectEnv } from '../report/env';
import { auditA11y, type ContrastStyle } from '../audit/a11y';
import { collectResources } from '../audit/links';
import { domChildren, elementByPath } from '../inspect/dom-tree';
import { createHighlighter } from '../inspect/highlighter';
import type { AuditRaw, StorageItem } from '../messaging/types';

const highlighter = createHighlighter();

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
    // 테두리가 없으면(폭 0 또는 none) 색이 무의미 → transparent 로 표기
    borderColor:
      c.borderTopStyle !== 'none' && parseFloat(c.borderTopWidth) > 0
        ? c.borderTopColor
        : 'transparent',
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

// 호버 통지 rAF 스로틀 상태
let pendingHover: Element | null = null;
let hoverRaf = 0;

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
  // onHover: 호버 요소 정보를 실시간 전달 (rAF 로 프레임당 1회로 묶음)
  (el) => {
    pendingHover = el;
    if (hoverRaf !== 0) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const target = pendingHover;
      pendingHover = null;
      if (!target || !target.isConnected) return;
      let info;
      try {
        info = buildElementInfo(target, styleOf(target));
      } catch {
        return;
      }
      const msg: RuntimeMessage = { type: 'ELEMENT_HOVERED', info };
      void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
        console.debug('[qaxtension] content sendMessage failed:', e);
      });
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
  } else if (payload.type === 'NET_START') {
    const msg: RuntimeMessage = { type: 'NET_START', record: payload.record };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (payload.type === 'NET_END') {
    const msg: RuntimeMessage = { type: 'NET_END', id: payload.id, end: payload.end };
    void chrome.runtime.sendMessage(msg).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (payload.type === 'LOG') {
    const msg: RuntimeMessage = { type: 'LOG', event: payload.event };
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
  } else if (msg.type === 'COLLECT_ENV') {
    let env;
    try {
      env = collectEnv(Date.now());
    } catch (e) {
      console.debug('[qaxtension] collectEnv failed:', e);
      return;
    }
    const reply: RuntimeMessage = { type: 'ENV_RESULT', env };
    void chrome.runtime.sendMessage(reply).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (msg.type === 'RUN_AUDIT') {
    let raw: AuditRaw;
    try {
      raw = collectAuditRaw(Date.now());
    } catch (e) {
      console.debug('[qaxtension] collectAuditRaw failed:', e);
      return;
    }
    const reply: RuntimeMessage = { type: 'AUDIT_RESULT', raw };
    void chrome.runtime.sendMessage(reply).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (msg.type === 'DOM_CHILDREN') {
    let nodes;
    try {
      nodes = domChildren(document.body, msg.path);
    } catch (e) {
      console.debug('[qaxtension] domChildren failed:', e);
      return;
    }
    const reply: RuntimeMessage = { type: 'DOM_CHILDREN_RESULT', path: msg.path, nodes };
    void chrome.runtime.sendMessage(reply).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (msg.type === 'INSPECT_PATH') {
    const el = elementByPath(document.body, msg.path);
    if (!el) return;
    let info;
    try {
      info = buildElementInfo(el, styleOf(el));
    } catch (e) {
      console.debug('[qaxtension] inspect-by-path failed:', e);
      return;
    }
    document.documentElement.dataset.qaxtensionPicked = info.selector;
    const reply: RuntimeMessage = { type: 'ELEMENT_PICKED', info };
    void chrome.runtime.sendMessage(reply).catch((e: unknown) => {
      console.debug('[qaxtension] content sendMessage failed:', e);
    });
  } else if (msg.type === 'HIGHLIGHT_PATH') {
    if (msg.path === null) {
      highlighter.hide();
      return;
    }
    const el = elementByPath(document.body, msg.path);
    if (el) highlighter.show(el);
    else highlighter.hide();
  }
});

// ── 자동 검증 수집 (페이지 컨텍스트) ───────────────────────────
function contrastStyleOf(el: Element): ContrastStyle {
  const c = getComputedStyle(el);
  return {
    color: c.color,
    backgroundColor: c.backgroundColor,
    fontSize: c.fontSize,
    fontWeight: c.fontWeight,
  };
}

function readLocalStorage(): StorageItem[] {
  const out: StorageItem[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key == null) continue;
      // 마스킹은 background(audit/storage)에서 일괄 적용 — 여기선 원시값만 전달
      out.push({ key, value: localStorage.getItem(key) ?? '', masked: false });
    }
  } catch {
    // SecurityError 등 best-effort
  }
  return out;
}

/** a11y·리소스·localStorage 를 한 번에 수집 (쿠키/링크검증은 background) */
function collectAuditRaw(now: number): AuditRaw {
  return {
    a11y: auditA11y(document, contrastStyleOf),
    resources: collectResources(document),
    local: readLocalStorage(),
    ranAt: now,
  };
}

// 로드 시 inject 에게 현재 상태를 물어본다.
// inject 의 spontaneous INJECT_READY 와 함께 두 방향(누가 먼저 로드되든)을 모두 커버해
// document_start 로더 경합으로 최초 신호를 놓치는 문제를 보정한다.
requestResync();
