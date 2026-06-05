import { describe, it, expect } from 'vitest';
import {
  maskValue,
  stepFromEvent,
  pushStep,
  describeStep,
  buildStepsSection,
  MAX_STEPS,
  MAX_VALUE,
} from '../src/capture/recorder';
import type { InteractionEvent, Step } from '../src/messaging/types';

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
