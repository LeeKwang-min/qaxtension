import type { InteractionEvent, Step } from '../messaging/types';
import { cssPath } from '../inspect/element-info';

/** tabId별 보관 스텝 상한 (메모리 보호) */
export const MAX_STEPS = 500;
/** 기록 값 절단 상한 (문자 수) */
export const MAX_VALUE = 60;
/** password 필드 마스킹 표기 */
const PASSWORD_MASK = '••••••';

/**
 * 기록 값 가공. password 타입은 내용과 무관하게 마스킹하고,
 * 그 외 긴 값은 절단해 리포트에 민감/장황한 데이터가 새는 것을 막는다.
 */
export function maskValue(value: string, isPassword: boolean): string {
  if (isPassword) return PASSWORD_MASK;
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
}

/** InteractionEvent → id 가 부여된 Step */
export function stepFromEvent(e: InteractionEvent, id: string): Step {
  return { ...e, id };
}

/** 같은 필드에 대한 연속 입력/선택인지 (병합 대상) */
function isCoalescable(last: Step, next: Step): boolean {
  return (
    (next.kind === 'input' || next.kind === 'select') &&
    last.kind === next.kind &&
    next.selector !== null &&
    last.selector === next.selector
  );
}

/**
 * 스텝을 목록에 추가. 직전 스텝이 같은 필드의 input/select 면 값만 갱신(연속 타이핑
 * 병합), 아니면 append + 상한(초과 시 가장 오래된 것 제거). 불변 반환.
 */
export function pushStep(list: Step[], step: Step): Step[] {
  const last = list[list.length - 1];
  if (last && isCoalescable(last, step)) {
    const merged: Step = { ...last, value: step.value, at: step.at };
    const next = list.slice(0, -1);
    next.push(merged);
    return next;
  }
  let next = [...list, step];
  if (next.length > MAX_STEPS) next = next.slice(next.length - MAX_STEPS);
  return next;
}

/** 표시용 대상 이름 (라벨 우선, 없으면 선택자, 둘 다 없으면 '요소') */
function targetName(step: Step): string {
  if (step.label && step.label.trim()) return step.label.trim();
  if (step.selector) return step.selector;
  return '요소';
}

/** 스텝 한 건 → 사람이 읽는 한국어 문장 */
export function describeStep(step: Step): string {
  const t = targetName(step);
  switch (step.kind) {
    case 'click':
      return `"${t}" 클릭`;
    case 'input':
      return `"${t}" 에 "${step.value ?? ''}" 입력`;
    case 'select':
      return `"${t}" 에서 "${step.value ?? ''}" 선택`;
    case 'check':
      return `"${t}" ${step.value === 'on' ? '체크' : '체크 해제'}`;
    case 'navigate':
      return `페이지 이동 → ${step.value ?? ''}`;
  }
}

/** 스텝 목록 → 리포트 "## 재현 절차" 마크다운 섹션 */
export function buildStepsSection(steps: Step[]): string {
  if (steps.length === 0) return '## 재현 절차\n\n_기록된 행동 없음_';
  const items = steps.map((s, i) => `${i + 1}. ${describeStep(s)}`);
  return ['## 재현 절차', '', ...items].join('\n');
}

// ── DOM 추출 (content 가 실제 이벤트 요소로 호출, jsdom 단위 테스트) ─────

/** 라벨 텍스트 정규화 (공백 접고 절단) */
function cleanLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > MAX_VALUE ? `${t.slice(0, MAX_VALUE)}…` : t;
}

function isField(el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea';
}

/** 폼 필드의 연결 라벨 (aria-label → 연결 label → placeholder → name) */
function fieldLabel(el: Element): string | null {
  const aria = cleanLabel(el.getAttribute('aria-label'));
  if (aria) return aria;
  // HTMLInputElement.labels 는 label[for] 와 감싼 label 을 모두 포함
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    const t = cleanLabel(labels[0].textContent);
    if (t) return t;
  }
  const ph = cleanLabel(el.getAttribute('placeholder'));
  if (ph) return ph;
  return cleanLabel(el.getAttribute('name'));
}

/** 클릭형 요소의 라벨 (텍스트 → aria-label → title → value) */
function clickableLabel(el: Element): string | null {
  const aria = cleanLabel(el.getAttribute('aria-label'));
  if (aria) return aria;
  const text = cleanLabel(el.textContent);
  if (text) return text;
  const title = cleanLabel(el.getAttribute('title'));
  if (title) return title;
  return cleanLabel(el.getAttribute('value'));
}

/** 요소의 사람이 읽는 라벨 (폼 필드/클릭형 구분, 없으면 null) */
export function labelOf(el: Element): string | null {
  return isField(el) ? fieldLabel(el) : clickableLabel(el);
}

/** input 의 입력 타입 분류 */
function inputKind(el: Element): 'text' | 'check' | 'select' | 'ignore' {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'text';
  if (tag === 'select') return 'select';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return 'check';
    // 버튼류는 click 으로 다룬다
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'ignore';
    return 'text';
  }
  return 'ignore';
}

/** 클릭으로 기록할 컨트롤 (텍스트 입력·체크박스는 제외 — change 가 담당) */
const CLICK_SELECTOR =
  'button, a[href], [role="button"], input[type="submit"], input[type="button"]';

/**
 * 클릭 이벤트 대상 → InteractionEvent. 클릭형 컨트롤(또는 그 안쪽)이 아니면 null.
 * 텍스트 입력/체크박스/라디오 클릭은 change 핸들러가 담당하므로 무시한다.
 */
export function interactionFromClick(el: Element, now: number): InteractionEvent | null {
  const clickable = el.closest(CLICK_SELECTOR);
  if (!clickable) return null;
  return {
    kind: 'click',
    selector: cssPath(clickable),
    label: labelOf(clickable),
    value: null,
    at: now,
  };
}

/**
 * change 이벤트 대상(입력/선택/체크) → InteractionEvent. 폼 필드가 아니면 null.
 * password 값은 마스킹, select 는 선택된 옵션 텍스트, checkbox/radio 는 on/off.
 */
export function interactionFromChange(el: Element, now: number): InteractionEvent | null {
  const kind = inputKind(el);
  if (kind === 'ignore') return null;
  const selector = cssPath(el);
  const label = labelOf(el);
  if (kind === 'check') {
    const checked = (el as HTMLInputElement).checked;
    return { kind: 'check', selector, label, value: checked ? 'on' : 'off', at: now };
  }
  if (kind === 'select') {
    const sel = el as HTMLSelectElement;
    const opt = sel.selectedOptions?.[0] ?? sel.options[sel.selectedIndex];
    const text = cleanLabel(opt?.textContent) ?? cleanLabel(sel.value) ?? '';
    return { kind: 'select', selector, label, value: text, at: now };
  }
  // text / textarea
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  const isPassword = el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') ?? '').toLowerCase() === 'password';
  return { kind: 'input', selector, label, value: maskValue(field.value ?? '', isPassword), at: now };
}
