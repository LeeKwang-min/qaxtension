import type { InteractionEvent, Step } from '../messaging/types';

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

/**
 * 네비게이션 시 누적 스텝에 navigate 스텝을 이어붙인다. 직전이 같은 URL navigate 면
 * 그대로 반환(리다이렉트 연쇄에서 navigate 가 중복으로 쌓이는 것 방지).
 */
export function appendNavigate(steps: Step[], url: string, id: string, now: number): Step[] {
  const last = steps[steps.length - 1];
  if (last && last.kind === 'navigate' && last.value === url) return steps;
  return pushStep(
    steps,
    stepFromEvent(
      { kind: 'navigate', selector: null, label: null, value: url, context: null, nearby: [], at: now },
      id,
    ),
  );
}

/** 표시용 대상 이름 (라벨 우선, 없으면 선택자, 둘 다 없으면 '요소') */
function targetName(step: Step): string {
  if (step.label && step.label.trim()) return step.label.trim();
  if (step.selector) return step.selector;
  return '요소';
}

/** kind별 동작 문장 (영역 컨텍스트 제외) */
function actionPhrase(step: Step): string {
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

/** 스텝 한 건 → 사람이 읽는 한국어 문장 (영역이 있으면 " — 영역" 덧붙임) */
export function describeStep(step: Step): string {
  const base = actionPhrase(step);
  return step.context ? `${base} — ${step.context}` : base;
}

/**
 * 스텝 목록 → 리포트 "## 재현 절차" 마크다운 섹션.
 * 각 단계 아래에 선택자(정확한 요소 특정)와 주변 텍스트(위치 단서)를 하위 항목으로 단다.
 */
export function buildStepsSection(steps: Step[]): string {
  if (steps.length === 0) return '## 재현 절차\n\n_기록된 행동 없음_';
  const lines: string[] = ['## 재현 절차', ''];
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${describeStep(s)}`);
    if (s.selector) lines.push(`   - 선택자: \`${s.selector}\``);
    if (s.nearby.length > 0) {
      lines.push(`   - 주변: ${s.nearby.map((t) => `"${t}"`).join(', ')}`);
    }
  });
  return lines.join('\n');
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

/**
 * 요소를 특정하는 풍부한 선택자 시그니처 — 태그#id.클래스[name/type].
 * '확인' 같은 흔한 버튼도 어느 요소였는지 짚을 수 있게 한다.
 */
export function elementSignature(el: Element): string {
  const tag = el.tagName.toLowerCase();
  let sig = tag;
  if (el.id) sig += `#${el.id}`;
  sig += Array.from(el.classList)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join('');
  const name = el.getAttribute('name');
  if (name) {
    sig += `[name=${name}]`;
  } else {
    const type = el.getAttribute('type');
    if (type && (tag === 'input' || tag === 'button')) sig += `[type=${type}]`;
  }
  return sig;
}

// 의미 있는 "영역" 으로 인정할 컨테이너 (단순 div 는 제외)
const REGION_SELECTOR =
  'dialog,[role="dialog"],[role="region"],[role="tabpanel"],[role="group"],form,section,article,nav,aside,header,footer,main,fieldset';

// 영역 종류 → 사람이 읽는 접미어 ("로그인" + "모달")
const REGION_TYPE_WORD: Record<string, string> = {
  dialog: '모달',
  form: '폼',
  nav: '내비게이션',
  header: '헤더',
  footer: '푸터',
  aside: '사이드',
  section: '섹션',
  article: '섹션',
  main: '본문',
  fieldset: '입력 그룹',
};

function regionTypeWord(el: Element): string | null {
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'dialog') return '모달';
  if (role === 'region' || role === 'group' || role === 'tabpanel') return '영역';
  return REGION_TYPE_WORD[el.tagName.toLowerCase()] ?? null;
}

/** 영역 컨테이너의 이름 (aria-label → aria-labelledby → 내부 제목/legend, 없으면 null) */
function regionLabel(el: Element): string | null {
  const aria = cleanLabel(el.getAttribute('aria-label'));
  if (aria) return aria;
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const text = lb
      .split(/\s+/)
      .map((id) => el.ownerDocument?.getElementById(id)?.textContent ?? '')
      .join(' ');
    const t = cleanLabel(text);
    if (t) return t;
  }
  const heading = el.querySelector('h1,h2,h3,h4,h5,h6,legend,[role="heading"]');
  return cleanLabel(heading?.textContent);
}

// 주변 텍스트로 모을 후보 (라벨·버튼·제목류)
const NEARBY_SELECTOR =
  'button,a[href],label,legend,h1,h2,h3,h4,h5,h6,[role="button"],[role="heading"],summary,th';

/** 같은 영역에서 요소 자신을 뺀 다른 라벨/버튼 텍스트 (최대 5개, 위치 단서) */
function nearbyTexts(el: Element, scope: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const cands = scope.querySelectorAll(NEARBY_SELECTOR);
  for (let i = 0; i < cands.length && out.length < 5; i++) {
    const c = cands[i];
    if (c === el || c.contains(el)) continue; // 자신·자신을 감싼 라벨 제외
    const t = cleanLabel(c.textContent);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 요소가 속한 가장 가까운 의미 있는 영역의 이름 + 그 영역의 주변 텍스트.
 * 영역이 없으면 context=null, nearby=[] (페이지 전역 스캔으로 노이즈 내지 않음).
 */
function elementContext(el: Element): { context: string | null; nearby: string[] } {
  let scope: Element | null = null;
  let context: string | null = null;
  let cur = el.parentElement;
  while (cur && cur.tagName.toLowerCase() !== 'body' && cur.tagName.toLowerCase() !== 'html') {
    if (cur.matches(REGION_SELECTOR)) {
      if (!scope) scope = cur; // 가장 가까운 영역 = 주변 텍스트 범위
      const name = regionLabel(cur);
      const word = regionTypeWord(cur);
      if (name) context = word ? `${name} ${word}` : name;
      else if (cur.id) context = word ? `#${cur.id} ${word}` : `#${cur.id}`;
      if (context) break;
    }
    cur = cur.parentElement;
  }
  return { context, nearby: scope ? nearbyTexts(el, scope) : [] };
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
  const { context, nearby } = elementContext(clickable);
  return {
    kind: 'click',
    selector: elementSignature(clickable),
    label: labelOf(clickable),
    value: null,
    context,
    nearby,
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
  const selector = elementSignature(el);
  const label = labelOf(el);
  const { context, nearby } = elementContext(el);
  if (kind === 'check') {
    const checked = (el as HTMLInputElement).checked;
    return { kind: 'check', selector, label, value: checked ? 'on' : 'off', context, nearby, at: now };
  }
  if (kind === 'select') {
    const sel = el as HTMLSelectElement;
    const opt = sel.selectedOptions?.[0] ?? sel.options[sel.selectedIndex];
    const text = cleanLabel(opt?.textContent) ?? cleanLabel(sel.value) ?? '';
    return { kind: 'select', selector, label, value: text, context, nearby, at: now };
  }
  // text / textarea
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  const isPassword = el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') ?? '').toLowerCase() === 'password';
  return { kind: 'input', selector, label, value: maskValue(field.value ?? '', isPassword), context, nearby, at: now };
}
