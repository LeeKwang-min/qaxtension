import { describe, it, expect } from 'vitest';
import { VIEWPORT_PRESETS, classifyViewport } from '../src/audit/responsive';

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
