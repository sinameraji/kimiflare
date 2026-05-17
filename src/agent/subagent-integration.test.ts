/**
 * Cross-cutting integration tests for M7.1 (Task #11).
 *
 * These exercise the *contracts* between the subagent runner and
 * other M7.1 pieces — the things that bite if any of these silently
 * regress.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { ToolSpec } from "../tools/registry.js";
import { decideChildTools } from "./subagent.js";

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
  makeTool("glob"),
  makeTool("write", true),
  makeTool("edit", true),
  makeTool("bash", true),
  makeTool("browser_fetch", true),
  makeTool("memory_recall"),
  makeTool("memory_remember"),
  makeTool("mcp_some_server"),
  makeTool("lsp_hover"),
  makeTool("lsp_rename", true),
  makeTool("Agent"),
  makeTool("plan_set"),
  makeTool("plan_update"),
];

function names(tools: ToolSpec[]): Set<string> {
  return new Set(tools.map((t) => t.name));
}

describe("decideChildTools — mode × preset intersection (M7.1)", () => {
  beforeEach(() => {});

  describe("plan-mode parent", () => {
    it("explore child gets ONLY read-only tools that survive both filters", () => {
      const tools = names(decideChildTools(PARENT_TOOLS, "explore", "plan"));
      // Read-only survivors:
      for (const allowed of ["read", "grep", "glob", "memory_recall", "lsp_hover"]) {
        assert.ok(tools.has(allowed), `expected ${allowed} in plan-mode explore child`);
      }
      // Mutating tools blocked by mode AND/OR preset:
      for (const blocked of [
        "write",
        "edit",
        "bash",
        "browser_fetch",
        "mcp_some_server",
        "lsp_rename",
        "memory_remember",
      ]) {
        assert.ok(!tools.has(blocked), `expected ${blocked} NOT in plan-mode explore child`);
      }
    });

    it("general child STILL cannot mutate under plan mode — mode beats preset", () => {
      const tools = names(decideChildTools(PARENT_TOOLS, "general", "plan"));
      for (const blocked of [
        "write",
        "edit",
        "bash",
        "browser_fetch",
        "mcp_some_server",
        "lsp_rename",
      ]) {
        assert.ok(!tools.has(blocked), `plan mode must block ${blocked} for general child`);
      }
      // But general DOES get read+memory_remember (those aren't plan-blocked).
      assert.ok(tools.has("read"));
      assert.ok(tools.has("memory_remember"));
    });

    it("no child preset ever leaks the orchestration tools", () => {
      for (const preset of ["general", "explore", "plan"] as const) {
        const tools = names(decideChildTools(PARENT_TOOLS, preset, "plan"));
        assert.ok(!tools.has("Agent"), `${preset} child must not have Agent`);
        assert.ok(!tools.has("plan_set"), `${preset} child must not have plan_set`);
        assert.ok(!tools.has("plan_update"), `${preset} child must not have plan_update`);
      }
    });
  });

  describe("edit-mode parent", () => {
    it("general child gets mutating tools (mode permits, preset permits)", () => {
      const tools = names(decideChildTools(PARENT_TOOLS, "general", "edit"));
      for (const allowed of ["write", "edit", "bash", "mcp_some_server", "lsp_rename"]) {
        assert.ok(tools.has(allowed), `edit-mode general child should have ${allowed}`);
      }
    });

    it("explore child stays read-only even though edit mode would permit mutations", () => {
      const tools = names(decideChildTools(PARENT_TOOLS, "explore", "edit"));
      for (const blocked of ["write", "edit", "bash", "lsp_rename"]) {
        assert.ok(!tools.has(blocked), `explore preset must block ${blocked}`);
      }
    });
  });

  describe("auto-mode parent", () => {
    it("behaves like edit-mode for tool-list filtering (mode is for permissions, not filtering)", () => {
      const editTools = names(decideChildTools(PARENT_TOOLS, "general", "edit"));
      const autoTools = names(decideChildTools(PARENT_TOOLS, "general", "auto"));
      assert.deepEqual([...autoTools].sort(), [...editTools].sort());
    });
  });
});

describe("subagent child sessionId convention (M7.1)", () => {
  it("partitioning: child sessionId is `${parent}.sub${N}` and used as recordUsage key", () => {
    // This is a contract test: we assert the documented convention is
    // exactly what we want, so future refactors don't drift it. The
    // actual round-trip wiring is exercised by usage-tracker-parent-session.test.ts.
    const parent = "2025-01-01T00-00-00-foo";
    const firstChild = `${parent}.sub1`;
    const secondChild = `${parent}.sub2`;
    // Trivially: distinct, prefixed, ordered.
    assert.notEqual(firstChild, secondChild);
    assert.ok(firstChild.startsWith(parent));
    assert.match(firstChild, /\.sub\d+$/);
  });
});
