import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import React from "react";
import { renderToString } from "ink";
import chalk from "chalk";
import {
  CustomTextInput,
  sanitizeInput,
  shouldTreatAsPaste,
  makePastePreview,
  countLines,
  findWordBoundaryForward,
  findWordBoundaryBackward,
  findPasteTokenEndingAt,
} from "./text-input.js";

describe("sanitizeInput", () => {
  it("normalizes \\r\\n to \\n", () => {
    assert.strictEqual(sanitizeInput("a\r\nb"), "a\nb");
  });

  it("normalizes lone \\r to \\n", () => {
    assert.strictEqual(sanitizeInput("a\rb"), "a\nb");
  });

  it("strips ANSI escape sequences", () => {
    assert.strictEqual(sanitizeInput("\x1B[31mred\x1B[0m"), "red");
    assert.strictEqual(sanitizeInput("\x1B[1;31mbold\x1B[m"), "bold");
    assert.strictEqual(sanitizeInput("\x1B[K"), "");
  });

  it("replaces tabs with two spaces", () => {
    assert.strictEqual(sanitizeInput("a\tb"), "a  b");
  });

  it("leaves normal text untouched", () => {
    assert.strictEqual(sanitizeInput("hello world"), "hello world");
  });
});

describe("shouldTreatAsPaste", () => {
  it("returns true for long input", () => {
    assert.strictEqual(shouldTreatAsPaste("x".repeat(200)), true);
    assert.strictEqual(shouldTreatAsPaste("x".repeat(199)), false);
  });

  it("returns true for input with newlines", () => {
    assert.strictEqual(shouldTreatAsPaste("line1\nline2"), true);
    assert.strictEqual(shouldTreatAsPaste("no newline"), false);
  });
});

describe("makePastePreview", () => {
  it("formats single-line preview", () => {
    const preview = makePastePreview("hello world", 1, 3);
    assert.ok(preview.includes('"hello world"'));
    assert.ok(preview.includes("1 line"));
    assert.ok(preview.includes("#3"));
  });

  it("truncates long first line", () => {
    const preview = makePastePreview("a".repeat(50), 2, 1);
    assert.ok(preview.includes('"a'.repeat(1)));
    assert.ok(preview.includes("…"));
    assert.ok(preview.includes("2 lines"));
  });

  it("handles empty input", () => {
    const preview = makePastePreview("", 1, 1);
    assert.ok(preview.includes("(empty)"));
  });
});

describe("countLines", () => {
  it("counts lines correctly", () => {
    assert.strictEqual(countLines(""), 1);
    assert.strictEqual(countLines("a"), 1);
    assert.strictEqual(countLines("a\nb"), 2);
    assert.strictEqual(countLines("a\nb\nc"), 3);
  });
});

describe("findWordBoundaryForward", () => {
  it("jumps to next word", () => {
    assert.strictEqual(findWordBoundaryForward("hello world", 0), 6);
    assert.strictEqual(findWordBoundaryForward("hello world", 6), 11);
  });
});

describe("findWordBoundaryBackward", () => {
  it("jumps to previous word", () => {
    assert.strictEqual(findWordBoundaryBackward("hello world", 11), 6);
    assert.strictEqual(findWordBoundaryBackward("hello world", 6), 0);
  });
});

describe("findPasteTokenEndingAt", () => {
  it("finds token ending at position", () => {
    const pastes = new Map<string, string>();
    pastes.set('⦗"hi" (1 line) #1⦘', "hi");
    const value = 'abc⦗"hi" (1 line) #1⦘';
    const pos = value.length;
    assert.strictEqual(findPasteTokenEndingAt(value, pos, pastes), 3);
  });

  it("returns -1 when no token matches", () => {
    const pastes = new Map<string, string>();
    assert.strictEqual(findPasteTokenEndingAt("abc", 3, pastes), -1);
  });
});

describe("CustomTextInput rendering", () => {
  beforeEach(() => {
    chalk.level = 3;
  });

  function render(value: string, cursorOffset: number, mask?: string): string {
    return renderToString(
      <CustomTextInput
        value={value}
        onChange={() => {}}
        onSubmit={() => {}}
        cursorOffset={cursorOffset}
        mask={mask}
      />,
    );
  }

  it("renders empty value with cursor", () => {
    const out = render("", 0);
    assert.strictEqual(out, chalk.inverse(" "));
  });

  it("renders cursor at start", () => {
    const out = render("abc", 0);
    assert.strictEqual(out, `${chalk.inverse("a")}bc`);
  });

  it("renders cursor in middle", () => {
    const out = render("abc", 1);
    assert.strictEqual(out, `a${chalk.inverse("b")}c`);
  });

  it("renders cursor at end", () => {
    const out = render("abc", 3);
    assert.strictEqual(out, `abc${chalk.inverse(" ")}`);
  });

  it("renders masked value", () => {
    const out = render("secret", 2, "*");
    assert.strictEqual(out, `**${chalk.inverse("*")}***`);
  });

  it("renders cursor at every offset for surrogate pairs", () => {
    // "🎉" is U+1F389, a surrogate pair (2 UTF-16 code units).
    const value = "a🎉b";
    const results: string[] = [];
    for (let i = 0; i <= value.length; i++) {
      results.push(render(value, i));
    }

    // Cursor at position 0
    assert.ok(results[0]!.startsWith(chalk.inverse("a")));
    // Cursor at position 1 (after 'a', before emoji)
    assert.ok(results[1]!.includes(`a${chalk.inverse("\uD83C")}`));
    // Cursor at position 2 (inside emoji surrogate pair)
    assert.ok(results[2]!.includes(`a\uD83C${chalk.inverse("\uDF89")}`));
    // Cursor at position 3 (after emoji, before 'b')
    assert.ok(results[3]!.includes(`a\uD83C\uDF89${chalk.inverse("b")}`));
    // Cursor at position 4 (end)
    assert.ok(results[4]!.endsWith(chalk.inverse(" ")));
  });
});
