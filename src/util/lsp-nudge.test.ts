import { describe, it } from "node:test";
import assert from "node:assert";
import { maybeLspNudge } from "./lsp-nudge.js";

describe("maybeLspNudge", () => {
  it("returns null when LSP is already configured", () => {
    const nudge = maybeLspNudge("What does src/foo.ts do?", true, { ts: { command: ["tsserver"] } });
    assert.strictEqual(nudge, null);
  });

  it("returns null for non-code messages", () => {
    const nudge = maybeLspNudge("Hello, how are you?", false, {});
    assert.strictEqual(nudge, null);
  });

  it("nudges for TypeScript files", () => {
    const nudge = maybeLspNudge("Check src/app.ts for bugs", false, {});
    assert.ok(nudge);
    assert.ok(nudge!.includes("TypeScript"));
    assert.ok(nudge!.includes("/lsp config"));
  });

  it("nudges for Python files", () => {
    const nudge = maybeLspNudge("What does main.py do?", false, {});
    assert.ok(nudge);
    assert.ok(nudge!.includes("Python"));
  });

  it("nudges for Rust files", () => {
    const nudge = maybeLspNudge("Fix the error in lib.rs", false, {});
    assert.ok(nudge);
    assert.ok(nudge!.includes("Rust"));
  });

  it("nudges for Go files", () => {
    const nudge = maybeLspNudge("Refactor handler.go", false, {});
    assert.ok(nudge);
    assert.ok(nudge!.includes("Go"));
  });

  it("combines multiple detected languages", () => {
    const nudge = maybeLspNudge("Compare app.ts and main.py", false, {});
    assert.ok(nudge);
    assert.ok(nudge!.includes("TypeScript"));
    assert.ok(nudge!.includes("Python"));
  });

  it("nudges when LSP is enabled but no servers are configured", () => {
    const nudge = maybeLspNudge("What does foo.ts do?", true, {});
    assert.ok(nudge);
    assert.ok(nudge!.includes("TypeScript"));
  });
});
