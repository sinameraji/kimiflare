import { describe, it } from "node:test";
import assert from "node:assert";
import { decidePermission } from "./use-permission-controller.js";
import type { PermissionRequest } from "../tools/executor.js";

function req(toolName: string, args: Record<string, unknown> = {}): PermissionRequest {
  return {
    tool: { name: toolName } as PermissionRequest["tool"],
    args,
    sessionKey: toolName,
  };
}

describe("decidePermission", () => {
  describe("auto mode", () => {
    it("resolves any tool with allow", () => {
      assert.deepStrictEqual(decidePermission(req("bash", { command: "rm -rf /" }), "auto"), {
        kind: "resolve",
        decision: "allow",
      });
      assert.deepStrictEqual(decidePermission(req("write"), "auto"), {
        kind: "resolve",
        decision: "allow",
      });
    });
  });

  describe("plan mode", () => {
    it("prompts for non-blocked tools (e.g. read)", () => {
      assert.deepStrictEqual(decidePermission(req("read"), "plan"), { kind: "prompt" });
    });

    it("auto-allows read-only bash without prompting", () => {
      assert.deepStrictEqual(decidePermission(req("bash", { command: "git status" }), "plan"), {
        kind: "resolve",
        decision: "allow",
      });
    });

    it("blocks mutating bash by default", () => {
      assert.deepStrictEqual(decidePermission(req("bash", { command: "rm -rf node_modules" }), "plan"), {
        kind: "plan_blocked",
        toolName: "bash",
      });
    });

    it("prompts for mutating bash when promptOnBlockedBash is true", () => {
      assert.deepStrictEqual(
        decidePermission(req("bash", { command: "npm install" }), "plan", {
          promptOnBlockedBash: true,
        }),
        { kind: "prompt" },
      );
    });

    it("does NOT escape-hatch non-bash blocked tools even with promptOnBlockedBash", () => {
      assert.deepStrictEqual(
        decidePermission(req("write"), "plan", { promptOnBlockedBash: true }),
        { kind: "plan_blocked", toolName: "write" },
      );
    });

    it("blocks write and edit", () => {
      assert.deepStrictEqual(decidePermission(req("write"), "plan"), {
        kind: "plan_blocked",
        toolName: "write",
      });
      assert.deepStrictEqual(decidePermission(req("edit"), "plan"), {
        kind: "plan_blocked",
        toolName: "edit",
      });
    });

    it("blocks MCP tools", () => {
      assert.deepStrictEqual(decidePermission(req("mcp_github_create_issue"), "plan"), {
        kind: "plan_blocked",
        toolName: "mcp_github_create_issue",
      });
    });
  });

  describe("edit mode", () => {
    it("prompts for mutating tools", () => {
      assert.deepStrictEqual(decidePermission(req("bash", { command: "npm install" }), "edit"), {
        kind: "prompt",
      });
      assert.deepStrictEqual(decidePermission(req("write"), "edit"), { kind: "prompt" });
    });

    it("also prompts for read-only tools (the executor decides per spec.needsPermission)", () => {
      assert.deepStrictEqual(decidePermission(req("read"), "edit"), { kind: "prompt" });
    });

    it("ignores promptOnBlockedBash (irrelevant outside plan mode)", () => {
      assert.deepStrictEqual(
        decidePermission(req("bash", { command: "npm test" }), "edit", {
          promptOnBlockedBash: true,
        }),
        { kind: "prompt" },
      );
    });
  });
});
