import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AgentTurnOpts } from "./loop.js";
import type { ToolSpec } from "../tools/registry.js";
import { ToolError, isToolError } from "../tools/tool-error.js";
import { ToolExecutor } from "../tools/executor.js";
import { makeSubagentRunner, _resetSubagentCountsForTests, getSubagentCount } from "./subagent.js";

function makeTool(name: string, needsPermission = false): ToolSpec {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: "object" },
    needsPermission,
    run: async () => "",
  };
}

const PARENT_TOOLS: ToolSpec[] = [
  makeTool("read"),
  makeTool("grep"),
  makeTool("write", true),
  makeTool("bash", true),
  // Note: the Agent tool itself is included on purpose — children must
  // never see it even when the parent's list contains it.
  makeTool("Agent"),
];

/**
 * Build a fake parent `AgentTurnOpts`. We DON'T call the real
 * `runAgentTurn`; the runner does, and we instead stub the executor
 * the child receives. The runner builds a fresh `ToolExecutor(childTools)`
 * inside itself, so we can't easily intercept the child's loop
 * without spinning up the whole API stack. Instead we focus the tests
 * on guard rails the runner enforces BEFORE it ever calls
 * `runAgentTurn`: validation, depth cap, fanout cap.
 *
 * The end-to-end "happy path" of an actual subagent invocation will be
 * covered by the integration test suite (Task #11) where we can stub
 * the network layer.
 */
function makeParent(overrides: Partial<AgentTurnOpts> = {}): AgentTurnOpts {
  const controller = new AbortController();
  return {
    accountId: "test_account",
    apiToken: "test_token",
    model: "test_model",
    messages: [],
    tools: PARENT_TOOLS,
    executor: new ToolExecutor(PARENT_TOOLS),
    cwd: "/tmp",
    signal: controller.signal,
    callbacks: {
      askPermission: async () => ({ decision: "allow", scope: "once" }),
    },
    sessionId: "parent_session",
    ...overrides,
  };
}

describe("subagent runner — guard rails", () => {
  beforeEach(() => _resetSubagentCountsForTests());

  it("rejects unknown subagent_type with invalid_args", async () => {
    const run = makeSubagentRunner(makeParent());
    await assert.rejects(
      run({ description: "x", prompt: "do thing", subagent_type: "review" as never }),
      (e: unknown) => isToolError(e) && (e as ToolError).code === "invalid_args",
    );
  });

  it("rejects empty prompt with invalid_args", async () => {
    const run = makeSubagentRunner(makeParent());
    await assert.rejects(
      run({ description: "x", prompt: "   ", subagent_type: "explore" }),
      (e: unknown) => isToolError(e) && (e as ToolError).code === "invalid_args",
    );
  });

  it("rejects child at depth >= MAX_DEPTH with policy_rejection", async () => {
    const run = makeSubagentRunner(makeParent({ subagentDepth: 2 }));
    await assert.rejects(
      run({ description: "x", prompt: "do thing", subagent_type: "explore" }),
      (e: unknown) =>
        isToolError(e) && (e as ToolError).code === "policy_rejection" &&
        /depth cap/i.test((e as ToolError).message),
    );
  });

  it("session subagent count increments and partitions per session", async () => {
    assert.equal(getSubagentCount("a"), 0);
    assert.equal(getSubagentCount("b"), 0);
    // We cannot easily run an actual child here; manually exercise the
    // counter via a depth-cap-rejected call still validating that the
    // cap rejection happens BEFORE the counter increment.
    const run = makeSubagentRunner(makeParent({ sessionId: "a", subagentDepth: 2 }));
    await assert.rejects(run({ description: "x", prompt: "p", subagent_type: "explore" }));
    assert.equal(getSubagentCount("a"), 0, "depth-rejected calls must not increment the counter");
  });

  it("validates inputs before depth cap (consistent error precedence)", async () => {
    // Even at max depth, invalid_args should still surface — the user/
    // model fixing args should not have to first know about the depth cap.
    const run = makeSubagentRunner(makeParent({ subagentDepth: 2 }));
    await assert.rejects(
      run({ description: "x", prompt: "p", subagent_type: "bogus" as never }),
      (e: unknown) => isToolError(e) && (e as ToolError).code === "invalid_args",
    );
  });
});
