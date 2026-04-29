import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyTurn, classifySession, needsLlmFallback } from "./heuristic.js";
import type { TaskCategory } from "./types.js";

describe("classifyTurn", () => {
  it("classifies read_file on .ts as reading-source-code", () => {
    const signals = classifyTurn({
      toolCalls: [{ name: "read_file", arguments: { path: "src/foo.ts" } }],
      tokens: 100,
    });
    assert.strictEqual(signals.length, 1);
    assert.strictEqual(signals[0]!.category, "reading-source-code");
    assert.strictEqual(signals[0]!.confidence, 0.8);
  });

  it("classifies write_file on .md as writing-documentation", () => {
    const signals = classifyTurn({
      toolCalls: [{ name: "write_file", arguments: { path: "README.md" } }],
      tokens: 50,
    });
    assert.strictEqual(signals.length, 1);
    assert.strictEqual(signals[0]!.category, "writing-documentation");
    assert.strictEqual(signals[0]!.confidence, 0.9);
  });

  it("classifies str_replace on .ts as editing-source-code", () => {
    const signals = classifyTurn({
      toolCalls: [{ name: "str_replace", arguments: { path: "src/bar.ts" } }],
      tokens: 80,
    });
    assert.strictEqual(signals.length, 1);
    assert.strictEqual(signals[0]!.category, "editing-source-code");
    assert.strictEqual(signals[0]!.confidence, 0.85);
  });

  it("classifies bash npm test as running-tests", () => {
    const signals = classifyTurn({
      toolCalls: [{ name: "bash", arguments: { command: "npm test" } }],
      tokens: 20,
    });
    assert.strictEqual(signals.length, 1);
    assert.strictEqual(signals[0]!.category, "running-tests");
    assert.strictEqual(signals[0]!.confidence, 0.9);
  });

  it("classifies web_fetch as reading-web-content", () => {
    const signals = classifyTurn({
      toolCalls: [{ name: "web_fetch", arguments: { url: "https://example.com" } }],
      tokens: 200,
    });
    assert.strictEqual(signals.length, 1);
    assert.strictEqual(signals[0]!.category, "reading-web-content");
    assert.strictEqual(signals[0]!.confidence, 0.85);
  });

  it("classifies grep as searching-code", () => {
    const signals = classifyTurn({
      toolCalls: [{ name: "grep", arguments: { pattern: "*.ts" } }],
      tokens: 10,
    });
    assert.strictEqual(signals.length, 1);
    assert.strictEqual(signals[0]!.category, "searching-code");
  });

  it("returns empty for unknown tools", () => {
    const signals = classifyTurn({
      toolCalls: [{ name: "unknown_tool", arguments: {} }],
      tokens: 10,
    });
    assert.strictEqual(signals.length, 0);
  });
});

describe("classifySession", () => {
  it("picks dominant category by weighted score", () => {
    const result = classifySession([
      { toolCalls: [{ name: "read_file", arguments: { path: "src/a.ts" } }], tokens: 100 },
      { toolCalls: [{ name: "str_replace", arguments: { path: "src/b.ts" } }], tokens: 300 },
      { toolCalls: [{ name: "bash", arguments: { command: "npm test" } }], tokens: 50 },
    ]);
    assert.strictEqual(result.category, "editing-source-code");
    assert.strictEqual(result.classifiedBy, "heuristic");
    assert.ok(result.confidence > 0);
  });

  it("falls back to other for short sessions", () => {
    const result = classifySession([], { totalTurns: 1, totalToolCalls: 2 });
    assert.strictEqual(result.category, "other");
    assert.ok(result.confidence >= 0);
  });

  it("classifies mixed writing signals", () => {
    const result = classifySession([
      { toolCalls: [{ name: "write_file", arguments: { path: "src/foo.test.ts" } }], tokens: 100 },
      { toolCalls: [{ name: "write_file", arguments: { path: "docs/guide.md" } }], tokens: 50 },
    ]);
    // writing-tests has higher confidence (0.9) so should dominate
    assert.strictEqual(result.category, "writing-tests");
  });
});

describe("needsLlmFallback", () => {
  it("returns true for low confidence", () => {
    assert.strictEqual(needsLlmFallback({ category: "other", confidence: 0.4, classifiedBy: "heuristic" }), true);
  });

  it("returns true for other category", () => {
    assert.strictEqual(needsLlmFallback({ category: "other", confidence: 0.7, classifiedBy: "heuristic" }), true);
  });

  it("returns false for high confidence non-other", () => {
    assert.strictEqual(needsLlmFallback({ category: "editing-source-code", confidence: 0.8, classifiedBy: "heuristic" }), false);
  });
});
