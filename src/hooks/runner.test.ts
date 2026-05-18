import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  filterHooks,
  runHooks,
  setSpawnHookImplForTesting,
  type SpawnHookImpl,
} from "./runner.js";
import type { HookConfig, HookPayload } from "./types.js";

const samplePayload: HookPayload = {
  event: "PreToolUse",
  session_id: "sess_abc",
  cwd: "/tmp/proj",
  tool: "edit",
  args: { path: "/tmp/proj/foo.ts" },
};

beforeEach(() => {
  setSpawnHookImplForTesting(null);
});

afterEach(() => {
  setSpawnHookImplForTesting(null);
});

function mockSpawn(behavior: {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  capture?: (args: { command: string; payload: string; env: NodeJS.ProcessEnv }) => void;
}): void {
  const impl: SpawnHookImpl = async (command, payloadJson, env) => {
    behavior.capture?.({ command, payload: payloadJson, env });
    return {
      exitCode: behavior.exitCode ?? 0,
      stdout: behavior.stdout ?? "",
      stderr: behavior.stderr ?? "",
      timedOut: behavior.timedOut ?? false,
    };
  };
  setSpawnHookImplForTesting(impl);
}

describe("filterHooks", () => {
  it("returns [] for undefined or empty", () => {
    assert.deepStrictEqual(filterHooks(undefined, "x"), []);
    assert.deepStrictEqual(filterHooks([], "x"), []);
  });

  it("drops disabled hooks", () => {
    const a: HookConfig = { id: "a", command: "echo a", enabled: false };
    const b: HookConfig = { id: "b", command: "echo b", enabled: true };
    assert.deepStrictEqual(filterHooks([a, b], null), [b]);
  });

  it("keeps a hook with no matcher regardless of tool name", () => {
    const h: HookConfig = { id: "x", command: "x" };
    assert.strictEqual(filterHooks([h], "anything").length, 1);
    assert.strictEqual(filterHooks([h], null).length, 1);
  });

  it("filters by matcher regex when tool name is provided", () => {
    const editOnly: HookConfig = { id: "edit", command: "x", matcher: "^edit$" };
    const writeOrEdit: HookConfig = { id: "ew", command: "y", matcher: "^(edit|write)$" };
    const hooks = [editOnly, writeOrEdit];
    assert.deepStrictEqual(filterHooks(hooks, "edit").map((h) => h.id), ["edit", "ew"]);
    assert.deepStrictEqual(filterHooks(hooks, "write").map((h) => h.id), ["ew"]);
    assert.deepStrictEqual(filterHooks(hooks, "bash"), []);
  });

  it("treats a malformed regex as matching nothing rather than throwing", () => {
    const h: HookConfig = { id: "bad", command: "x", matcher: "([" };
    assert.deepStrictEqual(filterHooks([h], "edit"), []);
  });
});

describe("runHooks — informational events (Stop, PostToolUse)", () => {
  it("runs every matching hook, ignores exit codes for non-veto events", async () => {
    let calls = 0;
    mockSpawn({
      exitCode: 1, // would veto if this were a veto event
      capture: () => {
        calls += 1;
      },
    });
    const hooks: HookConfig[] = [
      { id: "h1", command: "echo 1" },
      { id: "h2", command: "echo 2" },
    ];
    const outcome = await runHooks(
      "Stop",
      hooks,
      { event: "Stop", session_id: "s", cwd: "/tmp" },
      null,
    );
    assert.strictEqual(calls, 2);
    assert.strictEqual(outcome.vetoed, false);
  });

  it("captures stdout (trimmed)", async () => {
    mockSpawn({ stdout: "  hello world  \n" });
    const outcome = await runHooks(
      "Stop",
      [{ id: "h", command: "echo" }],
      { event: "Stop", session_id: "s", cwd: "/tmp" },
    );
    assert.strictEqual(outcome.outcomes[0]!.stdout, "hello world");
  });
});

describe("runHooks — veto events (PreToolUse, UserPromptSubmit)", () => {
  it("non-zero exit vetoes a PreToolUse and stops further hooks", async () => {
    let callCount = 0;
    setSpawnHookImplForTesting(async () => {
      callCount += 1;
      // First hook denies; second should never run
      return callCount === 1
        ? { exitCode: 1, stdout: "no thanks", stderr: "", timedOut: false }
        : { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    });
    const hooks: HookConfig[] = [
      { id: "deny", command: "exit 1" },
      { id: "after", command: "echo never" },
    ];
    const outcome = await runHooks("PreToolUse", hooks, samplePayload, "edit");
    assert.strictEqual(outcome.vetoed, true);
    assert.strictEqual(outcome.vetoReason, "no thanks");
    assert.strictEqual(callCount, 1, "second hook must not run after veto");
  });

  it("falls back to stderr or a synthetic message when stdout is empty", async () => {
    mockSpawn({ exitCode: 2, stdout: "", stderr: "" });
    const outcome = await runHooks("PreToolUse", [{ id: "x", command: "x" }], samplePayload, "edit");
    assert.strictEqual(outcome.vetoed, true);
    assert.match(outcome.vetoReason, /hook x exited 2/);
  });

  it("timeout also vetoes a PreToolUse", async () => {
    mockSpawn({ timedOut: true, exitCode: null });
    const outcome = await runHooks("PreToolUse", [{ id: "slow", command: "sleep 999" }], samplePayload, "edit");
    assert.strictEqual(outcome.vetoed, true);
    assert.strictEqual(outcome.outcomes[0]!.timedOut, true);
  });

  it("zero exit allows the call (no veto)", async () => {
    mockSpawn({ exitCode: 0, stdout: "ok" });
    const outcome = await runHooks("PreToolUse", [{ id: "ok", command: "x" }], samplePayload, "edit");
    assert.strictEqual(outcome.vetoed, false);
  });
});

describe("runHooks — env var exposure", () => {
  it("exposes KIMIFLARE_HOOK_PATH for tool-args.path", async () => {
    let env: NodeJS.ProcessEnv = {};
    mockSpawn({
      capture: (args) => {
        env = args.env;
      },
    });
    await runHooks("PreToolUse", [{ id: "x", command: "x" }], samplePayload, "edit");
    assert.strictEqual(env.KIMIFLARE_HOOK_PATH, "/tmp/proj/foo.ts");
    assert.strictEqual(env.KIMIFLARE_HOOK_TOOL, "edit");
    assert.strictEqual(env.KIMIFLARE_HOOK_EVENT, "PreToolUse");
    assert.strictEqual(env.KIMIFLARE_HOOK_SESSION_ID, "sess_abc");
    assert.ok(env.KIMIFLARE_HOOK_PAYLOAD, "full JSON payload should be in env");
  });

  it("exposes KIMIFLARE_HOOK_RESULT_OK on PostToolUse", async () => {
    let env: NodeJS.ProcessEnv = {};
    mockSpawn({
      capture: (args) => {
        env = args.env;
      },
    });
    const payload: HookPayload = {
      event: "PostToolUse",
      session_id: "s",
      cwd: "/tmp",
      tool: "edit",
      args: { path: "/tmp/x.ts" },
      result: { ok: false, content: "boom", errorCode: "unknown" },
    };
    await runHooks("PostToolUse", [{ id: "x", command: "x" }], payload, "edit");
    assert.strictEqual(env.KIMIFLARE_HOOK_RESULT_OK, "false");
    assert.strictEqual(env.KIMIFLARE_HOOK_RESULT_ERROR_CODE, "unknown");
  });
});
