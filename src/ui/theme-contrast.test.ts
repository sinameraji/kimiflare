import { describe, it } from "node:test";
import assert from "node:assert";
import { checkContrast, hexToRgb, relativeLuminance, type ContrastIssue } from "./wcag.js";
import { BUILT_IN_THEMES, type Theme, type DimColor } from "./theme.js";

const BLACK = "#000000";
const WHITE = "#ffffff";
const NORMAL_THRESHOLD = 2.0;
const DIM_THRESHOLD = 1.5;

interface ColorEntry {
  theme: string;
  slot: string;
  color: string;
  dim: boolean;
}

function isLightTheme(theme: Theme): boolean {
  const rgb = hexToRgb(theme.palette.background);
  if (!rgb) return false;
  return relativeLuminance(rgb) > 0.5;
}

function extractColors(theme: Theme): ColorEntry[] {
  const entries: ColorEntry[] = [];

  const add = (slot: string, color: string | undefined, dim = false) => {
    if (color) entries.push({ theme: theme.name, slot, color, dim });
  };

  const addDim = (slot: string, d: DimColor | undefined) => {
    if (d) entries.push({ theme: theme.name, slot, color: d.color, dim: d.dim });
  };

  // Background is the canvas, not the paint — skip it for cross-background checks.
  add("palette.foreground", theme.palette.foreground);
  add("palette.primary", theme.palette.primary);
  add("palette.secondary", theme.palette.secondary);
  add("palette.success", theme.palette.success);
  add("palette.error", theme.palette.error);
  add("user", theme.user);
  add("assistant", theme.assistant);
  addDim("reasoning", theme.reasoning);
  addDim("info", theme.info);
  add("error", theme.error);
  add("warn", theme.warn);
  add("tool", theme.tool);
  add("spinner", theme.spinner);
  add("permission", theme.permission);
  addDim("queue", theme.queue);
  add("accent", theme.accent);
  add("modeBadge.plan", theme.modeBadge.plan);
  add("modeBadge.auto", theme.modeBadge.auto);
  add("modeBadge.edit", theme.modeBadge.edit);
  addDim("blockquote", theme.blockquote);
  add("codeInline", theme.codeInline);
  add("codeBlock", theme.codeBlock);
  add("link", theme.link);
  add("strikethrough", theme.strikethrough);
  add("tableBorder", theme.tableBorder);
  add("tableHeader", theme.tableHeader);
  add("tableCell", theme.tableCell);
  addDim("muted", theme.muted);
  add("prompt", theme.prompt);

  return entries;
}

function checkThemes(): {
  darkOnWhite: ContrastIssue[];
  lightOnBlack: ContrastIssue[];
} {
  const darkOnWhite: ContrastIssue[] = [];
  const lightOnBlack: ContrastIssue[] = [];

  for (const theme of Object.values(BUILT_IN_THEMES)) {
    const light = isLightTheme(theme);
    const oppositeBg = light ? BLACK : WHITE;
    const bucket = light ? lightOnBlack : darkOnWhite;

    for (const entry of extractColors(theme)) {
      const threshold = entry.dim ? DIM_THRESHOLD : NORMAL_THRESHOLD;
      const issue = checkContrast(entry.color, oppositeBg, threshold);
      if (issue) {
        bucket.push({
          ...issue,
          pair: `${entry.theme}.${entry.slot} (${entry.color} on ${oppositeBg})`,
        });
      }
    }
  }

  return { darkOnWhite, lightOnBlack };
}

describe("built-in theme cross-background contrast report", () => {
  it("dark theme colors on white + light theme colors on black", () => {
    const { darkOnWhite, lightOnBlack } = checkThemes();

    const lines: string[] = [];
    if (darkOnWhite.length > 0) {
      lines.push(`\n${darkOnWhite.length} dark-theme color(s) below ${NORMAL_THRESHOLD}:1 on white:`);
      for (const i of darkOnWhite) {
        lines.push(`  ${i.pair}: ${i.ratio}:1`);
      }
    }
    if (lightOnBlack.length > 0) {
      lines.push(`\n${lightOnBlack.length} light-theme color(s) below ${NORMAL_THRESHOLD}:1 on black:`);
      for (const i of lightOnBlack) {
        lines.push(`  ${i.pair}: ${i.ratio}:1`);
      }
    }

    if (lines.length > 0) {
      console.log(lines.join("\n"));
    }

    // This test documents current state; it does not fail the build.
    // To make it strict, set STRICT_CONTRAST=1.
    if (process.env.STRICT_CONTRAST) {
      const total = darkOnWhite.length + lightOnBlack.length;
      if (total > 0) {
        assert.fail(
          `${total} cross-background contrast issue(s) found. ` +
            `Run without STRICT_CONTRAST to see the full report.`,
        );
      }
    }
  });
});
