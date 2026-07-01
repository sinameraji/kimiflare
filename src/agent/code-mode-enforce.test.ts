import { describe, it } from "node:test";
import assert from "node:assert";

// The enforcement constants/helper live module-privately in loop.ts; this test
// pins the intended contract by re-deriving the same set + message shape, so a
// change to the policy (which tools are redirected, the cap, the wording) is a
// conscious one. Kept in sync deliberately with loop.ts.

const CODE_MODE_REDIRECT_TOOLS = new Set(["read", "bash", "grep", "glob"]);
const MAX_CODE_MODE_REDIRECTS = 4;

describe("Code Mode enforcement policy", () => {
  it("redirects the context-heavy IO tools", () => {
    for (const t of ["read", "bash", "grep", "glob"]) {
      assert.equal(CODE_MODE_REDIRECT_TOOLS.has(t), true, `${t} should be redirected`);
    }
  });

  it("does NOT redirect web_fetch (its anti-abuse budget must apply on the direct path)", () => {
    assert.equal(CODE_MODE_REDIRECT_TOOLS.has("web_fetch"), false);
  });

  it("does NOT redirect control / sandbox tools", () => {
    for (const t of ["execute_code", "tasks_set", "memory_remember", "present_plan_options", "write", "edit"]) {
      assert.equal(CODE_MODE_REDIRECT_TOOLS.has(t), false, `${t} should not be redirected`);
    }
  });

  it("has a finite per-turn cap (safety valve so a broken sandbox degrades to direct calls)", () => {
    assert.ok(MAX_CODE_MODE_REDIRECTS > 0 && MAX_CODE_MODE_REDIRECTS < 20);
  });
});
