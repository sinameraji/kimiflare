import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { renderToString } from "ink";
import { SlashPicker } from "./slash-picker.js";
import type { SlashItem } from "../commands/types.js";
import { resolveTheme } from "./theme.js";

const theme = resolveTheme(undefined);

function render(items: SlashItem[], selectedIndex: number, query = ""): string {
  return renderToString(
    <SlashPicker items={items} selectedIndex={selectedIndex} theme={theme} query={query} />,
  );
}

const sample: SlashItem[] = [
  { name: "model", description: "Show current model", source: "builtin" },
  { name: "mode", argHint: "edit|plan|auto", description: "Switch agent mode", source: "builtin" },
  { name: "memory", description: "Manage memory", source: "builtin" },
];

describe("SlashPicker", () => {
  it("renders empty state", () => {
    const out = render([], 0);
    assert.ok(out.includes("No matches"));
  });

  it("renders items with selection indicator and arg hint", () => {
    const out = render(sample, 1);
    assert.ok(out.includes("/model"));
    assert.ok(out.includes("› /mode edit|plan|auto"));
    assert.ok(out.includes("Switch agent mode"));
  });

  it("renders query header when filtering", () => {
    const out = render([sample[0]!], 0, "mod");
    assert.ok(out.includes('Commands matching "/mod"'));
  });

  it("shows project/global source badge for custom commands", () => {
    const items: SlashItem[] = [
      { name: "fix", description: "Quick fixer", source: "project" },
      { name: "review", description: "Quick reviewer", source: "global" },
    ];
    const out = render(items, 0);
    assert.ok(out.includes("[project]"));
    assert.ok(out.includes("[global]"));
  });

  it("does not render a badge for built-ins", () => {
    const out = render([sample[0]!], 0);
    assert.ok(!out.includes("[builtin]"));
  });

  it("keeps a separator between long labels and the description", () => {
    const items: SlashItem[] = [
      { name: "mode", argHint: "edit|plan|auto", description: "Switch agent mode", source: "builtin" },
    ];
    const out = render(items, 0);
    // Label is 20 chars; need at least one space before "Switch".
    assert.ok(/\/mode edit\|plan\|auto\s+Switch agent mode/.test(out), out);
  });

  it("shows 'more above' / 'more below' on overflow", () => {
    const items: SlashItem[] = Array.from({ length: 12 }, (_, i) => ({
      name: `cmd${i}`,
      description: `desc ${i}`,
      source: "builtin" as const,
    }));
    const out = render(items, 11);
    assert.ok(out.includes("more above"));
  });
});
