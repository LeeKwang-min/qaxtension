import type { EnvInfo, LoginGuess } from '../messaging/types';
import { osFromUA, guessLogin } from './builder';

/** `document.cookie` 문자열 → {key,value}[] (비httpOnly 쿠키만 노출됨) */
export function parseCookies(raw: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const part of raw.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue; // '=' 없음 또는 빈 키
    out.push({ key: seg.slice(0, eq).trim(), value: seg.slice(eq + 1) });
  }
  return out;
}

/** localStorage 키/값을 안전하게 수집 (접근 거부/예외는 무시) */
function readLocalStorage(): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key == null) continue;
      out.push({ key, value: localStorage.getItem(key) ?? '' });
    }
  } catch {
    // SecurityError 등 — best-effort 이므로 무시
  }
  return out;
}

type Candidate = { key: string; value: string; from: LoginGuess['from'] };

/** 로그인 추정용 항목 수집 (localStorage + 비httpOnly 쿠키) */
function loginCandidates(): Candidate[] {
  const entries: Candidate[] = [];
  for (const e of readLocalStorage()) entries.push({ ...e, from: 'localStorage' });
  try {
    for (const c of parseCookies(document.cookie)) entries.push({ ...c, from: 'cookie' });
  } catch {
    // 무시
  }
  return entries;
}

/**
 * 페이지(content) 컨텍스트에서 환경정보를 best-effort 수집한다.
 * 뷰포트·로그인 추정은 페이지 컨텍스트라야 정확하므로 여기서 수집한다.
 */
export function collectEnv(now: number): EnvInfo {
  const ua = navigator.userAgent;
  return {
    url: location.href,
    userAgent: ua,
    platform: navigator.platform ?? '',
    os: osFromUA(ua),
    language: navigator.language ?? '',
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    screen: { width: window.screen.width, height: window.screen.height },
    loginGuess: guessLogin(loginCandidates()),
    collectedAt: now,
  };
}
