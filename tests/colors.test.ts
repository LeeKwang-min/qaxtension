import { describe, it, expect } from 'vitest';
import { parseColorToHex, rgbTuple, contrastRatio, wcagLevel } from '../src/inspect/colors';

describe('parseColorToHex', () => {
  it('converts rgb() to hex', () => {
    expect(parseColorToHex('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(parseColorToHex('rgb(0, 128, 255)')).toBe('#0080ff');
  });
  it('treats fully transparent as "transparent"', () => {
    expect(parseColorToHex('rgba(0, 0, 0, 0)')).toBe('transparent');
  });
  it('drops alpha for opaque rgba', () => {
    expect(parseColorToHex('rgba(255, 255, 255, 1)')).toBe('#ffffff');
  });
  it('returns input unchanged when not rgb()', () => {
    expect(parseColorToHex('#abcdef')).toBe('#abcdef');
  });
});

describe('rgbTuple', () => {
  it('extracts numeric channels', () => {
    expect(rgbTuple('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(rgbTuple('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3]);
  });
  it('returns null for non-rgb', () => {
    expect(rgbTuple('red')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(Math.round(contrastRatio([0, 0, 0], [255, 255, 255]))).toBe(21);
  });
  it('is 1 for identical colors', () => {
    expect(contrastRatio([100, 100, 100], [100, 100, 100])).toBeCloseTo(1, 5);
  });
  it('is symmetric (order independent)', () => {
    const a = contrastRatio([0, 0, 0], [255, 255, 255]);
    const b = contrastRatio([255, 255, 255], [0, 0, 0]);
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('wcagLevel', () => {
  it('grades normal text', () => {
    expect(wcagLevel(21, 16, false)).toBe('AAA');
    expect(wcagLevel(5, 16, false)).toBe('AA');
    expect(wcagLevel(3, 16, false)).toBe('Fail');
  });
  it('uses relaxed thresholds for large text', () => {
    expect(wcagLevel(3.5, 24, false)).toBe('AA');
    expect(wcagLevel(2, 24, false)).toBe('Fail');
  });

  it('uses relaxed thresholds for bold large text (>=18.66px)', () => {
    expect(wcagLevel(3.5, 18.66, true)).toBe('AA'); // bold 18.66 counts as large
    expect(wcagLevel(3.5, 18.65, true)).toBe('Fail'); // just below the bold-large threshold
    expect(wcagLevel(3.5, 18.66, false)).toBe('Fail'); // size met but not bold → normal text
  });

  it('grades AAA for high-contrast large text', () => {
    expect(wcagLevel(4.5, 24, false)).toBe('AAA');
  });
});
