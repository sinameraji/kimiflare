import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOrchestrationTools } from "./tier-gate.js";

function names(tools: ReturnType<typeof getOrchestrationTools>): string[] {
  return tools.map((t) => t.name);
}

describe("getOrchestrationTools — tier gating", () => {
  it("light tier returns no orchestration tools", () => {
    assert.deepEqual(names(getOrchestrationTools("light")), []);
  });

  it("medium tier returns Agent only (explore-narrowed)", () => {
    const tools = getOrchestrationTools("medium");
    assert.deepEqual(names(tools), ["Agent"]);
    const agentTool = tools[0]!;
    const enumVals = (
      (agentTool.parameters as { properties: { subagent_type: { enum: string[] } } })
        .properties.subagent_type.enum
    );
    assert.deepEqual(enumVals, ["explore"]);
  });

  it("heavy tier returns full surface: Agent (all types) + plan_set + plan_update", () => {
    const tools = getOrchestrationTools("heavy");
    assert.deepEqual(names(tools).sort(), ["Agent", "plan_set", "plan_update"]);
    const agentTool = tools.find((t) => t.name === "Agent")!;
    const enumVals = (
      (agentTool.parameters as { properties: { subagent_type: { enum: string[] } } })
        .properties.subagent_type.enum
    );
    assert.deepEqual(enumVals.sort(), ["explore", "general", "plan"]);
  });

  it("undefined tier defaults to light (no orchestration)", () => {
    assert.deepEqual(names(getOrchestrationTools(undefined)), []);
  });

  it("medium-tier Agent tool rejects general/plan subagent types at runtime", async () => {
    const tools = getOrchestrationTools("medium");
    const agent = tools[0]!;
    // Stub a context that has runSubagent — we want to verify the
    // policy_rejection fires BEFORE it would be called.
    const ctx = {
      cwd: "/tmp",
      runSubagent: async () => {
        throw new Error("should never be called when tier rejects type");
      },
    };
    await assert.rejects(
      agent.run(
        { description: "x", prompt: "do thing", subagent_type: "general" },
        ctx,
      ),
      (e: unknown) =>
        e instanceof Error && e.name === "ToolError" && /not available at this tier/.test(e.message),
    );
  });

  it("medium-tier Agent tool accepts explore type and reaches runSubagent", async () => {
    const tools = getOrchestrationTools("medium");
    const agent = tools[0]!;
    let called = false;
    const ctx = {
      cwd: "/tmp",
      runSubagent: async () => {
        called = true;
        return {
          summary: "child says hi",
          transcript: [],
          childSessionId: "p.sub1",
          toolCallCount: 0,
          durationMs: 1,
        };
      },
    };
    const out = await agent.run(
      { description: "find x", prompt: "find all callers of X", subagent_type: "explore" },
      ctx,
    );
    assert.ok(called, "runSubagent must be invoked for allowed type");
    assert.match(String(out), /child says hi/);
  });
});
