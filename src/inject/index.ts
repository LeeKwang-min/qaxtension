import { INJECT_SOURCE, isCmdEnvelope } from '../messaging';
import type { InjectEnvelope } from '../messaging/types';

type InjectWindow = Window & { __qaxtensionInjectReady?: boolean };
const w = window as InjectWindow;

// 중복 주입 방지 (멱등) — 같은 프레임에서 두 번 실행돼도 한 번만 동작
if (!w.__qaxtensionInjectReady) {
  w.__qaxtensionInjectReady = true;

  const post = (payload: InjectEnvelope['payload']): void => {
    const envelope: InjectEnvelope = { source: INJECT_SOURCE, payload };
    try {
      window.postMessage(envelope, '*');
    } catch {
      // 페이지를 절대 깨뜨리지 않는다 (fail-open)
    }
  };

  // 준비 신호 발신
  post({ type: 'INJECT_READY' });

  // content → inject 명령 수신 후 응답.
  // isCmdEnvelope 가드가 payload 존재까지 검증하므로 raw cast 의 throw 경로를 차단한다.
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return;
    if (!isCmdEnvelope(ev.data)) return;
    const payload = ev.data.payload;
    if (payload.type === 'PING') {
      post({ type: 'PING_REPLY', nonce: payload.nonce });
    } else if (payload.type === 'RESYNC') {
      // 늦게 진입한 소비자(패널/재시작된 SW)를 위해 readiness 를 재발신한다.
      post({ type: 'INJECT_READY' });
    }
  });
}
