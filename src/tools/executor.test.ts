import { describe, it } from "node:test";
import assert from "node:assert";
import { isDiffCommand, ToolExecutor, toPermissionResult } from "./executor.js";
import { ToolError } from "./tool-error.js";
import type { ToolSpec, ToolContext } from "./registry.js";
import type { PermissionAsker, PermissionDecisionResult } from "./executor.js";

describe("isDiffCommand", () => {
  it("matches `git show` and its argument forms", () => {
    assert.strictEqual(isDiffCommand("git show"), true);
    assert.strictEqual(isDiffCommand("git show abc123"), true);
    assert.strictEqual(isDiffCommand("git show abc123:path/to/file.ts"), true);
    assert.strictEqual(isDiffCommand("  git show HEAD~1  "), true);
  });

  it("does not match `git show-ref` or `git show-branch`", () => {
    assert.strictEqual(isDiffCommand("git show-ref"), false);
    assert.strictEqual(isDiffCommand("git show-branch"), false);
    assert.strictEqual(isDiffCommand("git show-ref --heads"), false);
  });

  it("matches `git diff` with various flags", () => {
    assert.strictEqual(isDiffCommand("git diff"), true);
    assert.strictEqual(isDiffCommand("git diff --cached"), true);
    assert.strictEqual(isDiffCommand("git diff HEAD~1 HEAD"), true);
    assert.strictEqual(isDiffCommand("git diff -- src/"), true);
  });

  it("does not match commands that merely start with `git diff` as a substring", () => {
    assert.strictEqual(isDiffCommand("git diffx"), false);
    assert.strictEqual(isDiffCommand("git difftool"), false);
  });

  it("matches `git log` only when -p / --patch is present", () => {
    assert.strictEqual(isDiffCommand("git log"), false);
    assert.strictEqual(isDiffCommand("git log --oneline"), false);
    assert.strictEqual(isDiffCommand("git log -p"), true);
    assert.strictEqual(isDiffCommand("git log --patch"), true);
    assert.strictEqual(isDiffCommand("git log -p -- src/"), true);
    assert.strictEqual(isDiffCommand("git log --patch -- src/"), true);
  });

  it("matches `git format-patch`", () => {
    assert.strictEqual(isDiffCommand("git format-patch HEAD~3"), true);
    assert.strictEqual(isDiffCommand("git format-patch -1 HEAD"), true);
  });

  it("matches `git stash show` only when -p / --patch is present", () => {
    assert.strictEqual(isDiffCommand("git stash show"), false);
    assert.strictEqual(isDiffCommand("git stash show -p"), true);
    assert.strictEqual(isDiffCommand("git stash show --patch"), true);
    assert.strictEqual(isDiffCommand("git stash show -p stash@{0}"), true);
  });

  it("rejects unrelated commands", () => {
    assert.strictEqual(isDiffCommand(""), false);
    assert.strictEqual(isDiffCommand("git status"), false);
    assert.strictEqual(isDiffCommand("npm test"), false);
    assert.strictEqual(isDiffCommand("ls -la"), false);
    assert.strictEqual(isDiffCommand("show diff"), false);
  });
});

// ── M2.1: ToolError classification on ToolResult ─────────────────────────

function makeTool(opts: {
  name?: string;
  needsPermission?: boolean;
  run: ToolSpec["run"];
}): ToolSpec {
  return {
    name: opts.name ?? "test_tool",
    description: "test",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    needsPermission: opts.needsPermission ?? false,
    run: opts.run,
  };
}

const allowAll = async () => "allow" as const;
const ctx = { cwd: process.cwd() };

describe("ToolExecutor — typed error classification", () => {
  it("lifts ToolError code / recoverable / suggestion onto the result", async () => {
    const tool = makeTool({
      run: async () => {
        throw new ToolError({
          code: "timeout",
          message: "took too long",
          suggestion: "retry with a smaller request",
        });
      },
    });
    const exec = new ToolExecutor([tool]);
    const res = await exec.run(
      { id: "c1", name: "test_tool", arguments: "{}" },
      allowAll,
      ctx,
    );
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "timeout");
    assert.strictEqual(res.recoverable, true);
    assert.strictEqual(res.suggestion, "retry with a smaller request");
    assert.match(res.content, /took too long/);
  });

  it("classifies a plain Error from the tool as 'unknown', not recoverable", async () => {
    const tool = makeTool({
      run: async () => {
        throw new Error("kaboom");
      },
    });
    const exec = new ToolExecutor([tool]);
    const res = await exec.run(
      { id: "c2", name: "test_tool", arguments: "{}" },
      allowAll,
      ctx,
    );
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "unknown");
    assert.strictEqual(res.recoverable, false);
    assert.strictEqual(res.suggestion, undefined);
  });

  it("classifies invalid JSON arguments as 'invalid_args'", async () => {
    const tool = makeTool({ run: async () => "ok" });
    const exec = new ToolExecutor([tool]);
    const res = await exec.run(
      { id: "c3", name: "test_tool", arguments: "not-json{" },
      allowAll,
      ctx,
    );
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "invalid_args");
    assert.strictEqual(res.recoverable, false);
  });

  it("classifies unknown tool name as 'not_found'", async () => {
    const exec = new ToolExecutor([]);
    const res = await exec.run(
      { id: "c4", name: "missing", arguments: "{}" },
      allowAll,
      ctx,
    );
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "not_found");
    assert.strictEqual(res.recoverable, false);
  });

  it("classifies a denied permission as 'permission_denied'", async () => {
    const tool = makeTool({
      needsPermission: true,
      run: async () => "ok",
    });
    const exec = new ToolExecutor([tool]);
    const res = await exec.run(
      { id: "c5", name: "test_tool", arguments: "{}" },
      async () => "deny",
      ctx,
    );
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "permission_denied");
    assert.strictEqual(res.recoverable, false);
  });

  it("leaves successful results without classification fields", async () => {
    const tool = makeTool({ run: async () => "happy path" });
    const exec = new ToolExecutor([tool]);
    const res = await exec.run(
      { id: "c6", name: "test_tool", arguments: "{}" },
      allowAll,
      ctx,
    );
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.errorCode, undefined);
    assert.strictEqual(res.recoverable, undefined);
    assert.strictEqual(res.suggestion, undefined);
  });
});

// ── M2.2: typed PermissionDecisionResult ─────────────────────────────────

describe("toPermissionResult", () => {
  it("maps legacy 'allow' to { allow, once }", () => {
    assert.deepStrictEqual(toPermissionResult("allow"), {
      decision: "allow",
      scope: "once",
    });
  });

  it("maps legacy 'allow_session' to { allow, session }", () => {
    assert.deepStrictEqual(toPermissionResult("allow_session"), {
      decision: "allow",
      scope: "session",
    });
  });

  it("maps legacy 'deny' to { deny, once }", () => {
    assert.deepStrictEqual(toPermissionResult("deny"), {
      decision: "deny",
      scope: "once",
    });
  });

  it("passes the typed shape through unchanged", () => {
    const typed: PermissionDecisionResult = { decision: "allow", scope: "pattern" };
    assert.strictEqual(toPermissionResult(typed), typed);
  });
});

describe("ToolExecutor — typed PermissionDecisionResult handling", () => {
  function makeTool(name = "needs_perm"): ToolSpec {
    return {
      name,
      description: "test",
      parameters: { type: "object", properties: {}, additionalProperties: true },
      needsPermission: true,
      run: async () => "ok",
    };
  }
  const ctx2: ToolContext = { cwd: process.cwd() };

  it("scope 'once' does NOT cache — re-asks on the next call", async () => {
    const tool = makeTool();
    const exec = new ToolExecutor([tool]);
    let prompts = 0;
    const ask: PermissionAsker = async () => {
      prompts += 1;
      return { decision: "allow", scope: "once" };
    };
    await exec.run({ id: "a", name: tool.name, arguments: "{}" }, ask, ctx2);
    await exec.run({ id: "b", name: tool.name, arguments: "{}" }, ask, ctx2);
    assert.strictEqual(prompts, 2);
  });

  it("scope 'session' caches — skips the asker on the second call", async () => {
    const tool = makeTool();
    const exec = new ToolExecutor([tool]);
    let prompts = 0;
    const ask: PermissionAsker = async () => {
      prompts += 1;
      return { decision: "allow", scope: "session" };
    };
    await exec.run({ id: "a", name: tool.name, arguments: "{}" }, ask, ctx2);
    await exec.run({ id: "b", name: tool.name, arguments: "{}" }, ask, ctx2);
    assert.strictEqual(prompts, 1);
  });

  it("scope 'pattern' does NOT cache — the pattern itself lives in settings.json", async () => {
    const tool = makeTool();
    const exec = new ToolExecutor([tool]);
    let prompts = 0;
    const ask: PermissionAsker = async () => {
      prompts += 1;
      return { decision: "allow", scope: "pattern" };
    };
    await exec.run({ id: "a", name: tool.name, arguments: "{}" }, ask, ctx2);
    await exec.run({ id: "b", name: tool.name, arguments: "{}" }, ask, ctx2);
    assert.strictEqual(prompts, 2);
  });

  it("deny is honored regardless of scope", async () => {
    const tool = makeTool();
    const exec = new ToolExecutor([tool]);
    const ask: PermissionAsker = async () => ({ decision: "deny", scope: "once" });
    const res = await exec.run({ id: "a", name: tool.name, arguments: "{}" }, ask, ctx2);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.errorCode, "permission_denied");
  });

  it("legacy 'allow_session' string is still cached (back-compat)", async () => {
    const tool = makeTool();
    const exec = new ToolExecutor([tool]);
    let prompts = 0;
    const ask: PermissionAsker = async () => {
      prompts += 1;
      return "allow_session";
    };
    await exec.run({ id: "a", name: tool.name, arguments: "{}" }, ask, ctx2);
    await exec.run({ id: "b", name: tool.name, arguments: "{}" }, ask, ctx2);
    assert.strictEqual(prompts, 1);
  });

  it("legacy 'allow' string is NOT cached (back-compat)", async () => {
    const tool = makeTool();
    const exec = new ToolExecutor([tool]);
    let prompts = 0;
    const ask: PermissionAsker = async () => {
      prompts += 1;
      return "allow";
    };
    await exec.run({ id: "a", name: tool.name, arguments: "{}" }, ask, ctx2);
    await exec.run({ id: "b", name: tool.name, arguments: "{}" }, ask, ctx2);
    assert.strictEqual(prompts, 2);
  });
});
