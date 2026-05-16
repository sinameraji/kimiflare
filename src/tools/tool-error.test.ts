import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ToolError,
  isToolError,
  wrapAsToolError,
  toolTimeoutError,
  toolAbortError,
  toolInvalidArgsError,
  toolNotFoundError,
} from "./tool-error.js";

describe("ToolError", () => {
  it("carries code, message, recoverable, suggestion", () => {
    const e = new ToolError({
      code: "timeout",
      message: "MCP timed out",
      suggestion: "retry with smaller payload",
    });
    assert.strictEqual(e.code, "timeout");
    assert.strictEqual(e.message, "MCP timed out");
    assert.strictEqual(e.suggestion, "retry with smaller payload");
    assert.strictEqual(e.recoverable, true); // default for timeout
    assert.strictEqual(e.name, "ToolError");
    assert.ok(e instanceof Error);
  });

  it("derives a sensible default for recoverable from the code", () => {
    assert.strictEqual(new ToolError({ code: "timeout", message: "x" }).recoverable, true);
    assert.strictEqual(new ToolError({ code: "transient_failure", message: "x" }).recoverable, true);
    assert.strictEqual(new ToolError({ code: "aborted", message: "x" }).recoverable, false);
    assert.strictEqual(new ToolError({ code: "invalid_args", message: "x" }).recoverable, false);
    assert.strictEqual(new ToolError({ code: "permission_denied", message: "x" }).recoverable, false);
    assert.strictEqual(new ToolError({ code: "not_found", message: "x" }).recoverable, false);
    assert.strictEqual(new ToolError({ code: "policy_rejection", message: "x" }).recoverable, false);
    assert.strictEqual(new ToolError({ code: "unknown", message: "x" }).recoverable, false);
  });

  it("respects an explicit recoverable override", () => {
    const e = new ToolError({ code: "timeout", message: "x", recoverable: false });
    assert.strictEqual(e.recoverable, false);
  });

  it("preserves the cause for stack traces", () => {
    const cause = new Error("underlying");
    const e = new ToolError({ code: "unknown", message: "wrapped", cause });
    assert.strictEqual((e as Error & { cause?: unknown }).cause, cause);
  });
});

describe("isToolError", () => {
  it("returns true for a ToolError", () => {
    assert.strictEqual(isToolError(new ToolError({ code: "unknown", message: "x" })), true);
  });

  it("returns false for plain Error", () => {
    assert.strictEqual(isToolError(new Error("plain")), false);
  });

  it("returns false for non-errors", () => {
    assert.strictEqual(isToolError(null), false);
    assert.strictEqual(isToolError("string"), false);
    assert.strictEqual(isToolError({ code: "timeout", message: "x" }), false);
  });

  it("treats name + code as the duck-type signature (cross-module safe)", () => {
    // Simulate an Error from a different module instance that still has
    // the right shape (name === "ToolError" and string code).
    const e = new Error("from elsewhere");
    e.name = "ToolError";
    (e as { code?: unknown }).code = "timeout";
    assert.strictEqual(isToolError(e), true);
  });
});

describe("wrapAsToolError", () => {
  it("is a no-op for an existing ToolError", () => {
    const original = new ToolError({ code: "timeout", message: "x" });
    assert.strictEqual(wrapAsToolError(original), original);
  });

  it("wraps a plain Error as unknown / not-recoverable", () => {
    const e = wrapAsToolError(new Error("boom"));
    assert.strictEqual(e.code, "unknown");
    assert.strictEqual(e.recoverable, false);
    assert.strictEqual(e.message, "boom");
  });

  it("wraps a string", () => {
    const e = wrapAsToolError("just a string");
    assert.strictEqual(e.code, "unknown");
    assert.strictEqual(e.message, "just a string");
  });

  it("wraps a non-error object via String()", () => {
    const e = wrapAsToolError({ random: "object" });
    assert.strictEqual(e.code, "unknown");
    assert.ok(e.message.includes("[object Object]"));
  });
});

describe("factory helpers", () => {
  it("toolTimeoutError formats the label + ms and is recoverable", () => {
    const e = toolTimeoutError("MCP request 'foo/bar'", 60_000);
    assert.strictEqual(e.code, "timeout");
    assert.strictEqual(e.recoverable, true);
    assert.match(e.message, /MCP request 'foo\/bar' timed out after 60000ms/);
  });

  it("toolAbortError is not recoverable", () => {
    const e = toolAbortError("LSP request 'textDocument/hover'");
    assert.strictEqual(e.code, "aborted");
    assert.strictEqual(e.recoverable, false);
    assert.match(e.message, /cancelled/);
  });

  it("toolInvalidArgsError carries an optional suggestion", () => {
    const e = toolInvalidArgsError("offset must be positive", "pass offset >= 1");
    assert.strictEqual(e.code, "invalid_args");
    assert.strictEqual(e.suggestion, "pass offset >= 1");
  });

  it("toolNotFoundError is not recoverable", () => {
    const e = toolNotFoundError("server 'github' is not registered");
    assert.strictEqual(e.code, "not_found");
    assert.strictEqual(e.recoverable, false);
  });
});
