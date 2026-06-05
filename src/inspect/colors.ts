/** 'rgb(r, g, b)' / 'rgba(r, g, b, a)' → [r, g, b]. 그 외엔 null. */
export function rgbTuple(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2]];
}

/** computed 색상 문자열을 HEX 로. 완전 투명은 'transparent', rgb 가 아니면 입력 그대로. */
export function parseColorToHex(css: string): string {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return css;
  const parts = m[1].split(',').map((s) => s.trim());
  const a = parts[3] != null ? parseFloat(parts[3]) : 1;
  if (a === 0) return 'transparent';
  const rgb = rgbTuple(css);
  if (!rgb) return css;
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

/** WCAG 상대 휘도 (0~1) */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** 두 색의 대비비 (1~21), 순서 무관 */
export function contrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const l1 = relativeLuminance(fg[0], fg[1], fg[2]);
  const l2 = relativeLuminance(bg[0], bg[1], bg[2]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.x 등급. large = 24px+ 또는 bold(>=700) 18.66px+ */
export function wcagLevel(
  ratio: number,
  fontSizePx: number,
  bold: boolean,
): 'AAA' | 'AA' | 'Fail' {
  const large = fontSizePx >= 24 || (bold && fontSizePx >= 18.66);
  if (large) {
    if (ratio >= 4.5) return 'AAA';
    if (ratio >= 3) return 'AA';
    return 'Fail';
  }
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'Fail';
}
