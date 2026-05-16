import { describe, it } from "node:test";
import assert from "node:assert";
import { stripTypescript, runInSandbox, buildFallbackWarning, resetFallbackWarningFlag } from "./sandbox.js";
import type { ToolSpec } from "../tools/registry.js";
import type { ToolExecutor, PermissionAsker } from "../tools/executor.js";
import type { ToolContext } from "../tools/registry.js";

const mockTools: ToolSpec[] = [];

const mockExecutor = {
  list: () => [],
  run: async () => ({ content: "ok", ok: true }),
} as unknown as ToolExecutor;

const mockAskPermission: PermissionAsker = async () => "allow";

const mockCtx: ToolContext = {
  cwd: process.cwd(),
  signal: undefined,
  onTasks: undefined,
  coauthor: undefined,
  memoryManager: undefined,
  sessionId: "test",
};

describe("stripTypescript", () => {
  it("strips basic type annotations", () => {
    const ts = `const x: string = "hello";`;
    const js = stripTypescript(ts);
    assert.ok(!js.includes(": string"));
    assert.ok(js.includes("const x"));
    assert.ok(js.includes('"hello"'));
  });

  it("strips function parameter types", () => {
    const ts = `function greet(name: string): void { console.log(name); }`;
    const js = stripTypescript(ts);
    assert.ok(!js.includes(": string"));
    assert.ok(!js.includes(": void"));
    assert.ok(js.includes("function greet(name)"));
  });

  it("fails on nested parenthesis types (documented limitation)", () => {
    const ts = `function foo(x: (string | number)) { return x; }`;
    const js = stripTypescript(ts);
    // The regex-based stripper produces invalid JS for nested parens
    assert.ok(js.includes("function foo(x))"));
  });
});

describe("runInSandbox", () => {
  it("executes plain JS without types", async () => {
    const result = await runInSandbox({
      code: `console.log("hello");`,
      tools: mockTools,
      executor: mockExecutor,
      askPermission: mockAskPermission,
      ctx: mockCtx,
    });
    assert.strictEqual(result.output, "hello");
    assert.strictEqual(result.error, undefined);
  });

  it("executes TS with nested types when typescript is available", async () => {
    const ts = `
      function foo(x: (string | number)): (string | number) {
        return x;
      }
      console.log(foo(42));
    `;
    const result = await runInSandbox({
      code: ts,
      tools: mockTools,
      executor: mockExecutor,
      askPermission: mockAskPermission,
      ctx: mockCtx,
    });

    // If typescript is installed in the project, this should work
    // If not, it falls back to stripTypescript and may emit a warning
    if (result.warnings && result.warnings.length > 0) {
      assert.ok(result.warnings[0]!.includes("fallback parser"));
    } else {
      assert.strictEqual(result.output, "42");
      assert.strictEqual(result.error, undefined);
    }
  });

  it("finds typescript even with a non-existent cwd", async () => {
    // loadTypescript now uses import.meta.resolve first, so it should find
    // typescript relative to kimiflare itself regardless of cwd.
    const result = await runInSandbox({
      code: `console.log(1);`,
      tools: mockTools,
      executor: mockExecutor,
      askPermission: mockAskPermission,
      ctx: { ...mockCtx, cwd: "/nonexistent/path" },
    });

    // Should execute successfully with no fallback warning
    assert.strictEqual(result.output, "1");
    assert.strictEqual(result.error, undefined);
    assert.ok(!result.warnings || result.warnings.length === 0);
  });
});

describe("buildFallbackWarning", () => {
  it("suggests installing isolated-vm for missing module errors", () => {
    const msg = buildFallbackWarning("Cannot find module 'isolated-vm'");
    assert.ok(msg.includes("is not installed"));
    assert.ok(msg.includes("npm install isolated-vm"));
  });

  it("suggests rebuild for native binding errors", () => {
    const msg = buildFallbackWarning("bindings failed to load .node file");
    assert.ok(msg.includes("native bindings are incompatible"));
    assert.ok(msg.includes("npm rebuild isolated-vm"));
  });

  it("provides a generic message for unknown errors", () => {
    const msg = buildFallbackWarning("something completely unexpected");
    assert.ok(msg.includes("could not be loaded"));
    assert.ok(msg.includes("Ensure build tools are installed"));
  });
});

describe("fallback warning deduplication", () => {
  it("only emits the fallback warning once per session", async () => {
    resetFallbackWarningFlag();

    // Force a fallback by passing code that will cause isolated-vm to fail
    // We simulate this by using a code that works in node:vm but we need to
    // trigger the fallback path. Since we can't easily make isolated-vm fail
    // in a controlled way, we verify the deduplication by checking that
    // after the first fallback, subsequent calls don't add warnings.
    //
    // We test this indirectly: the first call to runInSandbox when isolated-vm
    // is unavailable will set fallbackWarningShown = true. The second call
    // should not add a warning even if it also falls back.
    //
    // In test environments isolated-vm is usually not installed, so both calls
    // will fall back. We just verify at most one warning is ever present.
    const result1 = await runInSandbox({
      code: `console.log("first");`,
      tools: mockTools,
      executor: mockExecutor,
      askPermission: mockAskPermission,
      ctx: mockCtx,
    });

    const result2 = await runInSandbox({
      code: `console.log("second");`,
      tools: mockTools,
      executor: mockExecutor,
      askPermission: mockAskPermission,
      ctx: mockCtx,
    });

    // At most one of the results should have a fallback warning
    const warningCount =
      (result1.warnings?.filter((w) => w.includes("Code Mode is using")).length ?? 0) +
      (result2.warnings?.filter((w) => w.includes("Code Mode is using")).length ?? 0);

    assert.strictEqual(warningCount, 1);
  });

  it("re-emits the fallback warning for a new session in the same process", async () => {
    resetFallbackWarningFlag();

    const sessionA: ToolContext = { ...mockCtx, sessionId: "session-a" };
    const sessionB: ToolContext = { ...mockCtx, sessionId: "session-b" };

    const a1 = await runInSandbox({
      code: `console.log("a1");`,
      tools: mockTools,
      executor: mockExecutor,
      askPermission: mockAskPermission,
      ctx: sessionA,
    });
    const a2 = await runInSandbox({
      code: `console.log("a2");`,
      tools: mockTools,
      executor: mockExecutor,
      askPermission: mockAskPermission,
      ctx: sessionA,
    });
    const b1 = await runInSandbox({
      code: `console.log("b1");`,
      tools: mockTools,
      executor: mockExecutor,
      askPermission: mockAskPermission,
      ctx: sessionB,
    });

    const warningsIn = (r: { warnings?: string[] }) =>
      r.warnings?.filter((w) => w.includes("Code Mode is using")).length ?? 0;

    // If isolated-vm is unavailable in the test environment (the common case),
    // session A should see exactly one warning across its two runs, and
    // session B should also see its own warning.
    // If isolated-vm IS available, no warnings fire at all; that's fine too —
    // the assertion below tolerates both worlds.
    const aWarnings = warningsIn(a1) + warningsIn(a2);
    const bWarnings = warningsIn(b1);

    if (aWarnings > 0) {
      assert.strictEqual(aWarnings, 1, "session A should see warning at most once");
      assert.strictEqual(bWarnings, 1, "session B should also see warning once");
    } else {
      // isolated-vm is available; no fallback warnings expected.
      assert.strictEqual(bWarnings, 0);
    }
  });
});
