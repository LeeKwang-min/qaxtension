import type {
  EnvInfo,
  ReportInput,
  ReportAttachment,
  RequestRecord,
  LogRecord,
  LoginGuess,
} from '../messaging/types';
import { buildStepsSection } from '../capture/recorder';

/** 표/리스트에 싣는 최대 행 수 (초과분은 "외 N건" 표기) */
export const MAX_REPORT_ROWS = 50;

/** 리포트 포함/제외 옵션 — 개발자가 노이즈를 빼고 핵심만 전달하도록 */
export interface ReportOptions {
  includeEnv: boolean;
  includeElement: boolean;
  includeFailedApi: boolean;
  includeLogs: boolean;
  includeScreenshot: boolean;
  includeSteps: boolean;
  /** 리포트에서 뺄 실패 API id (개별 체크 해제) */
  excludedRequestIds: string[];
  /** 리포트에서 뺄 로그 id (개별 체크 해제) */
  excludedLogIds: string[];
}

/** 기본: 모든 섹션 포함, 제외 없음 */
export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  includeEnv: true,
  includeElement: true,
  includeFailedApi: true,
  includeLogs: true,
  includeScreenshot: true,
  includeSteps: true,
  excludedRequestIds: [],
  excludedLogIds: [],
};
/** 로그인 추정 값 절단 길이 (민감정보 보호) */
export const MAX_LOGIN_VALUE = 80;

/** UA 문자열 → 사람이 읽는 OS 라벨 (best-effort) */
export function osFromUA(ua: string): string {
  // iOS/Android 를 Mac/Linux 보다 먼저 본다 (UA 에 'Mac OS X'·'Linux' 가 섞여 있음)
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return '알 수 없음';
}

/** 로그인 추정 키 우선순위 (identity 우선, secret 은 last resort) */
const LOGIN_KEY_PRIORITY = [
  'email',
  'username',
  'userid',
  'user',
  'login',
  'account',
  'nickname',
  'token',
  'jwt',
  'auth',
  'session',
];

interface StorageEntry {
  key: string;
  value: string;
  from: LoginGuess['from'];
}

/**
 * localStorage/쿠키 항목에서 로그인 사용자를 best-effort 추정.
 * 우선순위 키와 부분일치하는 첫 항목을 반환(값은 절단). 없으면 null.
 */
export function guessLogin(entries: StorageEntry[]): LoginGuess | null {
  for (const needle of LOGIN_KEY_PRIORITY) {
    const hit = entries.find((e) => e.key.toLowerCase().includes(needle));
    if (hit) {
      return {
        key: hit.key,
        from: hit.from,
        value: hit.value.length > MAX_LOGIN_VALUE ? hit.value.slice(0, MAX_LOGIN_VALUE) : hit.value,
      };
    }
  }
  return null;
}

/** epoch ms → 'YYYY-MM-DD HH:mm:ss UTC' (타임존 무관, 결정적) */
function fmtTimestamp(ms: number): string {
  return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/** epoch ms → 'HH:mm:ss' (UTC) */
function fmtTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/** 마크다운 표 셀 이스케이프 (파이프·개행 제거) */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** ok===false 이거나 네트워크 오류가 있는 요청 = 실패 */
function isFailed(r: RequestRecord): boolean {
  return r.ok === false || r.error != null;
}

const LEVEL_LABEL: Record<LogRecord['level'], string> = { error: 'ERROR', warn: 'WARN' };

function envSection(env: EnvInfo | null): string {
  if (!env) return '## 환경\n\n_환경정보 미수집_';
  const lines = [
    '## 환경',
    '',
    `- **브라우저(UA):** ${env.userAgent}`,
    `- **OS:** ${env.os}`,
    `- **뷰포트:** ${env.viewport.width} × ${env.viewport.height} (DPR ${env.viewport.dpr})`,
    `- **화면:** ${env.screen.width} × ${env.screen.height}`,
    `- **언어:** ${env.language}`,
  ];
  if (env.loginGuess) {
    const g = env.loginGuess;
    lines.push(
      `- **로그인 추정:** ${g.key} = \`${g.value}\` (출처: ${g.from}, best-effort — 보장값 아님)`,
    );
  } else {
    lines.push('- **로그인 추정:** (감지 안 됨)');
  }
  return lines.join('\n');
}

function elementSection(el: ReportInput['pickedElement']): string {
  if (!el) return '## 검사한 요소\n\n_검사한 요소 없음_';
  const lines = [
    '## 검사한 요소',
    '',
    `- **선택자:** \`${el.selector}\``,
  ];
  if (el.text) lines.push(`- **텍스트:** ${el.text}`);
  const contrast = el.accessibility.contrast
    ? ` · 대비 ${el.accessibility.contrast.ratio} (${el.accessibility.contrast.level})`
    : '';
  lines.push(
    `- **색상:** 글자 ${el.colors.color.hex} / 배경 ${el.colors.backgroundColor.hex}${contrast}`,
  );
  lines.push(
    `- **타이포:** ${el.typography.fontFamily} ${el.typography.fontSize} / ${el.typography.fontWeight}`,
  );
  lines.push(
    `- **박스:** ${el.boxModel.width} × ${el.boxModel.height}, 여백 ${el.boxModel.margin}, 패딩 ${el.boxModel.padding}`,
  );
  return lines.join('\n');
}

function failedApiSection(requests: RequestRecord[], excludedIds: string[] = []): string {
  const failed = requests.filter(isFailed).filter((r) => !excludedIds.includes(r.id));
  if (failed.length === 0) return '## 실패한 API (0건)\n\n_실패한 API 없음_';
  const shown = failed.slice(0, MAX_REPORT_ROWS);
  const rows = shown.map((r) => {
    const status = r.status != null ? String(r.status) : (r.error ?? '오류');
    const dur = r.durationMs != null ? `${r.durationMs}ms` : '-';
    return `| ${cell(r.method)} | ${cell(r.url)} | ${cell(status)} | ${cell(dur)} |`;
  });
  const lines = [
    `## 실패한 API (${failed.length}건)`,
    '',
    '| 메서드 | URL | 상태 | 소요 |',
    '|---|---|---|---|',
    ...rows,
  ];
  if (failed.length > shown.length) lines.push('', `_…외 ${failed.length - shown.length}건_`);
  return lines.join('\n');
}

function logsSection(allLogs: LogRecord[], excludedIds: string[] = []): string {
  const logs = allLogs.filter((l) => !excludedIds.includes(l.id));
  if (logs.length === 0) return '## 최근 에러·경고 (0건)\n\n_수집된 에러·경고 없음_';
  const shown = logs.slice(0, MAX_REPORT_ROWS);
  const items = shown.map((l) => {
    const times = l.count > 1 ? ` (×${l.count})` : '';
    const loc = l.location ? ` — ${l.location}` : '';
    return `- **[${LEVEL_LABEL[l.level]}]** ${l.text}${times}${loc} — ${fmtTime(l.lastAt)}`;
  });
  const lines = [`## 최근 에러·경고 (${logs.length}건)`, '', ...items];
  if (logs.length > shown.length) lines.push('', `_…외 ${logs.length - shown.length}건_`);
  return lines.join('\n');
}

function screenshotSection(screenshot: string | null): string {
  return screenshot
    ? '## 스크린샷\n\n첨부: `screenshot.png` (zip 다운로드에 포함)'
    : '## 스크린샷\n\n_스크린샷 없음_';
}

/** 세션 스냅샷 → 마크다운 버그 리포트 (옵션으로 섹션/항목 포함·제외) */
export function buildMarkdown(input: ReportInput, options: ReportOptions = DEFAULT_REPORT_OPTIONS): string {
  const url = input.env?.url ?? '(알 수 없음)';
  const header = ['# 버그 리포트', '', `- **생성:** ${fmtTimestamp(input.generatedAt)}`, `- **URL:** ${url}`];
  const sections: string[] = [header.join('\n')];
  if (options.includeEnv) sections.push(envSection(input.env));
  if (options.includeElement) sections.push(elementSection(input.pickedElement));
  if (options.includeFailedApi) sections.push(failedApiSection(input.requests, options.excludedRequestIds));
  if (options.includeLogs) sections.push(logsSection(input.logs, options.excludedLogIds));
  if (options.includeScreenshot) sections.push(screenshotSection(input.screenshot));
  if (options.includeSteps) sections.push(buildStepsSection(input.steps));
  return sections.join('\n\n');
}

/** 마크다운 + 첨부(스크린샷) 번들. zip 패키징/다운로드는 패널(impure) 담당. */
export function buildReport(
  input: ReportInput,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): {
  markdown: string;
  attachments: ReportAttachment[];
} {
  const attachments: ReportAttachment[] =
    options.includeScreenshot && input.screenshot
      ? [{ name: 'screenshot.png', dataUrl: input.screenshot }]
      : [];
  return { markdown: buildMarkdown(input, options), attachments };
}
