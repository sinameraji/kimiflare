import { describe, it } from "node:test";
import assert from "node:assert";
import { buildStaticPrefix, buildSessionPrefix, buildSystemMessages, buildSystemPrompt } from "./system-prompt.js";
import type { ToolSpec } from "../tools/registry.js";

const DUMMY_TOOLS: ToolSpec[] = [
  {
    name: "read",
    description: "Read a file.",
    parameters: { type: "object", properties: {}, required: [] },
    needsPermission: false,
    run: async () => "",
  },
];

describe("buildStaticPrefix", () => {
  it("is byte-for-byte identical across different dates", () => {
    const a = buildStaticPrefix({ model: "@cf/moonshotai/kimi-k2.6" });
    const b = buildStaticPrefix({ model: "@cf/moonshotai/kimi-k2.6" });
    assert.strictEqual(a, b);
  });

  it("does not contain volatile metadata", () => {
    const p = buildStaticPrefix({ model: "@cf/moonshotai/kimi-k2.6" });
    assert.ok(!p.includes("Today:"), "should not include date");
    assert.ok(!p.includes("Working directory:"), "should not include cwd");
    assert.ok(!p.includes("Platform:"), "should not include platform");
    assert.ok(!p.includes("Shell:"), "should not include shell");
    assert.ok(!p.includes("Home:"), "should not include home");
    assert.ok(!p.includes("`read`"), "should not include formatted tool names");
  });
});

describe("buildSessionPrefix", () => {
  it("changes when mode changes", () => {
    const edit = buildSessionPrefix({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    const plan = buildSessionPrefix({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "plan" });
    assert.notStrictEqual(edit, plan);
  });

  it("contains environment and tools", () => {
    const p = buildSessionPrefix({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m" });
    assert.ok(p.includes("Working directory:"));
    assert.ok(p.includes("read"));
  });
});

describe("buildSystemMessages", () => {
  it("produces two system messages when cacheStable is used", () => {
    const msgs = buildSystemMessages({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0]!.role, "system");
    assert.strictEqual(msgs[1]!.role, "system");
    assert.ok(typeof msgs[0]!.content === "string");
    assert.ok(typeof msgs[1]!.content === "string");
  });

  it("static message is identical across different modes", () => {
    const editMsgs = buildSystemMessages({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    const planMsgs = buildSystemMessages({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "plan" });
    assert.strictEqual(editMsgs[0]!.content, planMsgs[0]!.content);
  });
});

describe("buildSystemPrompt", () => {
  it("concatenates static and session prefixes", () => {
    const full = buildSystemPrompt({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    const staticP = buildStaticPrefix({ model: "m" });
    const sessionP = buildSessionPrefix({ cwd: "/tmp", tools: DUMMY_TOOLS, model: "m", mode: "edit" });
    assert.strictEqual(full, staticP + "\n\n" + sessionP);
  });
});
