import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolSpec } from "../tools/registry.js";
import {
  filterToolsForSubagent,
  getPreset,
  isValidSubagentType,
  listPresets,
} from "./presets.js";

function makeTool(name: string, needsPermission = false): ToolSpec {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: "object" },
    needsPermission,
    run: async () => "",
  };
}

const TOOL_LIST: ToolSpec[] = [
  makeTool("read"),
  makeTool("write", true),
  makeTool("edit", true),
  makeTool("bash", true),
  makeTool("glob"),
  makeTool("grep"),
  makeTool("web_fetch"),
  makeTool("search_web"),
  makeTool("github_read_pr"),
  makeTool("browser_fetch", true),
  makeTool("tasks_set"),
  makeTool("memory_remember"),
  makeTool("memory_recall"),
  makeTool("memory_forget"),
  makeTool("expand_artifact"),
  makeTool("lsp_hover"),
  makeTool("lsp_rename", true),
  makeTool("lsp_codeAction", true),
  makeTool("lsp_references"),
  makeTool("mcp_some_server"),
  // Children must never get these even if the parent has them.
  makeTool("Agent", true),
  makeTool("plan_set"),
  makeTool("plan_update"),
];

const noModeBlock = () => false;

describe("subagent presets", () => {
  it("lists all three presets", () => {
    const names = listPresets().map((p) => p.type);
    assert.deepEqual(names.sort(), ["explore", "general", "plan"]);
  });

  it("validates subagent type strings", () => {
    assert.ok(isValidSubagentType("general"));
    assert.ok(isValidSubagentType("explore"));
    assert.ok(isValidSubagentType("plan"));
    assert.ok(!isValidSubagentType("review"));
    assert.ok(!isValidSubagentType(42));
  });

  it("never allows children to spawn further children (depth-limit-by-construction)", () => {
    for (const type of ["general", "explore", "plan"] as const) {
      const tools = filterToolsForSubagent(type, TOOL_LIST, noModeBlock);
      const names = new Set(tools.map((t) => t.name));
      assert.ok(!names.has("Agent"), `${type} must not include Agent`);
      assert.ok(!names.has("plan_set"), `${type} must not include plan_set`);
      assert.ok(
        !names.has("plan_update"),
        `${type} must not include plan_update`,
      );
    }
  });

  it("explore is read-only — blocks write/edit/bash/browser_fetch/lsp_rename/mcp_*", () => {
    const tools = filterToolsForSubagent("explore", TOOL_LIST, noModeBlock);
    const names = new Set(tools.map((t) => t.name));
    for (const blocked of [
      "write",
      "edit",
      "bash",
      "browser_fetch",
      "lsp_rename",
      "lsp_codeAction",
      "mcp_some_server",
      "memory_remember",
      "memory_forget",
      "tasks_set",
    ]) {
      assert.ok(!names.has(blocked), `explore must not include ${blocked}`);
    }
    for (const allowed of [
      "read",
      "glob",
      "grep",
      "web_fetch",
      "search_web",
      "github_read_pr",
      "memory_recall",
      "expand_artifact",
      "lsp_hover",
      "lsp_references",
    ]) {
      assert.ok(names.has(allowed), `explore must include ${allowed}`);
    }
  });

  it("plan has same tool surface as explore (read-only investigation)", () => {
    const explore = new Set(
      filterToolsForSubagent("explore", TOOL_LIST, noModeBlock).map((t) => t.name),
    );
    const plan = new Set(
      filterToolsForSubagent("plan", TOOL_LIST, noModeBlock).map((t) => t.name),
    );
    assert.deepEqual([...plan].sort(), [...explore].sort());
  });

  it("general gets mutating tools but never the orchestration tools", () => {
    const tools = filterToolsForSubagent("general", TOOL_LIST, noModeBlock);
    const names = new Set(tools.map((t) => t.name));
    assert.ok(names.has("write"), "general must include write");
    assert.ok(names.has("edit"), "general must include edit");
    assert.ok(names.has("bash"), "general must include bash");
    assert.ok(names.has("mcp_some_server"), "general must include MCP tools");
    assert.ok(!names.has("tasks_set"), "general must NOT publish tasks to parent UI");
  });

  it("mode predicate intersects on top — never widens", () => {
    // Simulate plan-mode parent: block mutating tools entirely.
    const isPlanModeBlocked = (name: string) =>
      name === "write" || name === "edit" || name === "bash" ||
      name === "browser_fetch" || name.startsWith("mcp_");

    const general = filterToolsForSubagent("general", TOOL_LIST, isPlanModeBlocked);
    const names = new Set(general.map((t) => t.name));
    assert.ok(!names.has("write"), "plan-mode parent must not allow child write");
    assert.ok(!names.has("edit"), "plan-mode parent must not allow child edit");
    assert.ok(!names.has("bash"), "plan-mode parent must not allow child bash");
    assert.ok(!names.has("mcp_some_server"), "plan-mode blocks all MCP");
    // Read-only ones survive.
    assert.ok(names.has("read"));
    assert.ok(names.has("grep"));
  });

  it("preset defaults are sensible", () => {
    assert.equal(getPreset("explore").defaultCodeMode, false);
    assert.equal(getPreset("plan").defaultReasoningEffort, "high");
    assert.equal(getPreset("general").maxToolIterations, 25);
    assert.equal(getPreset("explore").maxToolIterations, 20);
  });
});
