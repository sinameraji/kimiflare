import { describe, it } from "node:test";
import assert from "node:assert";
import { checkContrast, type ContrastIssue } from "./wcag.js";
import { BUILT_IN_THEMES, type Theme, type DimColor } from "./theme.js";

const THRESHOLD = 4.5;

// We can't detect the actual terminal bg. We test against pure black/white
// plus common dark grays (#1e1e1e = VS Code, #282c34 = One Dark/Atom)
// because many users run dark terminals that are not pure black.
const DARK_BACKGROUNDS = ["#000000", "#1e1e1e", "#282c34"];
const LIGHT_BACKGROUNDS = ["#ffffff"];

interface ColorEntry {
  theme: string;
  slot: string;
  color: string;
}

function extractColors(theme: Theme): ColorEntry[] {
  const entries: ColorEntry[] = [];

  const add = (slot: string, color: string | undefined) => {
    if (color) entries.push({ theme: theme.name, slot, color });
  };

  const addDim = (slot: string, d: DimColor | undefined) => {
    if (d) entries.push({ theme: theme.name, slot, color: d.color });
  };

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

function checkThemes(): ContrastIssue[] {
  const issues: ContrastIssue[] = [];

  for (const theme of Object.values(BUILT_IN_THEMES)) {
    const bgs = theme.type === "light" ? LIGHT_BACKGROUNDS : DARK_BACKGROUNDS;

    for (const entry of extractColors(theme)) {
      for (const bg of bgs) {
        const issue = checkContrast(entry.color, bg, THRESHOLD);
        if (issue) {
          issues.push({
            ...issue,
            pair: `${entry.theme}.${entry.slot} (${entry.color} on ${bg})`,
          });
        }
      }
    }
  }

  return issues;
}

describe("built-in theme contrast compliance", () => {
  it("every color must be readable on its intended terminal background", () => {
    const issues = checkThemes();

    if (issues.length > 0) {
      const lines = issues.map(
        (i) => `  ${i.pair}: ${i.ratio}:1 (needs ${i.required}:1)`,
      );
      assert.fail(
        `${issues.length} contrast issue(s) found:\n` + lines.join("\n"),
      );
    }
  });
});
