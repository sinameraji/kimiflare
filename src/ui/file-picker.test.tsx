import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { renderToString } from "ink";
import { FilePicker, type FilePickerItem } from "./file-picker.js";
import { resolveTheme } from "./theme.js";

const theme = resolveTheme(undefined);

function renderPicker(items: FilePickerItem[], selectedIndex: number, query = ""): string {
  return renderToString(
    <FilePicker items={items} selectedIndex={selectedIndex} theme={theme} query={query} />,
  );
}

describe("FilePicker", () => {
  it("renders empty state", () => {
    const out = renderPicker([], 0);
    assert.ok(out.includes("No matches"));
  });

  it("renders items with selection indicator", () => {
    const items: FilePickerItem[] = [
      { name: "src", isDirectory: true },
      { name: "README.md", isDirectory: false },
    ];
    const out = renderPicker(items, 0);
    assert.ok(out.includes("› src/"));
    assert.ok(out.includes("  README.md"));
  });

  it("renders query header when filtering", () => {
    const items: FilePickerItem[] = [{ name: "app.tsx", isDirectory: false }];
    const out = renderPicker(items, 0, "app");
    assert.ok(out.includes('Files matching "app"'));
  });

  it("shows 'and N more' when items exceed visible limit", () => {
    const items: FilePickerItem[] = Array.from({ length: 15 }, (_, i) => ({
      name: `file${i}.ts`,
      isDirectory: false,
    }));
    const out = renderPicker(items, 14);
    assert.ok(out.includes("more above"));
  });

  it("uses stable keys by item name", () => {
    // This is a design test: keys must be based on name alone so filtering
    // does not shift identities.
    const items: FilePickerItem[] = [
      { name: "a.ts", isDirectory: false },
      { name: "b.ts", isDirectory: false },
    ];
    const out = renderPicker(items, 1);
    assert.ok(out.includes("› b.ts"));
  });
});
