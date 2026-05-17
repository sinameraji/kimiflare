import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  setPlan,
  getPlan,
  updatePlanTask,
  summarizePlan,
  nextStallAction,
  clearStall,
  PlanTaskNotFoundError,
  MAX_PLAN_STALLS,
  _resetPlanStateForTests,
  isValidPlanTaskStatus,
} from "./plan-state.js";

describe("plan-state", () => {
  beforeEach(() => _resetPlanStateForTests());

  it("setPlan + getPlan round-trip per session", () => {
    setPlan("s1", [
      { id: "t1", description: "do x", status: "pending" },
      { id: "t2", description: "do y", status: "in_progress" },
    ]);
    setPlan("s2", [{ id: "t1", description: "different", status: "pending" }]);
    assert.equal(getPlan("s1").length, 2);
    assert.equal(getPlan("s2").length, 1);
    assert.equal(getPlan("s2")[0]!.description, "different");
  });

  it("summarizePlan counts statuses + reports allTerminal", () => {
    setPlan("s", [
      { id: "1", description: "a", status: "pending" },
      { id: "2", description: "b", status: "completed" },
      { id: "3", description: "c", status: "abandoned" },
    ]);
    const sum = summarizePlan("s");
    assert.equal(sum.total, 3);
    assert.equal(sum.pending, 1);
    assert.equal(sum.completed, 1);
    assert.equal(sum.abandoned, 1);
    assert.equal(sum.allTerminal, false);
    assert.equal(sum.outstanding.length, 1);

    // Flip the last pending to completed → allTerminal true.
    updatePlanTask("s", { task_id: "1", status: "completed" });
    assert.equal(summarizePlan("s").allTerminal, true);
  });

  it("empty plan is allTerminal — non-heavy turns hit the same branch and pass through", () => {
    assert.equal(summarizePlan("never_set").allTerminal, true);
    assert.equal(nextStallAction("never_set"), null);
  });

  it("updatePlanTask throws PlanTaskNotFoundError for unknown task or empty plan", () => {
    assert.throws(
      () => updatePlanTask("nothing", { task_id: "x", status: "completed" }),
      PlanTaskNotFoundError,
    );
    setPlan("s", [{ id: "real", description: "x", status: "pending" }]);
    assert.throws(
      () => updatePlanTask("s", { task_id: "bogus", status: "completed" }),
      PlanTaskNotFoundError,
    );
  });

  it("nextStallAction returns null when all terminal, nudge otherwise, capped by MAX_PLAN_STALLS", () => {
    setPlan("s", [{ id: "1", description: "a", status: "pending" }]);

    // Stalls 1..MAX_PLAN_STALLS should all return a nudge.
    for (let i = 1; i <= MAX_PLAN_STALLS; i++) {
      const action = nextStallAction("s");
      assert.ok(action, `stall ${i} should produce a nudge`);
      assert.match(action!.nudge, /Plan check/);
      assert.match(action!.nudge, new RegExp(`Stall ${i}/${MAX_PLAN_STALLS}`));
    }
    // MAX_PLAN_STALLS+1 (4th overall): we exceeded → return null,
    // letting the turn end. The model wins the standoff if it really
    // can't make progress — we don't lock it in forever.
    assert.equal(nextStallAction("s"), null);
  });

  it("clearStall resets the counter so a future empty turn starts fresh", () => {
    setPlan("s", [{ id: "1", description: "a", status: "pending" }]);
    nextStallAction("s"); // stall 1
    nextStallAction("s"); // stall 2
    clearStall("s");
    const fresh = nextStallAction("s");
    assert.ok(fresh);
    assert.match(fresh!.nudge, /Stall 1/);
  });

  it("setPlan clears the stall counter — re-decomposing IS progress", () => {
    setPlan("s", [{ id: "1", description: "a", status: "pending" }]);
    nextStallAction("s");
    nextStallAction("s");
    setPlan("s", [
      { id: "1", description: "a", status: "pending" },
      { id: "2", description: "b", status: "pending" },
    ]);
    const after = nextStallAction("s");
    assert.ok(after);
    assert.match(after!.nudge, /Stall 1/);
  });

  it("isValidPlanTaskStatus", () => {
    assert.ok(isValidPlanTaskStatus("pending"));
    assert.ok(isValidPlanTaskStatus("abandoned"));
    assert.ok(!isValidPlanTaskStatus("done"));
    assert.ok(!isValidPlanTaskStatus(42));
  });
});
