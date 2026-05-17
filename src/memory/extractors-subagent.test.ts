import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXTRACTORS } from "./extractors.js";

const subagentExtractor = EXTRACTORS.find((e) => e.id === "subagent_finding")!;

describe("subagent_finding extractor (M7.1)", () => {
  it("is registered", () => {
    assert.ok(subagentExtractor);
  });

  it("matches the Agent tool only", () => {
    assert.equal(subagentExtractor.match("Agent", undefined), true);
    assert.equal(subagentExtractor.match("read", undefined), false);
    assert.equal(subagentExtractor.match("plan_set", undefined), false);
  });

  it("extracts a structured event memory keyed by task_id when present", async () => {
    const result = await subagentExtractor.extract(
      "[Agent(explore) · find validateSession · 4 tool calls · 320ms · transcript=art_5]\n\nFound 3 callers:\n  - src/auth/middleware.ts:42\n  - src/session/loader.ts:18\n  - src/util/auth.ts:7\n\n[Use expand_artifact(art_5) to see the full child transcript.]",
      undefined,
      {
        toolArgs: {
          description: "find validateSession",
          subagent_type: "explore",
          task_id: "t1",
        },
      },
    );
    assert.ok(result);
    assert.equal(result!.category, "event");
    assert.equal(result!.topicKey, "child_summary_t1");
    assert.match(result!.content, /Subagent\(explore\)/);
    assert.match(result!.content, /find validateSession/);
    assert.match(result!.content, /3 callers/);
    // Header and footer stripped:
    assert.doesNotMatch(result!.content, /\[Agent\(/);
    assert.doesNotMatch(result!.content, /expand_artifact/);
  });

  it("falls back to description-based topicKey when no task_id", async () => {
    const result = await subagentExtractor.extract(
      "[Agent(explore) · summarize loop guards · 2 tool calls · 100ms]\n\nThree guards: anti-loop, web-fetch caps, plan-stall.",
      undefined,
      {
        toolArgs: {
          description: "summarize loop guards",
          subagent_type: "explore",
        },
      },
    );
    assert.ok(result);
    assert.equal(result!.topicKey, "child_summary_summarize_loop_guards");
  });

  it("returns null on empty summary", async () => {
    const result = await subagentExtractor.extract(
      "[Agent(explore) · x · 0 tool calls · 5ms]\n\n",
      undefined,
      { toolArgs: { description: "x", subagent_type: "explore" } },
    );
    assert.equal(result, null);
  });

  it("caps content at ~600 chars", async () => {
    const longSummary = "X".repeat(2000);
    const result = await subagentExtractor.extract(
      `[Agent(explore) · big report · 1 tool calls · 50ms]\n\n${longSummary}`,
      undefined,
      { toolArgs: { description: "big report", subagent_type: "explore" } },
    );
    assert.ok(result);
    // 600 cap + framing prefix; just confirm it's bounded.
    assert.ok(result!.content.length < 800);
  });
});
