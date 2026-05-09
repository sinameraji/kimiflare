import { describe, it } from "node:test";
import assert from "node:assert";
import { stripTypescript, runInSandbox } from "./sandbox.js";
import { ToolExecutor } from "../tools/executor.js";
import type { ToolSpec } from "../tools/registry.js";

const mockTools: ToolSpec[] = [];

const mockExecutor = new ToolExecutor(mockTools);

const mockAskPermission = async () => "allow" as const;

const mockCtx = {
  cwd: process.cwd(),
  signal: undefined as AbortSignal | undefined,
  onTasks: undefined as
    | ((tasks: { id: string; title: string; status: string }[]) => void)
    | undefined,
  coauthor: undefined as { name: string; email: string } | undefined,
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

    // TypeScript is a project dependency, so transpilation should succeed
    assert.strictEqual(result.output, "42");
    assert.strictEqual(result.error, undefined);
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

    // Should execute successfully — TypeScript is resolved via import.meta.resolve
    // regardless of cwd, so transpilation works
    assert.strictEqual(result.output, "1");
    assert.strictEqual(result.error, undefined);
  });
});
