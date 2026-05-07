import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { renderToString } from "ink";
import { MD } from "./markdown.js";
import { ThemeProvider } from "./theme-context.js";
import { resolveTheme } from "./theme.js";

const testTheme = resolveTheme();

function renderMarkdown(text: string): string {
  return renderToString(
    <ThemeProvider theme={testTheme}>
      <MD text={text} />
    </ThemeProvider>,
  );
}

describe("MD numbered lists", () => {
  it("renders lazy numbering sequentially (1. 1. 1. → 1. 2. 3.)", () => {
    const text = "1. First\n1. Second\n1. Third";
    const out = renderMarkdown(text);
    assert.ok(out.includes("1. First"), "should show 1. for first item");
    assert.ok(out.includes("2. Second"), "should show 2. for second item");
    assert.ok(out.includes("3. Third"), "should show 3. for third item");
  });

  it("preserves explicit source numbers", () => {
    const text = "1. First\n5. Second\n10. Third";
    const out = renderMarkdown(text);
    assert.ok(out.includes("1. First"), "should show 1. for first item");
    assert.ok(out.includes("5. Second"), "should show 5. for second item");
    assert.ok(out.includes("10. Third"), "should show 10. for third item");
  });

  it("renders mixed lazy/explicit with source numbers", () => {
    const text = "2. First\n3. Second\n4. Third";
    const out = renderMarkdown(text);
    assert.ok(out.includes("2. First"), "should show 2. for first item");
    assert.ok(out.includes("3. Second"), "should show 3. for second item");
    assert.ok(out.includes("4. Third"), "should show 4. for third item");
  });
});
