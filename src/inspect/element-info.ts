import type { ColorInfo, ContrastInfo, ElementInfo } from '../messaging/types';
import { parseColorToHex, rgbTuple, contrastRatio, wcagLevel } from './colors';
import { pathOfElement } from './dom-tree';

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
  const root = el.ownerDocument?.body ?? null;
  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || null,
    classList: Array.from(el.classList),
    selector: cssPath(el),
    domPath: root ? pathOfElement(root, el) : null,
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
