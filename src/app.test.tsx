import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFilePickerIgnoreList,
  filterPickerItems,
  shouldOpenMentionPicker,
} from "./app.js";
import type { FilePickerItem } from "./ui/file-picker.js";

describe("buildFilePickerIgnoreList", () => {
  it("always includes hardcoded patterns", () => {
    const list = buildFilePickerIgnoreList("/fake");
    assert.ok(list.includes("**/node_modules/**"));
    assert.ok(list.includes("**/.git/**"));
    assert.ok(list.includes("**/dist/**"));
  });

  it("reads .gitignore and converts patterns", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-test-"));
    writeFileSync(join(dir, ".gitignore"), "*.log\nbuild/\n/dist\n", "utf-8");
    const list = buildFilePickerIgnoreList(dir);
    assert.ok(list.includes("**/*.log"));
    assert.ok(list.includes("**/build/**"));
    assert.ok(list.includes("dist"));
    unlinkSync(join(dir, ".gitignore"));
    rmdirSync(dir);
  });

  it("skips oversized .gitignore files", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-test-"));
    // Write > 1 MB so the size guard triggers
    writeFileSync(join(dir, ".gitignore"), "a\n".repeat(600_000), "utf-8");
    const list = buildFilePickerIgnoreList(dir);
    // Should return only hardcoded patterns, not crash
    assert.ok(list.includes("**/node_modules/**"));
    assert.ok(!list.includes("**/a"));
    unlinkSync(join(dir, ".gitignore"));
    rmdirSync(dir);
  });

  it("ignores comments and negation patterns", () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-test-"));
    writeFileSync(join(dir, ".gitignore"), "# comment\n!important\n", "utf-8");
    const list = buildFilePickerIgnoreList(dir);
    assert.ok(!list.includes("# comment"));
    assert.ok(!list.includes("!important"));
    unlinkSync(join(dir, ".gitignore"));
    rmdirSync(dir);
  });
});

describe("filterPickerItems", () => {
  const items: FilePickerItem[] = [
    { name: "src/app.tsx", isDirectory: false },
    { name: "src", isDirectory: true },
    { name: "README.md", isDirectory: false },
  ];

  it("filters by substring case-insensitively", () => {
    const result = filterPickerItems(items, "app");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.name, "src/app.tsx");
  });

  it("returns all items when query is empty", () => {
    const result = filterPickerItems(items, "");
    assert.strictEqual(result.length, 3);
  });

  it("caps results at 50", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      name: `file${i}.ts`,
      isDirectory: false,
    }));
    const result = filterPickerItems(many, "");
    assert.strictEqual(result.length, 50);
  });
});

describe("shouldOpenMentionPicker", () => {
  it("opens when @ is typed at start", () => {
    assert.strictEqual(shouldOpenMentionPicker("@", 1, null), true);
  });

  it("opens when @ follows whitespace", () => {
    assert.strictEqual(shouldOpenMentionPicker("hello @", 7, null), true);
  });

  it("does not open when @ follows a non-whitespace character", () => {
    assert.strictEqual(shouldOpenMentionPicker("hello@", 6, null), false);
  });

  it("does not open immediately after cancel at same offset", () => {
    assert.strictEqual(shouldOpenMentionPicker("hello ", 6, 6), false);
  });

  it("does not open when cursor is at 0", () => {
    assert.strictEqual(shouldOpenMentionPicker("", 0, null), false);
  });
});
