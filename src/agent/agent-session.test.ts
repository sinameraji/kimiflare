import { describe, it } from "node:test";
import assert from "node:assert";
import { getAgentTools, createAgentSession, type AgentRole } from "./agent-session.js";

describe("getAgentTools", () => {
  it("returns sorted tool names for plan agent", () => {
    const tools = getAgentTools("plan");
    const names = tools.map((t) => t.name);
    assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.ok(!names.includes("write"), "plan agent should not have write");
    assert.ok(!names.includes("edit"), "plan agent should not have edit");
    assert.ok(!names.includes("bash"), "plan agent should not have bash");
    assert.ok(names.includes("read"), "plan agent should have read");
    assert.ok(names.includes("grep"), "plan agent should have grep");
  });

  it("returns sorted tool names for build agent", () => {
    const tools = getAgentTools("build");
    const names = tools.map((t) => t.name);
    assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.ok(names.includes("write"), "build agent should have write");
    assert.ok(names.includes("edit"), "build agent should have edit");
    assert.ok(names.includes("bash"), "build agent should have bash");
    assert.ok(!names.includes("web_fetch"), "build agent should not have web_fetch");
  });

  it("returns sorted tool names for general agent", () => {
    const tools = getAgentTools("general");
    const names = tools.map((t) => t.name);
    assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.ok(!names.includes("write"), "general agent should not have write");
    assert.ok(!names.includes("edit"), "general agent should not have edit");
    assert.ok(!names.includes("bash"), "general agent should not have bash");
    assert.ok(names.includes("tasks_set"), "general agent should have tasks_set");
  });

  it("produces deterministic output across calls", () => {
    const a = getAgentTools("plan").map((t) => t.name);
    const b = getAgentTools("plan").map((t) => t.name);
    assert.deepStrictEqual(a, b);
  });
});

describe("createAgentSession", () => {
  it("creates a session with empty messages and recentToolCalls", () => {
    const session = createAgentSession("general");
    assert.strictEqual(session.role, "general");
    assert.deepStrictEqual(session.messages, []);
    assert.deepStrictEqual(session.recentToolCalls, []);
  });
});
