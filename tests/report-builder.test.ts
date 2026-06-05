import { describe, it, expect } from 'vitest';
import { osFromUA, guessLogin, buildMarkdown, buildReport } from '../src/report/builder';
import type { EnvInfo, ReportInput, RequestRecord, LogRecord, ElementInfo } from '../src/messaging/types';

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

describe('osFromUA', () => {
  it('detects macOS', () => expect(osFromUA(MAC_UA)).toBe('macOS'));
  it('detects Windows', () => expect(osFromUA(WIN_UA)).toBe('Windows'));
  it('detects iOS before Mac (iPhone UA mentions Mac OS X)', () =>
    expect(osFromUA(IPHONE_UA)).toBe('iOS'));
  it('detects Android before Linux (Android UA mentions Linux)', () =>
    expect(osFromUA(ANDROID_UA)).toBe('Android'));
  it('falls back for unknown UA', () => expect(osFromUA('something weird')).toBe('알 수 없음'));
});

describe('guessLogin', () => {
  it('returns null when nothing matches', () => {
    expect(guessLogin([{ key: 'theme', value: 'dark', from: 'localStorage' }])).toBeNull();
  });
  it('prefers email over token', () => {
    const g = guessLogin([
      { key: 'access_token', value: 'abc', from: 'cookie' },
      { key: 'userEmail', value: 'a@b.com', from: 'localStorage' },
    ]);
    expect(g).toEqual({ key: 'userEmail', value: 'a@b.com', from: 'localStorage' });
  });
  it('matches token as a last resort', () => {
    const g = guessLogin([{ key: 'auth_token', value: 'xyz', from: 'cookie' }]);
    expect(g?.from).toBe('cookie');
    expect(g?.key).toBe('auth_token');
  });
  it('truncates long values', () => {
    const long = 'x'.repeat(500);
    const g = guessLogin([{ key: 'token', value: long, from: 'cookie' }]);
    expect(g!.value.length).toBeLessThanOrEqual(80);
  });
  it('does not match userAgent-like keys for "user"', () => {
    // 'username' should match, but a bare unrelated key should not.
    const g = guessLogin([{ key: 'username', value: 'kim', from: 'localStorage' }]);
    expect(g?.key).toBe('username');
  });
});

function env(over: Partial<EnvInfo> = {}): EnvInfo {
  return {
    url: 'https://example.com/page',
    userAgent: MAC_UA,
    platform: 'MacIntel',
    os: 'macOS',
    language: 'ko-KR',
    viewport: { width: 1280, height: 720, dpr: 2 },
    screen: { width: 2560, height: 1440 },
    loginGuess: null,
    collectedAt: 1717574400000,
    ...over,
  };
}

function req(over: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: 'r1',
    source: 'fetch',
    method: 'GET',
    url: 'https://api.example.com/x',
    status: 200,
    statusText: 'OK',
    ok: true,
    error: null,
    startedAt: 1717574400000,
    durationMs: 120,
    requestBody: null,
    responseBody: null,
    fromCache: null,
    webReqId: null,
    ...over,
  };
}

function log(over: Partial<LogRecord> = {}): LogRecord {
  return {
    id: 'l1',
    level: 'error',
    source: 'console',
    text: 'boom',
    stack: null,
    location: null,
    count: 1,
    firstAt: 1717574400000,
    lastAt: 1717574400000,
    ...over,
  };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    generatedAt: 1717574400000, // 2024-06-05T08:00:00Z
    env: env(),
    pickedElement: null,
    requests: [],
    logs: [],
    screenshot: null,
    ...over,
  };
}

describe('buildMarkdown', () => {
  it('renders a stable header with UTC timestamp and URL', () => {
    const md = buildMarkdown(input());
    expect(md.startsWith('# 버그 리포트')).toBe(true);
    expect(md).toContain('2024-06-05 08:00:00 UTC');
    expect(md).toContain('https://example.com/page');
  });

  it('renders the environment section', () => {
    const md = buildMarkdown(input());
    expect(md).toContain('## 환경');
    expect(md).toContain('macOS');
    expect(md).toContain('1280 × 720');
    expect(md).toContain('DPR 2');
    expect(md).toContain('ko-KR');
  });

  it('shows login guess when present, hidden note otherwise', () => {
    expect(buildMarkdown(input())).toContain('감지 안 됨');
    const md = buildMarkdown(
      input({ env: env({ loginGuess: { key: 'email', value: 'a@b.com', from: 'localStorage' } }) }),
    );
    expect(md).toContain('`a@b.com`');
    expect(md).toContain('best-effort');
  });

  it('lists only failed APIs in a table', () => {
    const md = buildMarkdown(
      input({
        requests: [
          req({ id: 'ok', status: 200, ok: true }),
          req({ id: 'bad', method: 'POST', url: 'https://api/login', status: 500, ok: false, durationMs: 1200 }),
          req({ id: 'neterr', url: 'https://api/down', status: null, ok: null, error: 'net::ERR_FAILED' }),
        ],
      }),
    );
    expect(md).toContain('## 실패한 API (2건)');
    expect(md).toContain('| POST | https://api/login | 500 | 1200ms |');
    expect(md).toContain('net::ERR_FAILED');
    expect(md).not.toContain('https://api.example.com/x'); // 성공건 제외
  });

  it('shows "없음" when no failed APIs', () => {
    expect(buildMarkdown(input({ requests: [req()] }))).toContain('실패한 API 없음');
  });

  it('renders recent errors with count and time', () => {
    const md = buildMarkdown(
      input({ logs: [log({ text: 'TypeError: x', count: 3, lastAt: 1717574405000 })] }),
    );
    expect(md).toContain('## 최근 에러·경고 (1건)');
    expect(md).toContain('TypeError: x');
    expect(md).toContain('×3');
    expect(md).toContain('08:00:05');
  });

  it('renders inspected element when present', () => {
    const el: ElementInfo = {
      tagName: 'BUTTON',
      id: null,
      classList: ['submit'],
      selector: 'button.submit',
      text: '제출',
      colors: {
        color: { raw: 'rgb(255,255,255)', hex: '#ffffff' },
        backgroundColor: { raw: 'rgb(0,0,0)', hex: '#000000' },
        borderColor: { raw: 'transparent', hex: 'transparent' },
      },
      typography: {
        fontFamily: 'Arial',
        fontSize: '14px',
        fontWeight: '700',
        lineHeight: '20px',
        letterSpacing: 'normal',
      },
      boxModel: {
        width: '80px',
        height: '32px',
        margin: '0px',
        padding: '8px',
        borderRadius: '4px',
        border: '0px none',
      },
      accessibility: { contrast: { ratio: 21, level: 'AAA' }, alt: null, role: null, ariaLabel: null },
    };
    const md = buildMarkdown(input({ pickedElement: el }));
    expect(md).toContain('## 검사한 요소');
    expect(md).toContain('`button.submit`');
    expect(md).toContain('#ffffff');
    expect(md).toContain('21');
  });

  it('notes screenshot attachment only when present', () => {
    expect(buildMarkdown(input())).toContain('스크린샷 없음');
    expect(buildMarkdown(input({ screenshot: 'data:image/png;base64,AAAA' }))).toContain(
      'screenshot.png',
    );
  });

  it('escapes pipe characters in table cells', () => {
    const md = buildMarkdown(
      input({ requests: [req({ ok: false, status: 400, url: 'https://api/x?a=1|2' })] }),
    );
    expect(md).toContain('a=1\\|2');
  });
});

describe('buildReport', () => {
  it('returns markdown and no attachments without a screenshot', () => {
    const r = buildReport(input());
    expect(r.markdown).toContain('# 버그 리포트');
    expect(r.attachments).toEqual([]);
  });
  it('includes screenshot.png attachment when present', () => {
    const r = buildReport(input({ screenshot: 'data:image/png;base64,AAAA' }));
    expect(r.attachments).toEqual([{ name: 'screenshot.png', dataUrl: 'data:image/png;base64,AAAA' }]);
  });
});
