import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  maskValue,
  stepFromEvent,
  pushStep,
  describeStep,
  buildStepsSection,
  labelOf,
  interactionFromClick,
  interactionFromChange,
  MAX_STEPS,
  MAX_VALUE,
} from '../src/capture/recorder';
import type { InteractionEvent, Step } from '../src/messaging/types';

function doc(html: string): Document {
  return new JSDOM(html, { url: 'https://site.test/page' }).window.document;
}
function q(html: string, sel: string): Element {
  const d = doc(html);
  const el = d.querySelector(sel);
  if (!el) throw new Error(`no element for ${sel}`);
  return el;
}

function ev(p: Partial<InteractionEvent>): InteractionEvent {
  return { kind: 'click', selector: 'button', label: null, value: null, at: 0, ...p };
}
function step(p: Partial<Step>): Step {
  return { id: 's1', ...ev(p) } as Step;
}

describe('recorder — maskValue', () => {
  it('masks password values regardless of content', () => {
    expect(maskValue('hunter2', true)).not.toContain('hunter2');
    expect(maskValue('', true).length).toBeGreaterThan(0);
  });

  it('passes through short non-password values', () => {
    expect(maskValue('a@b.com', false)).toBe('a@b.com');
  });

  it('truncates long non-password values', () => {
    const long = 'x'.repeat(MAX_VALUE + 50);
    const out = maskValue(long, false);
    expect(out.length).toBeLessThanOrEqual(MAX_VALUE + 1); // +1 for ellipsis
    expect(out).not.toBe(long);
  });
});

describe('recorder — stepFromEvent', () => {
  it('attaches id and preserves fields', () => {
    const s = stepFromEvent(ev({ kind: 'input', selector: '#email', value: 'a' }), 'id-1');
    expect(s.id).toBe('id-1');
    expect(s.kind).toBe('input');
    expect(s.selector).toBe('#email');
    expect(s.value).toBe('a');
  });
});

describe('recorder — pushStep', () => {
  it('appends distinct steps', () => {
    const out = pushStep(pushStep([], step({ id: 'a', kind: 'click' })), step({ id: 'b', kind: 'click', selector: 'a.link' }));
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('coalesces consecutive input on same selector (keeps latest value)', () => {
    let list: Step[] = [];
    list = pushStep(list, step({ id: '1', kind: 'input', selector: '#email', value: 'a' }));
    list = pushStep(list, step({ id: '2', kind: 'input', selector: '#email', value: 'ab', at: 5 }));
    expect(list).toHaveLength(1);
    expect(list[0].value).toBe('ab');
    expect(list[0].at).toBe(5);
  });

  it('does not coalesce input on different selectors', () => {
    let list: Step[] = [];
    list = pushStep(list, step({ id: '1', kind: 'input', selector: '#a', value: 'x' }));
    list = pushStep(list, step({ id: '2', kind: 'input', selector: '#b', value: 'y' }));
    expect(list).toHaveLength(2);
  });

  it('does not coalesce clicks', () => {
    let list: Step[] = [];
    list = pushStep(list, step({ id: '1', kind: 'click', selector: '#a' }));
    list = pushStep(list, step({ id: '2', kind: 'click', selector: '#a' }));
    expect(list).toHaveLength(2);
  });

  it('enforces MAX_STEPS bound dropping oldest', () => {
    let list: Step[] = [];
    for (let i = 0; i < MAX_STEPS + 10; i++) {
      list = pushStep(list, step({ id: `c${i}`, kind: 'click', selector: `#n${i}` }));
    }
    expect(list).toHaveLength(MAX_STEPS);
    expect(list[0].id).toBe('c10');
  });
});

describe('recorder — describeStep', () => {
  it('describes each kind in Korean', () => {
    expect(describeStep(step({ kind: 'click', label: '로그인' }))).toBe('"로그인" 클릭');
    expect(describeStep(step({ kind: 'input', label: '이메일', value: 'a@b.com' }))).toBe('"이메일" 에 "a@b.com" 입력');
    expect(describeStep(step({ kind: 'select', label: '국가', value: '한국' }))).toBe('"국가" 에서 "한국" 선택');
    expect(describeStep(step({ kind: 'check', label: '약관', value: 'on' }))).toBe('"약관" 체크');
    expect(describeStep(step({ kind: 'check', label: '약관', value: 'off' }))).toBe('"약관" 체크 해제');
    expect(describeStep(step({ kind: 'navigate', selector: null, value: 'https://x.test/login' }))).toContain('https://x.test/login');
  });

  it('falls back to selector when label missing', () => {
    expect(describeStep(step({ kind: 'click', label: null, selector: 'div.card' }))).toBe('"div.card" 클릭');
  });
});

describe('recorder — buildStepsSection', () => {
  it('renders empty state', () => {
    expect(buildStepsSection([])).toBe('## 재현 절차\n\n_기록된 행동 없음_');
  });

  it('renders a numbered list', () => {
    const md = buildStepsSection([
      step({ id: '1', kind: 'navigate', selector: null, value: 'https://x.test' }),
      step({ id: '2', kind: 'click', label: '로그인' }),
      step({ id: '3', kind: 'input', label: '이메일', value: 'a@b.com' }),
    ]);
    expect(md).toContain('## 재현 절차');
    expect(md).toContain('1. 페이지 이동 → https://x.test');
    expect(md).toContain('2. "로그인" 클릭');
    expect(md).toContain('3. "이메일" 에 "a@b.com" 입력');
  });
});

describe('recorder — labelOf (DOM)', () => {
  it('uses button text', () => {
    expect(labelOf(q('<button>로그인</button>', 'button'))).toBe('로그인');
  });

  it('prefers aria-label over text', () => {
    expect(labelOf(q('<button aria-label="닫기"><span>×</span></button>', 'button'))).toBe('닫기');
  });

  it('uses associated label[for] for an input', () => {
    expect(labelOf(q('<label for="em">이메일</label><input id="em">', 'input'))).toBe('이메일');
  });

  it('uses a wrapping label for an input', () => {
    expect(labelOf(q('<label>비밀번호 <input type="password"></label>', 'input'))).toBe('비밀번호');
  });

  it('falls back to placeholder then name', () => {
    expect(labelOf(q('<input placeholder="검색어">', 'input'))).toBe('검색어');
    expect(labelOf(q('<input name="q">', 'input'))).toBe('q');
  });

  it('returns null when no label source exists', () => {
    expect(labelOf(q('<input>', 'input'))).toBeNull();
  });
});

describe('recorder — interactionFromClick (DOM)', () => {
  it('records clicks on buttons with selector + label', () => {
    const e = interactionFromClick(q('<button id="login">로그인</button>', 'button'), 7);
    expect(e).not.toBeNull();
    expect(e!.kind).toBe('click');
    expect(e!.selector).toBe('#login');
    expect(e!.label).toBe('로그인');
    expect(e!.at).toBe(7);
  });

  it('records a click when target is inside a button (closest clickable)', () => {
    const e = interactionFromClick(q('<button>저장<svg class="ico"></svg></button>', '.ico'), 0);
    expect(e?.kind).toBe('click');
    expect(e?.label).toBe('저장');
  });

  it('records links and role=button', () => {
    expect(interactionFromClick(q('<a href="/x">about</a>', 'a'), 0)?.kind).toBe('click');
    expect(interactionFromClick(q('<div role="button">메뉴</div>', 'div'), 0)?.label).toBe('메뉴');
  });

  it('ignores clicks on text inputs (covered by change) and plain elements', () => {
    expect(interactionFromClick(q('<input type="text">', 'input'), 0)).toBeNull();
    expect(interactionFromClick(q('<p>hello</p>', 'p'), 0)).toBeNull();
  });

  it('ignores clicks on checkbox/radio (recorded via change as check)', () => {
    expect(interactionFromClick(q('<input type="checkbox">', 'input'), 0)).toBeNull();
  });
});

describe('recorder — interactionFromChange (DOM)', () => {
  it('records text input value', () => {
    const el = q('<input type="text" name="email">', 'input') as HTMLInputElement;
    el.value = 'a@b.com';
    const e = interactionFromChange(el, 3);
    expect(e?.kind).toBe('input');
    expect(e?.value).toBe('a@b.com');
    expect(e?.label).toBe('email');
    expect(e?.at).toBe(3);
  });

  it('masks password input value', () => {
    const el = q('<input type="password" name="pw">', 'input') as HTMLInputElement;
    el.value = 'hunter2';
    const e = interactionFromChange(el, 0);
    expect(e?.kind).toBe('input');
    expect(e?.value).not.toContain('hunter2');
  });

  it('records select as selected option text', () => {
    const el = q('<select name="c"><option value="kr">한국</option><option value="us">미국</option></select>', 'select') as HTMLSelectElement;
    el.value = 'us';
    const e = interactionFromChange(el, 0);
    expect(e?.kind).toBe('select');
    expect(e?.value).toBe('미국');
  });

  it('records checkbox as on/off check', () => {
    const el = q('<input type="checkbox">', 'input') as HTMLInputElement;
    el.checked = true;
    expect(interactionFromChange(el, 0)?.kind).toBe('check');
    expect(interactionFromChange(el, 0)?.value).toBe('on');
    el.checked = false;
    expect(interactionFromChange(el, 0)?.value).toBe('off');
  });

  it('ignores change on non-form elements', () => {
    expect(interactionFromChange(q('<div></div>', 'div'), 0)).toBeNull();
  });
});
