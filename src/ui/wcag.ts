/**
 * WCAG 2.1 contrast ratio utilities.
 *
 * AA thresholds:
 *   - Normal text: 4.5:1
 *   - Large text (18pt+ or 14pt+ bold): 3:1
 *   - UI components / graphical objects: 3:1
 *
 * AAA thresholds:
 *   - Normal text: 7:1
 *   - Large text: 4.5:1
 */

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const v = parseInt(m[1]!, 16);
  return {
    r: (v >> 16) & 0xff,
    g: (v >> 8) & 0xff,
    b: v & 0xff,
  };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: string, b: string): number | null {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return null;
  const l1 = relativeLuminance(rgbA);
  const l2 = relativeLuminance(rgbB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastIssue {
  pair: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
}

export function checkContrast(
  foreground: string,
  background: string,
  required = 4.5,
): ContrastIssue | null {
  const ratio = contrastRatio(foreground, background);
  if (ratio === null) return null;
  if (ratio >= required) return null;
  return {
    pair: `${foreground} on ${background}`,
    foreground,
    background,
    ratio: Math.round(ratio * 100) / 100,
    required,
  };
}

export function formatContrastIssues(issues: ContrastIssue[]): string {
  return issues
    .map(
      (i) =>
        `  ${i.pair}: ${i.ratio}:1 (needs ${i.required}:1)`,
    )
    .join("\n");
}
