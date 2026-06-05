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
