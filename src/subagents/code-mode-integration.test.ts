/**
 * Code-mode + subagent integration tests (M7.1 follow-up).
 *
 * Verifies the three pieces of the "Agent is a first-class code-mode
 * primitive" fix:
 *   1. Agent docstring in the generated TS API includes Promise.all
 *      composition example.
 *   2. Concurrent dispatch (simulating Promise.all from inside the
 *      sandbox) respects the per-turn fanout cap atomically.
 *   3. The code-mode nudge fires once per session and only when
 *      conditions hold.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AgentTurnOpts } from "../agent/loop.js";
import type { ToolSpec } from "../tools/registry.js";
import { isToolError, type ToolError } from "../tools/tool-error.js";
import { ToolExecutor } from "../tools/executor.js";
import { makeSubagentRunner, _resetSubagentCountsForTests } from "../agent/subagent.js";
import { generateTypeScriptApi } from "../code-mode/api-generator.js";
import { ALL_TOOLS } from "../tools/executor.js";
import { getOrchestrationTools } from "./tier-gate.js";
import {
  shouldFireCodeModeNudge,
  CODE_MODE_NUDGE_TEXT,
  _resetCodeModeNudgeForTests,
} from "./code-mode-nudge.js";

function makeTool(name: string, needsPermission = false): ToolSpec {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: "object" },
    needsPermission,
    run: async () => "",
  };
}

describe("Agent docstring in code-mode TS API (composition surface)", () => {
  it("includes Promise.all parallel-dispatch example", () => {
    const tools = [...ALL_TOOLS, ...getOrchestrationTools("heavy")];
    const api = generateTypeScriptApi(tools);
    assert.match(api, /Promise\.all\(\[/, "Promise.all syntax must appear in docstring");
    assert.match(api, /api\.Agent\(/, "api.Agent call must appear in example");
    assert.match(api, /PARALLEL DISPATCH/, "parallel section header should be in docstring");
  });

  it("Agent sorts near the top of the alphabetical API listing", () => {
    const tools = [...ALL_TOOLS, ...getOrchestrationTools("heavy")];
    const api = generateTypeScriptApi(tools);
    // Find the position of Agent's method signature vs. e.g. bash's.
    const agentIdx = api.indexOf("Agent(input: Agent_Input)");
    const bashIdx = api.indexOf("bash(input: bash_Input)");
    assert.ok(agentIdx > 0, "Agent method signature must be present");
    assert.ok(bashIdx > 0, "bash method signature must be present");
    assert.ok(agentIdx < bashIdx, "Agent should sort before bash (capital A first)");
  });

  it("Agent does NOT appear in code-mode API when tier is light", () => {
    const tools = [...ALL_TOOLS, ...getOrchestrationTools("light")];
    const api = generateTypeScriptApi(tools);
    assert.doesNotMatch(api, /Agent\(input:/, "Agent must not appear in light-tier API");
  });
});

describe("Concurrent subagent dispatch (Promise.all from code mode)", () => {
  beforeEach(() => _resetSubagentCountsForTests());

  it("atomic check-and-reserve: 10 concurrent dispatches → first 8 succeed (cap), last 2 reject", async () => {
    // We can't really run children without an LLM, so we test the
    // counter mechanics by intercepting at the depth cap (cheapest
    // synchronous rejection that still increments after the cap check).
    // To exercise the per-turn cap specifically, we drive the runner
    // to attempt 10 concurrent dispatches and confirm exactly 2 hit
    // the fanout-cap rejection.
    //
    // Trick: we use depth=1 so the depth cap doesn't block (only
    // depth>=2 rejects). The fanout cap (8) DOES block. The first 8
    // pass cap check + slot reservation; the next 2 fail.
    //
    // To prevent the 8 successful calls from actually invoking
    // runAgentTurn (which would hit the network), we override
    // parent.signal to be already-aborted. That makes runAgentTurn
    // throw immediately, which the runner converts to a ToolError.
    // The IMPORTANT assertion is that the 2 cap-exceeding calls are
    // distinguishable by their error code from the 8 that passed.
    const controller = new AbortController();
    controller.abort("test_short_circuit");
    const parent: AgentTurnOpts = {
      accountId: "x",
      apiToken: "x",
      model: "x",
      messages: [],
      tools: [makeTool("read")],
      executor: new ToolExecutor([makeTool("read")]),
      cwd: "/tmp",
      signal: controller.signal,
      callbacks: {
        askPermission: async () => ({ decision: "allow", scope: "once" }),
      },
      sessionId: "concurrent_test",
      subagentDepth: 1, // child→grandchild would hit depth cap; depth=1 is allowed
    };
    const runSubagent = makeSubagentRunner(parent);

    const promises = Array.from({ length: 10 }, (_, i) =>
      runSubagent({
        description: `task ${i}`,
        prompt: `do task ${i}`,
        subagent_type: "explore",
      }).then(
        () => ({ status: "fulfilled" as const }),
        (e: unknown) => ({
          status: "rejected" as const,
          code: isToolError(e) ? (e as ToolError).code : "non_tool_error",
          message: e instanceof Error ? e.message : String(e),
        }),
      ),
    );
    const results = await Promise.all(promises);
    const fanoutRejected = results.filter(
      (r) => r.status === "rejected" && /Per-turn subagent cap/.test((r as { message: string }).message),
    );
    assert.equal(fanoutRejected.length, 2, "exactly 2 of 10 must trip the per-turn cap");
  });
});

describe("Code-mode nudge gating", () => {
  beforeEach(() => _resetCodeModeNudgeForTests());

  it("fires once per session, then never again", () => {
    assert.ok(shouldFireCodeModeNudge("session_a"));
    assert.ok(!shouldFireCodeModeNudge("session_a"));
    assert.ok(!shouldFireCodeModeNudge("session_a"));
  });

  it("partitions per session", () => {
    assert.ok(shouldFireCodeModeNudge("session_a"));
    assert.ok(shouldFireCodeModeNudge("session_b"));
    assert.ok(!shouldFireCodeModeNudge("session_a"));
  });

  it("nudge text contains the Promise.all pattern and api.Agent call", () => {
    assert.match(CODE_MODE_NUDGE_TEXT, /Promise\.all/);
    assert.match(CODE_MODE_NUDGE_TEXT, /api\.Agent/);
    assert.match(CODE_MODE_NUDGE_TEXT, /isolated context/i);
  });
});
