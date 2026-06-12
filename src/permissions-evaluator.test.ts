import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluatePermissionRules } from "./permissions-evaluator.js";
import type { PermissionRules } from "./config.js";

describe("evaluatePermissionRules", () => {
  const cwd = "/home/user/project";

  it("returns ask when no rules are defined", () => {
    const result = evaluatePermissionRules(
      { tool: "bash", args: { command: "ls" }, cwd },
      {},
    );
    assert.strictEqual(result, "ask");
  });

  it("returns ask when tool has no rules", () => {
    const result = evaluatePermissionRules(
      { tool: "bash", args: { command: "ls" }, cwd },
      { write: { "**": "deny" } },
    );
    assert.strictEqual(result, "ask");
  });

  it("allows bash commands matching allow pattern", () => {
    const rules: Record<string, PermissionRules> = {
      bash: { "npm test": "allow", "**": "ask" },
    };
    const result = evaluatePermissionRules(
      { tool: "bash", args: { command: "npm test" }, cwd },
      rules,
    );
    assert.strictEqual(result, "allow");
  });

  it("denies bash commands matching deny pattern", () => {
    const rules: Record<string, PermissionRules> = {
      bash: { "rm -rf": "deny", "**": "allow" },
    };
    const result = evaluatePermissionRules(
      { tool: "bash", args: { command: "rm -rf /" }, cwd },
      rules,
    );
    assert.strictEqual(result, "deny");
  });

  it("allows file writes to allowed paths", () => {
    const rules: Record<string, PermissionRules> = {
      write: { "**/tmp/**": "allow", "**": "deny" },
    };
    const result = evaluatePermissionRules(
      { tool: "write", args: { path: "/home/user/project/tmp/file.txt" }, cwd },
      rules,
    );
    assert.strictEqual(result, "allow");
  });

  it("denies file writes to non-allowed paths", () => {
    const rules: Record<string, PermissionRules> = {
      write: { "**/tmp/**": "allow", "**": "deny" },
    };
    const result = evaluatePermissionRules(
      { tool: "write", args: { path: "/home/user/project/src/main.ts" }, cwd },
      rules,
    );
    assert.strictEqual(result, "deny");
  });

  it("matches more specific patterns first", () => {
    const rules: Record<string, PermissionRules> = {
      write: {
        "**/src/**": "allow",
        "**": "deny",
      },
    };
    const result = evaluatePermissionRules(
      { tool: "write", args: { path: "src/app.tsx" }, cwd },
      rules,
    );
    assert.strictEqual(result, "allow");
  });

  it("falls back to ask when no pattern matches", () => {
    const rules: Record<string, PermissionRules> = {
      write: { "**/src/**": "allow" },
    };
    const result = evaluatePermissionRules(
      { tool: "write", args: { path: "docs/readme.md" }, cwd },
      rules,
    );
    assert.strictEqual(result, "ask");
  });

  it("handles glob patterns with wildcards", () => {
    const rules: Record<string, PermissionRules> = {
      read: { "**/*.md": "allow", "**": "deny" },
    };
    const result = evaluatePermissionRules(
      { tool: "read", args: { path: "README.md" }, cwd },
      rules,
    );
    assert.strictEqual(result, "allow");
  });

  it("handles home directory expansion", () => {
    const rules: Record<string, PermissionRules> = {
      read: { "~/projects/**": "allow", "**": "deny" },
    };
    const result = evaluatePermissionRules(
      { tool: "read", args: { path: "~/projects/myapp/package.json" }, cwd },
      rules,
    );
    assert.strictEqual(result, "allow");
  });
});
