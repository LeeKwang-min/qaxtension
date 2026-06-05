import { INJECT_SOURCE, isCmdEnvelope } from '../messaging';
import type { InjectEnvelope, NetStart, NetEnd, LogEvent, LogLevel } from '../messaging/types';
import { captureBody } from '../capture/network';
import { serializeArgs } from '../capture/console';
import { normalizePerfEntry, type PerfEntryLike } from '../capture/perf';

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

  // ── 네트워크 캡처 (fetch / XHR) ───────────────────────────
  // 모든 후킹은 try/catch 로 감싸 페이지를 절대 깨뜨리지 않는다(fail-open).
  let netSeq = 0;
  const nextNetId = (): string => {
    netSeq += 1;
    return `net-${Date.now().toString(36)}-${netSeq}`;
  };
  const postStart = (record: NetStart): void => post({ type: 'NET_START', record });
  const postEnd = (id: string, end: NetEnd): void => post({ type: 'NET_END', id, end });
  // 상대 경로(예: '/api/x')를 현재 문서 기준 절대 URL 로 정규화한다.
  // background 는 페이지 location 이 없어 호스트 그룹핑이 안 되므로 여기서 해결한다.
  // 정규화 실패 시 원본을 그대로 반환(fail-open).
  const absUrl = (u: string): string => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return u;
    }
  };

  // fetch 후킹 — 원본 보존
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (
        this: typeof window,
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const id = nextNetId();
        const startedAt = Date.now();
        let method = 'GET';
        let url = '';
        let requestBody = null as ReturnType<typeof captureBody>;
        try {
          if (input instanceof Request) {
            method = (init?.method ?? input.method ?? 'GET').toUpperCase();
            url = absUrl(input.url);
          } else {
            method = (init?.method ?? 'GET').toUpperCase();
            url = absUrl(String(input));
          }
          const body = init?.body;
          if (typeof body === 'string') requestBody = captureBody(body, null);
          else if (body instanceof URLSearchParams)
            requestBody = captureBody(body.toString(), 'application/x-www-form-urlencoded');
        } catch {
          /* fail-open: 메타 추출 실패해도 호출은 진행 */
        }
        try {
          postStart({ id, source: 'fetch', method, url, startedAt, requestBody });
        } catch {
          /* 발신 실패 무시 */
        }
        let p: Promise<Response>;
        try {
          p = origFetch.call(this, input as RequestInfo, init);
        } catch (e) {
          try {
            postEnd(id, { error: String(e), durationMs: Date.now() - startedAt });
          } catch {
            /* 무시 */
          }
          throw e;
        }
        return p.then(
          (response) => {
            // 응답 본문은 clone 으로 읽어 원본 스트림을 소비하지 않는다.
            // 단, 스트림(SSE)·바이너리·대용량 응답은 본문을 읽지 않는다(XHR 와 동일하게 보수적).
            try {
              const ct = response.headers.get('content-type') || '';
              const lenHeader = response.headers.get('content-length');
              const len = lenHeader ? Number(lenHeader) : null;
              const skipBody =
                /event-stream|octet-stream|^image\/|^video\/|^audio\//i.test(ct) ||
                (len != null && len > 1_000_000);
              if (skipBody) {
                // 본문을 읽지 않고 즉시 상태/타이밍만 보낸다 (SSE 가 영원히 pending 되는 문제 방지)
                try {
                  postEnd(id, {
                    status: response.status,
                    statusText: response.statusText,
                    ok: response.ok,
                    durationMs: Date.now() - startedAt,
                    responseBody: null,
                  });
                } catch {
                  /* 무시 */
                }
                return response;
              }
              response
                .clone()
                .text()
                .then((text) => {
                  try {
                    postEnd(id, {
                      status: response.status,
                      statusText: response.statusText,
                      ok: response.ok,
                      durationMs: Date.now() - startedAt,
                      responseBody: captureBody(text, ct),
                    });
                  } catch {
                    /* 무시 */
                  }
                })
                .catch(() => {
                  // 본문 못 읽어도 상태/타이밍은 보낸다
                  try {
                    postEnd(id, {
                      status: response.status,
                      statusText: response.statusText,
                      ok: response.ok,
                      durationMs: Date.now() - startedAt,
                      responseBody: null,
                    });
                  } catch {
                    /* 무시 */
                  }
                });
            } catch {
              // 가드 로직 자체가 던져도 상태/타이밍은 본문 없이 보내려 시도한다 (fail-open)
              try {
                postEnd(id, {
                  status: response.status,
                  statusText: response.statusText,
                  ok: response.ok,
                  durationMs: Date.now() - startedAt,
                  responseBody: null,
                });
              } catch {
                /* 무시 */
              }
            }
            return response;
          },
          (err) => {
            try {
              postEnd(id, { error: String(err), durationMs: Date.now() - startedAt });
            } catch {
              /* 무시 */
            }
            throw err;
          },
        );
      } as typeof window.fetch;
    }
  } catch {
    /* fetch 후킹 실패 — 페이지 영향 없음 */
  }

  // XHR 후킹 — open/send 오버라이드
  try {
    interface QaxXhr extends XMLHttpRequest {
      __qaxNet?: { id: string; method: string; url: string; startedAt: number };
    }
    const proto = XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;

    proto.open = function (
      this: QaxXhr,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ): void {
      try {
        this.__qaxNet = {
          id: nextNetId(),
          method: String(method).toUpperCase(),
          url: absUrl(String(url)),
          startedAt: 0,
        };
      } catch {
        /* 무시 */
      }
      // 가변 인자 시그니처를 보존해 그대로 전달
      return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof proto.open;

    proto.send = function (this: QaxXhr, body?: Document | XMLHttpRequestBodyInit | null): void {
      const meta = this.__qaxNet;
      if (meta) {
        meta.startedAt = Date.now();
        let requestBody = null as ReturnType<typeof captureBody>;
        try {
          if (typeof body === 'string') requestBody = captureBody(body, null);
          else if (body instanceof URLSearchParams)
            requestBody = captureBody(body.toString(), 'application/x-www-form-urlencoded');
        } catch {
          /* 무시 */
        }
        try {
          postStart({
            id: meta.id,
            source: 'xhr',
            method: meta.method,
            url: meta.url,
            startedAt: meta.startedAt,
            requestBody,
          });
        } catch {
          /* 무시 */
        }
        try {
          this.addEventListener('loadend', () => {
            try {
              const status = this.status;
              const durationMs = Date.now() - meta.startedAt;
              if (status === 0) {
                // status 0 = 네트워크 오류 또는 CORS 차단
                postEnd(meta.id, { error: 'network error or CORS', durationMs });
                return;
              }
              let responseBody = null as ReturnType<typeof captureBody>;
              try {
                if (this.responseType === '' || this.responseType === 'text') {
                  responseBody = captureBody(this.responseText, this.getResponseHeader('content-type'));
                }
              } catch {
                /* 본문 못 읽어도 상태는 보냄 */
              }
              postEnd(meta.id, {
                status,
                statusText: this.statusText,
                ok: status >= 200 && status < 400,
                durationMs,
                responseBody,
              });
            } catch {
              /* 무시 */
            }
          }, { once: true });
        } catch {
          /* 무시 */
        }
      }
      return (origSend as (b?: Document | XMLHttpRequestBodyInit | null) => void).call(this, body);
    } as typeof proto.send;
  } catch {
    /* XHR 후킹 실패 — 페이지 영향 없음 */
  }

  // ── 리소스(이미지) 로딩 성능 (ResourceTiming) ─────────────
  // 이미지가 느린 원인이 서버 응답 대기(TTFB)인지 전송(다운로드)인지 구분하도록
  // PerformanceObserver 로 'img' 리소스 타이밍을 수집한다.
  try {
    let perfSeq = 0;
    const nextPerfId = (): string => {
      perfSeq += 1;
      return `perf-${Date.now().toString(36)}-${perfSeq}`;
    };
    const handlePerf = (entries: PerformanceEntryList): void => {
      for (const e of entries) {
        try {
          const r = e as PerformanceResourceTiming;
          if (r.entryType !== 'resource' || r.initiatorType !== 'img') continue;
          const resource = normalizePerfEntry(r as unknown as PerfEntryLike, performance.timeOrigin, nextPerfId());
          post({ type: 'PERF_RESOURCE', resource });
        } catch {
          /* 항목 하나 실패해도 나머지 진행 */
        }
      }
    };
    const po = new PerformanceObserver((list) => handlePerf(list.getEntries()));
    // buffered: 관찰 시작 전 이미 로드된 이미지도 포함
    po.observe({ type: 'resource', buffered: true });
  } catch {
    /* PerformanceObserver 미지원/실패 — 페이지 영향 없음 */
  }

  // ── 콘솔/에러 캡처 ────────────────────────────────────────
  // console.error/warn·런타임 에러·미처리 프로미스 거부를 포착.
  // 모든 후킹은 try/catch + 원본 호출 보존으로 페이지를 절대 깨뜨리지 않는다.
  const postLog = (event: LogEvent): void => {
    try {
      post({ type: 'LOG', event });
    } catch {
      /* 발신 실패 무시 */
    }
  };
  // 인자 중 첫 Error 의 스택을 추출(있으면)
  const stackOf = (args: unknown[]): string | null => {
    for (const a of args) {
      if (a instanceof Error && typeof a.stack === 'string') return a.stack;
    }
    return null;
  };

  // console.error / console.warn 오버라이드 — 원본 보존
  try {
    const hook = (level: LogLevel, orig: (...a: unknown[]) => void) =>
      function (this: unknown, ...args: unknown[]): void {
        try {
          postLog({
            level,
            source: 'console',
            text: serializeArgs(args),
            stack: stackOf(args),
            location: null,
            at: Date.now(),
          });
        } catch {
          /* 무시 */
        }
        try {
          orig.apply(this, args);
        } catch {
          /* 원본 호출 실패도 무시 (fail-open) */
        }
      };
    const c = console as unknown as Record<string, (...a: unknown[]) => void>;
    if (typeof c.error === 'function') c.error = hook('error', c.error.bind(console));
    if (typeof c.warn === 'function') c.warn = hook('warn', c.warn.bind(console));
  } catch {
    /* console 후킹 실패 — 페이지 영향 없음 */
  }

  // 런타임 에러 (리소스 로딩 에러는 message 가 없어 제외 — 노이즈 방지)
  try {
    window.addEventListener(
      'error',
      (ev: ErrorEvent) => {
        try {
          if (!ev.message && !ev.error) return; // 리소스 에러 등 제외
          postLog({
            level: 'error',
            source: 'onerror',
            text: ev.message || String(ev.error),
            stack: ev.error instanceof Error ? (ev.error.stack ?? null) : null,
            location: ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : null,
            at: Date.now(),
          });
        } catch {
          /* 무시 */
        }
      },
      true,
    );
  } catch {
    /* 무시 */
  }

  // 미처리 프로미스 거부
  try {
    window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
      try {
        const reason: unknown = ev.reason;
        postLog({
          level: 'error',
          source: 'unhandledrejection',
          text:
            reason instanceof Error ? `${reason.name}: ${reason.message}` : serializeArgs([reason]),
          stack: reason instanceof Error ? (reason.stack ?? null) : null,
          location: null,
          at: Date.now(),
        });
      } catch {
        /* 무시 */
      }
    });
  } catch {
    /* 무시 */
  }

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
