import { describe, it } from "node:test";
import assert from "node:assert";
import { getAgentTools, createAgentSession, type AgentRole } from "./agent-session.js";

describe("getAgentTools", () => {
  it("returns sorted tool names for research agent", () => {
    const tools = getAgentTools("research");
    const names = tools.map((t) => t.name);
    assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.ok(!names.includes("write"), "research agent should not have write");
    assert.ok(!names.includes("edit"), "research agent should not have edit");
    assert.ok(!names.includes("bash"), "research agent should not have bash");
    assert.ok(names.includes("read"), "research agent should have read");
    assert.ok(names.includes("grep"), "research agent should have grep");
  });

  it("returns sorted tool names for coding agent", () => {
    const tools = getAgentTools("coding");
    const names = tools.map((t) => t.name);
    assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.ok(names.includes("write"), "coding agent should have write");
    assert.ok(names.includes("edit"), "coding agent should have edit");
    assert.ok(names.includes("bash"), "coding agent should have bash");
    assert.ok(!names.includes("web_fetch"), "coding agent should not have web_fetch");
  });

  it("returns sorted tool names for generalist agent", () => {
    const tools = getAgentTools("generalist");
    const names = tools.map((t) => t.name);
    assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.ok(!names.includes("write"), "generalist agent should not have write");
    assert.ok(!names.includes("edit"), "generalist agent should not have edit");
    assert.ok(!names.includes("bash"), "generalist agent should not have bash");
    assert.ok(names.includes("tasks_set"), "generalist agent should have tasks_set");
  });

  it("produces deterministic output across calls", () => {
    const a = getAgentTools("research").map((t) => t.name);
    const b = getAgentTools("research").map((t) => t.name);
    assert.deepStrictEqual(a, b);
  });
});

describe("createAgentSession", () => {
  it("creates a session with empty messages, recentToolCalls, and artifactStore", () => {
    const session = createAgentSession("generalist");
    assert.strictEqual(session.role, "generalist");
    assert.deepStrictEqual(session.messages, []);
    assert.deepStrictEqual(session.recentToolCalls, []);
    assert.ok(session.artifactStore, "should have an artifact store");
  });
});
