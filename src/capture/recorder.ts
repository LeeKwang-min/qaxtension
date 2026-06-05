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
