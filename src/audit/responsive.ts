import type { ViewportPreset } from '../messaging/types';

/** 반응형 점검용 뷰포트 프리셋 (대표 디바이스 폭) */
export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { label: '모바일', width: 375, height: 667 },
  { label: '태블릿', width: 768, height: 1024 },
  { label: '데스크탑', width: 1280, height: 800 },
];

/** 폭(px) → 디바이스 분류 (768 미만 모바일, 1024 미만 태블릿, 이상 데스크탑) */
export function classifyViewport(width: number): string {
  if (width < 768) return '모바일';
  if (width < 1024) return '태블릿';
  return '데스크탑';
}

/** 현재 창/페이지 측정값 */
export interface WindowMeasure {
  /** 창 전체 폭 (chrome.windows.get 의 width) */
  winWidth: number;
  /** 창 전체 높이 */
  winHeight: number;
  /** 페이지 뷰포트 폭 (window.innerWidth) */
  innerWidth: number;
  /** 페이지 뷰포트 높이 (window.innerHeight) */
  innerHeight: number;
}

/**
 * 페이지 뷰포트가 정확히 프리셋 크기가 되도록 창 전체 크기를 계산한다.
 * 창 전체에는 사이드패널·크롬 UI(주소창/탭/테두리)가 포함되므로, 그 오버헤드를
 * 실측(창 전체 - 페이지 뷰포트)해 프리셋에 더해준다.
 */
export function computeWindowSize(
  preset: { width: number; height: number },
  m: WindowMeasure,
): { width: number; height: number } {
  const dw = Math.max(0, m.winWidth - m.innerWidth);
  const dh = Math.max(0, m.winHeight - m.innerHeight);
  return { width: preset.width + dw, height: preset.height + dh };
}
