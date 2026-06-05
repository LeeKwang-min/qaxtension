import type { A11yIssue } from '../messaging/types';
import { cssPath } from '../inspect/element-info';
import { rgbTuple, parseColorToHex, contrastRatio, wcagLevel } from '../inspect/colors';

/** 대비 계산에 필요한 computed style 일부 (테스트 주입용) */
export interface ContrastStyle {
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
}

/** label/aria/title/text 등으로 접근가능 이름이 있는지 best-effort 판정 */
function hasAccessibleName(el: Element): boolean {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return true;
  if (el.getAttribute('aria-labelledby')?.trim()) return true;
  const title = el.getAttribute('title');
  if (title && title.trim()) return true;
  if (el.textContent && el.textContent.trim()) return true;
  // 버튼/링크 안의 이미지 alt 도 이름이 된다
  const img = el.querySelector('img[alt]');
  if (img && (img.getAttribute('alt') ?? '').trim()) return true;
  return false;
}

/** 텍스트 입력류인지 (label 검사 대상) */
function isLabelableInput(el: Element): boolean {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return !['hidden', 'submit', 'button', 'reset', 'image'].includes(type);
}

/** input 에 연결된 label/aria 가 있는지 */
function hasInputLabel(el: Element, doc: Document): boolean {
  if (el.getAttribute('aria-label')?.trim()) return true;
  if (el.getAttribute('aria-labelledby')?.trim()) return true;
  if (el.getAttribute('title')?.trim()) return true;
  if (el.closest('label')) return true;
  const id = el.getAttribute('id');
  if (id) {
    // CSS.escape 가 jsdom 에 없을 수 있어 속성 선택자로 안전하게 조회
    const labels = doc.querySelectorAll('label[for]');
    for (const l of labels) if (l.getAttribute('for') === id) return true;
  }
  return false;
}

function contrastFail(style: ContrastStyle): boolean {
  const fg = rgbTuple(style.color);
  const bg = rgbTuple(style.backgroundColor);
  if (!fg || !bg || parseColorToHex(style.backgroundColor) === 'transparent') return false;
  const ratio = contrastRatio(fg, bg);
  const sizePx = parseFloat(style.fontSize) || 16;
  const bold = parseInt(style.fontWeight, 10) >= 700;
  return wcagLevel(ratio, sizePx, bold) === 'Fail';
}

/** 자식 요소 없이 직접 텍스트를 가진 요소인지 (대비 검사 대상) */
function hasOwnText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? '').trim()) return true;
  }
  return false;
}

/**
 * 페이지 DOM 을 접근성 관점에서 best-effort 점검한다.
 * 비개발자에게 유의미한 핵심 위반(이미지 대체텍스트·컨트롤 이름·입력 라벨·언어·대비)만 잡는다.
 * @param doc 검사할 Document
 * @param getStyle 요소 → computed style 일부 (content 는 getComputedStyle, 테스트는 모킹)
 */
export function auditA11y(doc: Document, getStyle: (el: Element) => ContrastStyle): A11yIssue[] {
  const issues: A11yIssue[] = [];

  // 1) <html lang>
  const html = doc.documentElement;
  if (!html.getAttribute('lang')?.trim()) {
    issues.push({
      kind: 'html-lang',
      selector: 'html',
      message: '페이지 언어(<html lang>)가 지정되지 않았습니다. 스크린 리더가 올바른 언어로 읽지 못할 수 있습니다.',
      severity: 'warn',
    });
  }

  // 2) <img> alt
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    if (img.getAttribute('alt') === null) {
      issues.push({
        kind: 'img-alt',
        selector: cssPath(img),
        message: '이미지에 대체 텍스트(alt)가 없습니다. 장식용이면 alt="" 를, 의미가 있으면 설명을 넣어주세요.',
        severity: 'error',
      });
    }
  }

  // 3) 버튼/링크 접근가능 이름
  for (const ctrl of Array.from(doc.querySelectorAll('button, a[href]'))) {
    if (!hasAccessibleName(ctrl)) {
      const label = ctrl.tagName === 'A' ? '링크' : '버튼';
      issues.push({
        kind: 'control-name',
        selector: cssPath(ctrl),
        message: `${label}에 읽을 수 있는 이름이 없습니다. 텍스트나 aria-label 을 추가해주세요.`,
        severity: 'error',
      });
    }
  }

  // 4) 입력 라벨
  for (const input of Array.from(doc.querySelectorAll('input, textarea, select'))) {
    if (isLabelableInput(input) && !hasInputLabel(input, doc)) {
      issues.push({
        kind: 'input-label',
        selector: cssPath(input),
        message: '입력란에 연결된 라벨(label)이 없습니다. 무엇을 입력하는지 알기 어렵습니다.',
        severity: 'error',
      });
    }
  }

  // 5) 텍스트 대비
  for (const el of Array.from(doc.querySelectorAll('body *'))) {
    if (!hasOwnText(el)) continue;
    let style: ContrastStyle;
    try {
      style = getStyle(el);
    } catch {
      continue;
    }
    if (contrastFail(style)) {
      issues.push({
        kind: 'contrast',
        selector: cssPath(el),
        message: '글자와 배경의 색 대비가 낮아 읽기 어렵습니다(WCAG 미달).',
        severity: 'warn',
      });
    }
  }

  return issues;
}
