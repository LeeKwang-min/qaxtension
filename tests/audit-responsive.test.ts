import { describe, it, expect } from 'vitest';
import { VIEWPORT_PRESETS, classifyViewport, computeWindowSize } from '../src/audit/responsive';

describe('VIEWPORT_PRESETS', () => {
  it('provides mobile/tablet/desktop presets with positive dimensions', () => {
    const labels = VIEWPORT_PRESETS.map((p) => p.label);
    expect(labels).toContain('모바일');
    expect(labels).toContain('태블릿');
    expect(labels).toContain('데스크탑');
    for (const p of VIEWPORT_PRESETS) {
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
    }
  });
});

describe('classifyViewport', () => {
  it('classifies by width breakpoints', () => {
    expect(classifyViewport(360)).toBe('모바일');
    expect(classifyViewport(800)).toBe('태블릿');
    expect(classifyViewport(1440)).toBe('데스크탑');
  });

  it('uses 768 and 1024 as boundaries (inclusive lower)', () => {
    expect(classifyViewport(767)).toBe('모바일');
    expect(classifyViewport(768)).toBe('태블릿');
    expect(classifyViewport(1023)).toBe('태블릿');
    expect(classifyViewport(1024)).toBe('데스크탑');
  });
});

describe('computeWindowSize', () => {
  it('adds the chrome+sidepanel overhead so the page viewport matches the preset', () => {
    // 창 전체 1000×800 인데 페이지 뷰포트가 600×700 → 오버헤드 가로 400(사이드패널+테두리)·세로 100(크롬 UI)
    const size = computeWindowSize(
      { width: 375, height: 667 },
      { winWidth: 1000, winHeight: 800, innerWidth: 600, innerHeight: 700 },
    );
    expect(size).toEqual({ width: 775, height: 767 });
  });

  it('returns the preset unchanged when there is no overhead', () => {
    const size = computeWindowSize(
      { width: 1280, height: 800 },
      { winWidth: 1280, winHeight: 800, innerWidth: 1280, innerHeight: 800 },
    );
    expect(size).toEqual({ width: 1280, height: 800 });
  });

  it('never produces negative overhead (guards bad measurements)', () => {
    const size = computeWindowSize(
      { width: 375, height: 667 },
      { winWidth: 500, winHeight: 400, innerWidth: 800, innerHeight: 900 },
    );
    expect(size).toEqual({ width: 375, height: 667 });
  });
});
