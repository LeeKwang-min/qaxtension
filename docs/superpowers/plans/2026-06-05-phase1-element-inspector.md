# QA Companion — Phase 1 (요소·스타일 검사기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비개발자가 페이지에서 요소를 호버·클릭으로 선택하면, 적용된 색상·타이포그래피·박스모델·접근성 정보를 사이드 패널에 쉬운 말로 보여준다.

**Architecture:** 요소 검사는 DOM 접근만 필요하므로 ISOLATED content script에서 수행한다(MAIN-world inject는 건드리지 않음). 변환 로직(색상 파싱·대비비·ElementInfo 빌더)은 순수 모듈 `src/inspect/`로 분리해 단위 테스트하고 Phase 5(접근성 검증)가 재사용한다. 피커 오버레이/이벤트는 `picker.ts`가 담당하고, content가 PICK_START/STOP 명령에 따라 제어한다. 선택 결과는 기존 store→Port push 메커니즘으로 패널에 전달된다.

**Tech Stack:** TypeScript, React, Vite/CRXJS, Vitest(jsdom), Playwright.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/messaging/types.ts` | (수정) `ElementInfo` 등 타입, 메시지·상태 확장 |
| `src/background/store.ts` | (수정) `createDefault`에 `picking`/`pickedElement` 추가 |
| `src/inspect/colors.ts` | (신규) 색상 파싱·대비비·WCAG 등급 (순수) |
| `src/inspect/element-info.ts` | (신규) `cssPath`, `buildElementInfo` (순수) |
| `src/inspect/picker.ts` | (신규) 호버 오버레이 + 클릭/ESC 이벤트 컨트롤러 (DOM) |
| `src/content/index.ts` | (수정) PICK_START/STOP 수신 → picker 제어 → ELEMENT_PICKED 전송 |
| `src/background/index.ts` | (수정) 검사 메시지 라우팅 + store 갱신 |
| `src/sidepanel/InspectPanel.tsx` | (신규) 검사 탭 UI |
| `src/sidepanel/App.tsx` | (수정) 검사 탭에 InspectPanel 연결, 요소선택 토글 |
| `tests/colors.test.ts` | (신규) 색상 유틸 단위 테스트 |
| `tests/element-info.test.ts` | (신규) ElementInfo 빌더 단위 테스트 |
| `tests/picker.test.ts` | (신규) picker start/stop DOM 부수효과 단위 테스트 |
| `e2e/inspect.spec.ts` | (신규) 피커 배선 e2e |

---

## Task 1: 타입 & store 확장

**Files:**
- Modify: `src/messaging/types.ts`
- Modify: `src/background/store.ts`
- Test: `tests/store.test.ts` (기존 파일에 추가)

- [ ] **Step 1: `src/messaging/types.ts` 에 검사 관련 타입 추가**

파일 맨 위(`export type TabId = number;` 아래)에 추가:
```ts
/** 색상 한 항목 — 스와치/표시용 */
export interface ColorInfo {
  /** 원본 computed 값 (예: 'rgb(255, 0, 0)') */
  raw: string;
  /** HEX 변환 (예: '#ff0000'), 투명은 'transparent' */
  hex: string;
}

/** 대비비 + WCAG 등급 */
export interface ContrastInfo {
  ratio: number; // 예: 4.53
  level: 'AAA' | 'AA' | 'Fail';
}

/** 선택된 요소의 검사 정보 */
export interface ElementInfo {
  tagName: string;
  id: string | null;
  classList: string[];
  selector: string;
  text: string | null;
  colors: {
    color: ColorInfo;
    backgroundColor: ColorInfo;
    borderColor: ColorInfo;
  };
  typography: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
  };
  boxModel: {
    width: string;
    height: string;
    margin: string;
    padding: string;
    borderRadius: string;
    border: string;
  };
  accessibility: {
    contrast: ContrastInfo | null; // 배경이 투명하면 null
    alt: string | null;
    role: string | null;
    ariaLabel: string | null;
  };
}
```

- [ ] **Step 2: 같은 파일에서 `CmdEnvelope`/`RuntimeMessage`/`PortMessage`/`TabSessionState` 확장**

`TabSessionState` 인터페이스를 다음으로 교체:
```ts
/** tabId별 세션 상태 */
export interface TabSessionState {
  tabId: TabId;
  url: string | null;
  injectReady: boolean;
  lastPingNonce: string | null;
  picking: boolean;
  pickedElement: ElementInfo | null;
  updatedAt: number;
}
```

`RuntimeMessage` union을 다음으로 교체:
```ts
/** chrome.runtime 메시지 (content↔background 양방향 공유 union) */
export type RuntimeMessage =
  | { type: 'INJECT_READY' }
  | { type: 'PING_REPLY'; nonce: string }
  | { type: 'PING'; nonce: string }
  | { type: 'RESYNC' }
  // background → content: 요소 피커 제어
  | { type: 'PICK_START' }
  | { type: 'PICK_STOP' }
  // content → background: 피커 결과
  | { type: 'ELEMENT_PICKED'; info: ElementInfo }
  | { type: 'PICK_CANCELLED' };
```

`PortMessage` union을 다음으로 교체:
```ts
/** 사이드 패널 ↔ background 의 long-lived Port 메시지 */
export type PortMessage =
  | { type: 'SUBSCRIBE'; tabId: TabId }
  | { type: 'PING'; tabId: TabId }
  // 패널 → background: 요소 피커 토글
  | { type: 'PICK_START'; tabId: TabId }
  | { type: 'PICK_STOP'; tabId: TabId }
  | { type: 'STATE_UPDATE'; state: TabSessionState };
```

(`CmdEnvelope`는 변경 없음 — 피커는 content/DOM 레벨이라 MAIN inject 명령이 필요 없다.)

- [ ] **Step 3: `tests/store.test.ts` 에 기본값 확장 테스트 추가 (실패 우선)**

기존 `describe('tab session store', ...)` 블록 안, 첫 번째 테스트(`creates default state on first access`)의 expect들 끝에 다음 두 줄을 추가:
```ts
    expect(s.picking).toBe(false);
    expect(s.pickedElement).toBeNull();
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — `picking`/`pickedElement` 가 `undefined` (createDefault 미확장).

- [ ] **Step 5: `src/background/store.ts` 의 `createDefault` 확장**

`createDefault` 함수를 다음으로 교체:
```ts
function createDefault(tabId: TabId): TabSessionState {
  return {
    tabId,
    url: null,
    injectReady: false,
    lastPingNonce: null,
    picking: false,
    pickedElement: null,
    updatedAt: Date.now(),
  };
}
```

- [ ] **Step 6: 테스트 통과 확인 + 빌드**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS (4 tests).
Run: `npm run build`
Expected: exit 0 (타입 union 확장이 기존 소비처와 충돌 없는지 확인).

- [ ] **Step 7: 커밋**

```bash
git add src/messaging/types.ts src/background/store.ts tests/store.test.ts
git commit -m "feat(types): add ElementInfo, picker messages, picking/pickedElement state"
```

---

## Task 2: 색상 유틸 (순수)

**Files:**
- Create: `src/inspect/colors.ts`
- Test: `tests/colors.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/colors.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseColorToHex, rgbTuple, contrastRatio, wcagLevel } from '../src/inspect/colors';

describe('parseColorToHex', () => {
  it('converts rgb() to hex', () => {
    expect(parseColorToHex('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(parseColorToHex('rgb(0, 128, 255)')).toBe('#0080ff');
  });
  it('treats fully transparent as "transparent"', () => {
    expect(parseColorToHex('rgba(0, 0, 0, 0)')).toBe('transparent');
  });
  it('drops alpha for opaque rgba', () => {
    expect(parseColorToHex('rgba(255, 255, 255, 1)')).toBe('#ffffff');
  });
  it('returns input unchanged when not rgb()', () => {
    expect(parseColorToHex('#abcdef')).toBe('#abcdef');
  });
});

describe('rgbTuple', () => {
  it('extracts numeric channels', () => {
    expect(rgbTuple('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(rgbTuple('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3]);
  });
  it('returns null for non-rgb', () => {
    expect(rgbTuple('red')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(Math.round(contrastRatio([0, 0, 0], [255, 255, 255]))).toBe(21);
  });
  it('is 1 for identical colors', () => {
    expect(contrastRatio([100, 100, 100], [100, 100, 100])).toBeCloseTo(1, 5);
  });
  it('is symmetric (order independent)', () => {
    const a = contrastRatio([0, 0, 0], [255, 255, 255]);
    const b = contrastRatio([255, 255, 255], [0, 0, 0]);
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('wcagLevel', () => {
  it('grades normal text', () => {
    expect(wcagLevel(21, 16, false)).toBe('AAA');
    expect(wcagLevel(5, 16, false)).toBe('AA');
    expect(wcagLevel(3, 16, false)).toBe('Fail');
  });
  it('uses relaxed thresholds for large text', () => {
    // 24px+ 또는 bold 18.66px+ 는 large
    expect(wcagLevel(3.5, 24, false)).toBe('AA');
    expect(wcagLevel(2, 24, false)).toBe('Fail');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/colors.test.ts`
Expected: FAIL — `../src/inspect/colors` 모듈 없음.

- [ ] **Step 3: 구현 — `src/inspect/colors.ts`**

```ts
/** 'rgb(r, g, b)' / 'rgba(r, g, b, a)' → [r, g, b]. 그 외엔 null. */
export function rgbTuple(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2]];
}

/** computed 색상 문자열을 HEX 로. 완전 투명은 'transparent', rgb 가 아니면 입력 그대로. */
export function parseColorToHex(css: string): string {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return css;
  const parts = m[1].split(',').map((s) => s.trim());
  const a = parts[3] != null ? parseFloat(parts[3]) : 1;
  if (a === 0) return 'transparent';
  const rgb = rgbTuple(css);
  if (!rgb) return css;
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

/** WCAG 상대 휘도 (0~1) */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** 두 색의 대비비 (1~21), 순서 무관 */
export function contrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const l1 = relativeLuminance(fg[0], fg[1], fg[2]);
  const l2 = relativeLuminance(bg[0], bg[1], bg[2]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.x 등급. large = 24px+ 또는 bold(>=700) 18.66px+ */
export function wcagLevel(
  ratio: number,
  fontSizePx: number,
  bold: boolean,
): 'AAA' | 'AA' | 'Fail' {
  const large = fontSizePx >= 24 || (bold && fontSizePx >= 18.66);
  if (large) {
    if (ratio >= 4.5) return 'AAA';
    if (ratio >= 3) return 'AA';
    return 'Fail';
  }
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'Fail';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/colors.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/inspect/colors.ts tests/colors.test.ts
git commit -m "feat(inspect): color parsing, contrast ratio, WCAG level utils"
```

---

## Task 3: ElementInfo 빌더 (순수)

**Files:**
- Create: `src/inspect/element-info.ts`
- Test: `tests/element-info.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/element-info.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { cssPath, buildElementInfo } from '../src/inspect/element-info';
import type { StyleLike } from '../src/inspect/element-info';

function makeStyle(overrides: Partial<StyleLike> = {}): StyleLike {
  return {
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgb(255, 255, 255)',
    borderColor: 'rgb(0, 0, 0)',
    fontFamily: 'Arial',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '24px',
    letterSpacing: 'normal',
    width: '100px',
    height: '20px',
    margin: '0px',
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid rgb(0, 0, 0)',
    ...overrides,
  };
}

describe('cssPath', () => {
  it('uses #id when present', () => {
    const el = document.createElement('div');
    el.id = 'hero';
    expect(cssPath(el)).toBe('#hero');
  });
  it('falls back to tag + classes', () => {
    const el = document.createElement('button');
    el.className = 'btn primary';
    expect(cssPath(el)).toBe('button.btn.primary');
  });
});

describe('buildElementInfo', () => {
  it('extracts colors, typography, box model', () => {
    const el = document.createElement('p');
    el.textContent = 'Hello';
    const info = buildElementInfo(el, makeStyle());
    expect(info.tagName).toBe('p');
    expect(info.colors.color.hex).toBe('#000000');
    expect(info.colors.backgroundColor.hex).toBe('#ffffff');
    expect(info.typography.fontSize).toBe('16px');
    expect(info.boxModel.padding).toBe('8px');
    expect(info.text).toBe('Hello');
  });

  it('computes contrast when background is opaque', () => {
    const el = document.createElement('p');
    const info = buildElementInfo(el, makeStyle());
    expect(info.accessibility.contrast).not.toBeNull();
    expect(info.accessibility.contrast!.level).toBe('AAA'); // black on white, 16px
  });

  it('returns null contrast when background is transparent', () => {
    const el = document.createElement('p');
    const info = buildElementInfo(el, makeStyle({ backgroundColor: 'rgba(0, 0, 0, 0)' }));
    expect(info.accessibility.contrast).toBeNull();
  });

  it('captures img alt and role', () => {
    const el = document.createElement('img');
    el.setAttribute('alt', 'logo');
    el.setAttribute('role', 'img');
    const info = buildElementInfo(el, makeStyle());
    expect(info.accessibility.alt).toBe('logo');
    expect(info.accessibility.role).toBe('img');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/element-info.test.ts`
Expected: FAIL — 모듈 없음.

> 참고: `vitest.config.ts` 의 `environment` 가 `'node'` 이므로 `document` 가 없다. 이 테스트는 jsdom 이 필요하다. 파일 상단에 vitest 환경 지시 주석을 추가한다 (Step 3 의 테스트 파일 첫 줄). 아래 Step 3 에서 처리.

- [ ] **Step 3: 테스트 파일에 jsdom 환경 지시 추가**

`tests/element-info.test.ts` 의 **맨 첫 줄**에 다음을 추가(파일별 환경 오버라이드):
```ts
// @vitest-environment jsdom
```
그리고 jsdom 의존성을 설치:
```bash
npm install -D jsdom
```

- [ ] **Step 4: 구현 — `src/inspect/element-info.ts`**

```ts
import type { ColorInfo, ContrastInfo, ElementInfo } from '../messaging/types';
import { parseColorToHex, rgbTuple, contrastRatio, wcagLevel } from './colors';

/** getComputedStyle 결과에서 우리가 읽는 속성만 추린 형태 (테스트 주입용) */
export interface StyleLike {
  color: string;
  backgroundColor: string;
  borderColor: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  width: string;
  height: string;
  margin: string;
  padding: string;
  borderRadius: string;
  border: string;
}

const MAX_TEXT = 80;

/** 짧은 CSS 경로 (id 우선, 아니면 tag.class 체인 최대 4단계) */
export function cssPath(el: Element): string {
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < 4) {
    if (cur.id) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    let sel = cur.tagName.toLowerCase();
    const classes = Array.from(cur.classList).slice(0, 3).map((c) => `.${c}`).join('');
    sel += classes;
    parts.unshift(sel);
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

function colorInfo(raw: string): ColorInfo {
  return { raw, hex: parseColorToHex(raw) };
}

function computeContrast(style: StyleLike): ContrastInfo | null {
  const fg = rgbTuple(style.color);
  const bg = rgbTuple(style.backgroundColor);
  // 배경이 투명(rgba alpha 0)하거나 파싱 불가하면 신뢰할 수 없으므로 null
  if (!fg || !bg || parseColorToHex(style.backgroundColor) === 'transparent') return null;
  const ratio = contrastRatio(fg, bg);
  const sizePx = parseFloat(style.fontSize) || 16;
  const bold = parseInt(style.fontWeight, 10) >= 700;
  return { ratio: Math.round(ratio * 100) / 100, level: wcagLevel(ratio, sizePx, bold) };
}

/** 요소 + computed style → ElementInfo */
export function buildElementInfo(el: Element, style: StyleLike): ElementInfo {
  const text = el.textContent?.trim() || null;
  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || null,
    classList: Array.from(el.classList),
    selector: cssPath(el),
    text: text ? text.slice(0, MAX_TEXT) : null,
    colors: {
      color: colorInfo(style.color),
      backgroundColor: colorInfo(style.backgroundColor),
      borderColor: colorInfo(style.borderColor),
    },
    typography: {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
    },
    boxModel: {
      width: style.width,
      height: style.height,
      margin: style.margin,
      padding: style.padding,
      borderRadius: style.borderRadius,
      border: style.border,
    },
    accessibility: {
      contrast: computeContrast(style),
      alt: el.getAttribute('alt'),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
    },
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/element-info.test.ts`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/inspect/element-info.ts tests/element-info.test.ts package.json package-lock.json
git commit -m "feat(inspect): ElementInfo builder + cssPath (jsdom-tested)"
```

---

## Task 4: 피커 컨트롤러 (DOM)

**Files:**
- Create: `src/inspect/picker.ts`
- Test: `tests/picker.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/picker.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPicker } from '../src/inspect/picker';

afterEach(() => {
  document.body.innerHTML = '';
  document.querySelectorAll('[data-qaxtension-overlay]').forEach((n) => n.remove());
});

describe('createPicker', () => {
  it('inserts an overlay element on start and removes it on stop', () => {
    const picker = createPicker(() => {});
    picker.start();
    expect(document.querySelector('[data-qaxtension-overlay]')).not.toBeNull();
    picker.stop();
    expect(document.querySelector('[data-qaxtension-overlay]')).toBeNull();
  });

  it('invokes onPick with the clicked element and stops', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    const onPick = vi.fn();
    const picker = createPicker(onPick);
    picker.start();

    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toBe(target);
    // 클릭 후 피커는 자동 종료되어 오버레이 제거
    expect(document.querySelector('[data-qaxtension-overlay]')).toBeNull();
  });

  it('invokes onCancel and stops when Escape is pressed', () => {
    const onCancel = vi.fn();
    const picker = createPicker(() => {}, onCancel);
    picker.start();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-qaxtension-overlay]')).toBeNull();
  });

  it('ignores its own overlay element as a pick target', () => {
    const onPick = vi.fn();
    const picker = createPicker(onPick);
    picker.start();
    const overlay = document.querySelector('[data-qaxtension-overlay]') as HTMLElement;
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPick).not.toHaveBeenCalled();
    picker.stop();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/picker.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현 — `src/inspect/picker.ts`**

```ts
export interface Picker {
  start(): void;
  stop(): void;
}

const OVERLAY_ATTR = 'data-qaxtension-overlay';

/**
 * 호버 하이라이트 + 클릭 선택 피커.
 * - start(): 오버레이 삽입 + mousemove/click/keydown 리스너 등록
 * - 클릭 시 onPick(element) 호출 후 자동 stop
 * - Escape 시 onCancel() 호출 후 자동 stop
 * 우리 오버레이는 pointer-events:none 이며 pick 대상에서 제외한다.
 */
export function createPicker(
  onPick: (el: Element) => void,
  onCancel?: () => void,
): Picker {
  let overlay: HTMLElement | null = null;
  let active = false;

  const isOurs = (node: EventTarget | null): boolean =>
    node instanceof Element && node.hasAttribute(OVERLAY_ATTR);

  const moveOverlay = (el: Element): void => {
    if (!overlay) return;
    const r = el.getBoundingClientRect();
    overlay.style.top = `${r.top + window.scrollY}px`;
    overlay.style.left = `${r.left + window.scrollX}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
  };

  const onMove = (e: MouseEvent): void => {
    const t = e.target;
    if (!(t instanceof Element) || isOurs(t)) return;
    moveOverlay(t);
  };

  const onClick = (e: MouseEvent): void => {
    const t = e.target;
    if (!(t instanceof Element) || isOurs(t)) return;
    e.preventDefault();
    e.stopPropagation();
    const picked = t;
    stop();
    onPick(picked);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      stop();
      onCancel?.();
    }
  };

  function start(): void {
    if (active) return;
    active = true;
    overlay = document.createElement('div');
    overlay.setAttribute(OVERLAY_ATTR, '');
    overlay.style.cssText = [
      'position:absolute',
      'z-index:2147483647',
      'pointer-events:none',
      'background:rgba(56,135,255,0.25)',
      'outline:2px solid rgba(56,135,255,0.9)',
      'top:0;left:0;width:0;height:0',
    ].join(';');
    document.body.appendChild(overlay);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function stop(): void {
    if (!active) return;
    active = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    overlay?.remove();
    overlay = null;
  }

  return { start, stop };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/picker.test.ts`
Expected: PASS (4 tests).

> 참고: jsdom 은 `getBoundingClientRect` 가 0 을 반환하지만, moveOverlay 는 throw 하지 않으므로 테스트는 통과한다(좌표값은 검증하지 않음).

- [ ] **Step 5: 커밋**

```bash
git add src/inspect/picker.ts tests/picker.test.ts
git commit -m "feat(inspect): hover+click element picker controller"
```

---

## Task 5: content 배선

**Files:**
- Modify: `src/content/index.ts`

- [ ] **Step 1: import 교체 — `src/content/index.ts` 상단**

파일 상단 import 두 줄을 다음 네 줄로 교체:
```ts
import { CMD_SOURCE, isInjectEnvelope } from '../messaging';
import type { CmdEnvelope, RuntimeMessage } from '../messaging/types';
import { createPicker } from '../inspect/picker';
import { buildElementInfo, type StyleLike } from '../inspect/element-info';
```

- [ ] **Step 2: 피커 setup 블록 추가 — `requestResync` 함수 정의 바로 아래**

기존 `requestResync` 함수(`function requestResync() { ... }`) 정의 **바로 다음 줄**에 삽입(window message 리스너보다 위에 와서 아래 onMessage 리스너가 참조하는 `picker` 가 먼저 정의되도록):
```ts
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
    margin: c.margin,
    padding: c.padding,
    borderRadius: c.borderRadius,
    border: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`,
  };
}

const picker = createPicker(
  (el) => {
    const info = buildElementInfo(el, styleOf(el));
    // e2e 관측용 마킹
    document.documentElement.dataset.qaxtensionPicked = info.selector;
    const msg: RuntimeMessage = { type: 'ELEMENT_PICKED', info };
    void chrome.runtime.sendMessage(msg).catch(() => {});
  },
  () => {
    const msg: RuntimeMessage = { type: 'PICK_CANCELLED' };
    void chrome.runtime.sendMessage(msg).catch(() => {});
  },
);
```

- [ ] **Step 3: onMessage 리스너 전체 교체 (PICK_START/STOP 분기 포함)**

기존 `chrome.runtime.onMessage.addListener(...)` 블록 전체를 다음으로 교체:
```ts
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
    picker.start();
  } else if (msg.type === 'PICK_STOP') {
    picker.stop();
  }
});
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: exit 0.
Run: `npm test`
Expected: 기존 단위 테스트 전부 통과 (이 task 는 단위 테스트 추가 없음).

- [ ] **Step 5: 커밋**

```bash
git add src/content/index.ts
git commit -m "feat(content): wire element picker (PICK_START/STOP, ELEMENT_PICKED)"
```

---

## Task 6: background 배선

**Files:**
- Modify: `src/background/index.ts`

- [ ] **Step 1: content→background 메시지 라우팅 확장**

`chrome.runtime.onMessage.addListener` 의 `switch (msg.type)` 안, `case 'PING_REPLY'` 블록 다음에 추가:
```ts
    case 'ELEMENT_PICKED':
      updateTabState(tabId, { pickedElement: msg.info, picking: false });
      pushState(tabId);
      break;
    case 'PICK_CANCELLED':
      updateTabState(tabId, { picking: false });
      pushState(tabId);
      break;
```

- [ ] **Step 2: 패널→background Port 메시지 라우팅 확장 (전체 핸들러 교체)**

`port.onMessage.addListener((msg: PortMessage) => { ... })` 의 콜백 본문 전체를 다음으로 교체(기존 SUBSCRIBE/PING 분기는 그대로 두고 PICK_START/PICK_STOP 분기를 추가한 형태):
```ts
  port.onMessage.addListener((msg: PortMessage) => {
    if (msg.type === 'SUBSCRIBE') {
      boundTab = msg.tabId;
      let set = panelPorts.get(msg.tabId);
      if (!set) {
        set = new Set();
        panelPorts.set(msg.tabId, set);
      }
      set.add(port);
      port.postMessage({ type: 'STATE_UPDATE', state: getTabState(msg.tabId) } satisfies PortMessage);
      // 살아있는 content/inject 에게 현재 readiness 재확인 요청.
      const resync: RuntimeMessage = { type: 'RESYNC' };
      chrome.tabs.sendMessage(msg.tabId, resync).catch(() => {});
    } else if (msg.type === 'PING') {
      const n = nonce();
      pendingNonces.set(msg.tabId, n);
      updateTabState(msg.tabId, { lastPingNonce: null });
      const cmd: RuntimeMessage = { type: 'PING', nonce: n };
      chrome.tabs.sendMessage(msg.tabId, cmd).catch(() => {});
    } else if (msg.type === 'PICK_START') {
      updateTabState(msg.tabId, { picking: true, pickedElement: null });
      const cmd: RuntimeMessage = { type: 'PICK_START' };
      chrome.tabs.sendMessage(msg.tabId, cmd).catch(() => {});
      pushState(msg.tabId);
    } else if (msg.type === 'PICK_STOP') {
      updateTabState(msg.tabId, { picking: false });
      const cmd: RuntimeMessage = { type: 'PICK_STOP' };
      chrome.tabs.sendMessage(msg.tabId, cmd).catch(() => {});
      pushState(msg.tabId);
    }
  });
```

- [ ] **Step 2b: 빌드 확인**

Run: `npm run build`
Expected: exit 0. (`RuntimeMessage` 에 PICK_START/STOP 가 있으므로 타입 통과. `switch` 에 새 case 추가로 exhaustiveness 문제 없음 — default 없이 무시.)

- [ ] **Step 3: 커밋**

```bash
git add src/background/index.ts
git commit -m "feat(background): route picker messages + picked element into store"
```

---

## Task 7: 사이드 패널 검사 UI

**Files:**
- Create: `src/sidepanel/InspectPanel.tsx`
- Modify: `src/sidepanel/App.tsx`

- [ ] **Step 1: 구현 — `src/sidepanel/InspectPanel.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { ElementInfo } from '../messaging/types';

interface Props {
  picking: boolean;
  picked: ElementInfo | null;
  onTogglePick: () => void;
}

function Swatch({ hex }: { hex: string }) {
  const isTransparent = hex === 'transparent';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: 2,
        marginRight: 6,
        verticalAlign: 'middle',
        border: '1px solid #ccc',
        background: isTransparent ? 'none' : hex,
      }}
    />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12 }}>
      <span style={{ minWidth: 92, color: '#666' }}>{label}</span>
      <span style={{ wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#333' }}>{title}</h3>
      {children}
    </section>
  );
}

export function InspectPanel({ picking, picked, onTogglePick }: Props) {
  return (
    <div>
      <button onClick={onTogglePick} style={{ fontWeight: picking ? 700 : 400 }}>
        {picking ? '선택 중지 (ESC)' : '요소 선택'}
      </button>

      {!picked && (
        <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>
          {picking ? '페이지에서 검사할 요소를 클릭하세요.' : '“요소 선택”을 눌러 시작하세요.'}
        </p>
      )}

      {picked && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#0a58ca', wordBreak: 'break-all' }}>
            {picked.selector}
          </div>
          {picked.text && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>“{picked.text}”</div>
          )}

          <Section title="색상">
            <Row label="텍스트"><Swatch hex={picked.colors.color.hex} />{picked.colors.color.hex}</Row>
            <Row label="배경"><Swatch hex={picked.colors.backgroundColor.hex} />{picked.colors.backgroundColor.hex}</Row>
            <Row label="테두리"><Swatch hex={picked.colors.borderColor.hex} />{picked.colors.borderColor.hex}</Row>
          </Section>

          <Section title="타이포그래피">
            <Row label="글꼴">{picked.typography.fontFamily}</Row>
            <Row label="크기">{picked.typography.fontSize}</Row>
            <Row label="굵기">{picked.typography.fontWeight}</Row>
            <Row label="줄 높이">{picked.typography.lineHeight}</Row>
            <Row label="자간">{picked.typography.letterSpacing}</Row>
          </Section>

          <Section title="박스모델">
            <Row label="크기">{picked.boxModel.width} × {picked.boxModel.height}</Row>
            <Row label="여백(margin)">{picked.boxModel.margin}</Row>
            <Row label="안쪽(padding)">{picked.boxModel.padding}</Row>
            <Row label="모서리">{picked.boxModel.borderRadius}</Row>
            <Row label="테두리">{picked.boxModel.border}</Row>
          </Section>

          <Section title="접근성">
            <Row label="대비비">
              {picked.accessibility.contrast
                ? `${picked.accessibility.contrast.ratio} (${picked.accessibility.contrast.level})`
                : '계산 불가 (배경 투명)'}
            </Row>
            <Row label="alt">{picked.accessibility.alt ?? '—'}</Row>
            <Row label="role">{picked.accessibility.role ?? '—'}</Row>
            <Row label="aria-label">{picked.accessibility.ariaLabel ?? '—'}</Row>
          </Section>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `src/sidepanel/App.tsx` 수정 — 검사 탭에 InspectPanel 연결**

App.tsx 의 import 에 추가:
```tsx
import { InspectPanel } from './InspectPanel';
```

`ping` 함수 정의 바로 아래에 픽 토글 핸들러 추가:
```tsx
  const togglePick = () => {
    if (!portRef.current || tabId == null) return;
    const type = state?.picking ? 'PICK_STOP' : 'PICK_START';
    portRef.current.postMessage({ type, tabId } satisfies PortMessage);
  };
```

기존 `<main>` 블록을 다음으로 교체:
```tsx
      <main>
        {active === '검사' ? (
          <InspectPanel
            picking={state?.picking ?? false}
            picked={state?.pickedElement ?? null}
            onTogglePick={togglePick}
          />
        ) : (
          <p style={{ color: '#999' }}>{active} 패널 — 이후 Phase에서 구현</p>
        )}
      </main>
```

- [ ] **Step 3: 빌드 + 단위 테스트 확인**

Run: `npm run build`
Expected: exit 0.
Run: `npm test`
Expected: 전체 단위 테스트 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/sidepanel/InspectPanel.tsx src/sidepanel/App.tsx
git commit -m "feat(sidepanel): element inspector tab (colors/typography/box/a11y)"
```

---

## Task 8: e2e + 수동 검증

**Files:**
- Create: `e2e/inspect.spec.ts`

- [ ] **Step 1: 작성 — `e2e/inspect.spec.ts`**

```ts
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(dir, '../dist');

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
});

test.afterAll(async () => {
  await context?.close();
});

// 패널 UI 는 자동화 불가하므로, 서비스 워커에서 PICK_START 를 content 로 보내고
// 페이지 요소를 클릭해 피커 배선(오버레이 삽입 → 클릭 → 선택 마킹)을 검증한다.
test('picker overlays, captures a clicked element, and records its selector', async () => {
  const page = await context.newPage();
  // 실제 https 페이지여야 content script 가 주입된다 (about:blank/setContent 는 미주입).
  await page.goto('https://example.com');
  // content/inject 가 주입될 시간을 확보
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionContent))
    .toBe('ready');
  // 주입 확인 후 테스트용 타겟 요소를 삽입 (id 가 있어 cssPath 가 '#cta' 를 반환)
  await page.evaluate(() => {
    document.body.innerHTML = '<button id="cta">눌러</button>';
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');

  // background 경유로 PICK_START 전송
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    for (const t of tabs) if (t.id != null) void chrome.tabs.sendMessage(t.id, { type: 'PICK_START' });
  });

  // 오버레이가 삽입됐는지
  await expect
    .poll(() => page.evaluate(() => !!document.querySelector('[data-qaxtension-overlay]')))
    .toBe(true);

  // 대상 요소 클릭
  await page.click('#cta');

  // content 가 선택 결과를 마킹했는지 (selector = '#cta')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.qaxtensionPicked))
    .toBe('#cta');

  // 클릭 후 오버레이는 제거됨
  expect(
    await page.evaluate(() => !!document.querySelector('[data-qaxtension-overlay]')),
  ).toBe(false);
});
```

- [ ] **Step 2: 빌드 + e2e 실행**

Run: `npm run build && npx playwright test e2e/inspect.spec.ts`
Expected: 1 passed.
Run: `npx playwright test`
Expected: 모든 e2e 통과 (smoke + resync + inspect).

- [ ] **Step 3: 수동 검증 (사용자 확인 항목)**

1. `npm run build` 후 `chrome://extensions` 에서 확장 새로고침.
2. 임의 페이지에서 패널 열기 → **검사** 탭 → **요소 선택** 클릭.
3. 페이지 위에서 마우스를 움직이면 요소가 파란 외곽선으로 하이라이트되는지.
4. 한 요소를 클릭하면 → 패널에 selector·색상(스와치+HEX)·타이포그래피·박스모델·접근성(대비비 등급)이 표시되는지.
5. **요소 선택**을 다시 켜고 **ESC** 를 누르면 선택이 취소되고 버튼이 해제되는지.
6. 페이지 새로고침 시 선택 결과가 초기화되는지.

- [ ] **Step 4: 커밋**

```bash
git add e2e/inspect.spec.ts
git commit -m "test(e2e): element picker wiring (overlay, click capture, selector)"
```

---

## Phase 1 완료 기준 (Definition of Done)

- `npm run build` 성공
- `npm test` — colors / element-info / picker / messaging / store 단위 테스트 전부 통과
- `npm run e2e` — smoke + resync + inspect 통과
- 수동 검증(Task 8 Step 3) 통과: 호버 하이라이트 → 클릭 선택 → 4개 섹션 표시 → ESC 취소
- 모든 커밋 푸시 완료

## 비범위 (Phase 1 Non-goals)

- iframe 내부 요소 검사 (manifest `all_frames: false`)
- 투명 배경의 실제(상위) 배경색 추적을 통한 대비비 — Phase 5
- 선택 정보의 클립보드 복사/리포트 첨부 — Phase 4
- 다중 요소 비교, 스타일 편집 — 범위 외
