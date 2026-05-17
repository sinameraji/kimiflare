import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { planSetTool, planUpdateTool } from "./plan.js";
import { isToolError, type ToolError } from "./tool-error.js";
import { _resetPlanStateForTests, getPlan, summarizePlan } from "../agent/plan-state.js";

const ctx = { cwd: "/tmp", sessionId: "test_session" };

describe("plan_set tool", () => {
  beforeEach(() => _resetPlanStateForTests());

  it("normalizes tasks: auto-assigns IDs, defaults status to pending", async () => {
    const result = await planSetTool.run(
      { tasks: [{ description: "first" }, { description: "second", status: "in_progress" }] },
      ctx,
    );
    assert.match(String(result), /2 tasks/);
    const plan = getPlan("test_session");
    assert.equal(plan[0]!.id, "t1");
    assert.equal(plan[0]!.status, "pending");
    assert.equal(plan[1]!.id, "t2");
    assert.equal(plan[1]!.status, "in_progress");
  });

  it("preserves explicit IDs", async () => {
    await planSetTool.run(
      { tasks: [{ id: "alpha", description: "x" }, { id: "beta", description: "y" }] },
      ctx,
    );
    const plan = getPlan("test_session");
    assert.equal(plan[0]!.id, "alpha");
    assert.equal(plan[1]!.id, "beta");
  });

  it("rejects empty description with invalid_args", async () => {
    await assert.rejects(
      planSetTool.run({ tasks: [{ description: "   " }] }, ctx),
      (e: unknown) => isToolError(e) && (e as ToolError).code === "invalid_args",
    );
  });

  it("rejects non-array tasks", async () => {
    await assert.rejects(
      planSetTool.run({ tasks: "not an array" as never }, ctx),
      (e: unknown) => isToolError(e) && (e as ToolError).code === "invalid_args",
    );
  });
});

describe("plan_update tool", () => {
  beforeEach(() => _resetPlanStateForTests());

  it("flips status and returns updated summary", async () => {
    await planSetTool.run({ tasks: [{ description: "a" }, { description: "b" }] }, ctx);
    const out = await planUpdateTool.run({ task_id: "t1", status: "completed" }, ctx);
    assert.match(String(out), /t1 → completed/);
    assert.match(String(out), /1.*outstanding/);
    assert.equal(summarizePlan("test_session").completed, 1);
  });

  it("requires `notes` when marking abandoned", async () => {
    await planSetTool.run({ tasks: [{ description: "x" }] }, ctx);
    await assert.rejects(
      planUpdateTool.run({ task_id: "t1", status: "abandoned" }, ctx),
      (e: unknown) =>
        isToolError(e) && (e as ToolError).code === "invalid_args" &&
        /notes/i.test((e as ToolError).message),
    );
    // With notes, it works.
    const ok = await planUpdateTool.run(
      { task_id: "t1", status: "abandoned", notes: "turned out to be unnecessary" },
      ctx,
    );
    assert.match(String(ok), /abandoned/);
  });

  it("returns not_found ToolError when task_id is unknown", async () => {
    await planSetTool.run({ tasks: [{ description: "x" }] }, ctx);
    await assert.rejects(
      planUpdateTool.run({ task_id: "bogus", status: "completed" }, ctx),
      (e: unknown) => isToolError(e) && (e as ToolError).code === "not_found",
    );
  });

  it("rejects invalid status with invalid_args", async () => {
    await planSetTool.run({ tasks: [{ description: "x" }] }, ctx);
    await assert.rejects(
      planUpdateTool.run({ task_id: "t1", status: "done" as never }, ctx),
      (e: unknown) => isToolError(e) && (e as ToolError).code === "invalid_args",
    );
  });
});
