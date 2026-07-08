import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getShellCommand, guardGitPush, parsePushTarget } from "./bash.js";
import type { ToolContext } from "./registry.js";

describe("getShellCommand", () => {
  it("returns bash for explicit 'bash'", () => {
    const result = getShellCommand("bash");
    assert.strictEqual(result.shell, "bash");
    assert.deepStrictEqual(result.args, ["-lc"]);
    assert.strictEqual(result.isPosix, true);
  });

  it("returns cmd for explicit 'cmd'", () => {
    const result = getShellCommand("cmd");
    assert.ok(result.shell.toLowerCase().includes("cmd"));
    assert.deepStrictEqual(result.args, ["/c"]);
    assert.strictEqual(result.isPosix, false);
  });

  it("returns powershell for explicit 'powershell'", () => {
    const result = getShellCommand("powershell");
    assert.strictEqual(result.shell, "powershell");
    assert.deepStrictEqual(result.args, ["-Command"]);
    assert.strictEqual(result.isPosix, false);
  });

  it("returns bash for undefined (auto on non-Windows)", () => {
    const result = getShellCommand();
    // On non-Windows platforms this should be bash
    // On Windows it would be cmd.exe; we run tests on Unix CI
    if (process.platform !== "win32") {
      assert.strictEqual(result.shell, "bash");
      assert.deepStrictEqual(result.args, ["-lc"]);
      assert.strictEqual(result.isPosix, true);
    }
  });

  it("returns bash for 'auto' on non-Windows", () => {
    const result = getShellCommand("auto");
    if (process.platform !== "win32") {
      assert.strictEqual(result.shell, "bash");
      assert.deepStrictEqual(result.args, ["-lc"]);
      assert.strictEqual(result.isPosix, true);
    }
  });

  it("treats absolute paths to bash-like shells as POSIX", () => {
    const result = getShellCommand("/usr/bin/zsh");
    assert.strictEqual(result.shell, "/usr/bin/zsh");
    assert.deepStrictEqual(result.args, ["-lc"]);
    assert.strictEqual(result.isPosix, true);
  });

  it("treats absolute paths to cmd as non-POSIX", () => {
    const result = getShellCommand("C:\\Windows\\System32\\cmd.exe");
    assert.strictEqual(result.shell, "C:\\Windows\\System32\\cmd.exe");
    assert.deepStrictEqual(result.args, ["/c"]);
    assert.strictEqual(result.isPosix, false);
  });

  it("treats absolute paths to powershell as non-POSIX", () => {
    const result = getShellCommand("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
    assert.strictEqual(result.shell, "C:\\Program Files\\PowerShell\\7\\pwsh.exe");
    assert.deepStrictEqual(result.args, ["-Command"]);
    assert.strictEqual(result.isPosix, false);
  });

  it("is case-insensitive for named shells", () => {
    const bash = getShellCommand("BASH");
    assert.strictEqual(bash.shell, "bash");

    const cmd = getShellCommand("CMD");
    assert.ok(cmd.shell.toLowerCase().includes("cmd"));

    const ps = getShellCommand("PowerShell");
    assert.strictEqual(ps.shell, "powershell");
  });
});

describe("parsePushTarget", () => {
  it("detects current branch push", () => {
    assert.deepStrictEqual(parsePushTarget("git push"), { kind: "current" });
    assert.deepStrictEqual(parsePushTarget("git push origin"), { kind: "current" });
  });

  it("detects explicit branch push", () => {
    assert.deepStrictEqual(parsePushTarget("git push origin feat"), { kind: "ref", ref: "feat" });
  });

  it("detects --all", () => {
    assert.deepStrictEqual(parsePushTarget("git push --all origin"), { kind: "all" });
  });

  it("detects --mirror", () => {
    assert.deepStrictEqual(parsePushTarget("git push --mirror"), { kind: "mirror" });
  });

  it("parses refspec with dst", () => {
    assert.deepStrictEqual(parsePushTarget("git push origin feat:main"), { kind: "ref", ref: "main" });
  });

  it("ignores non-push commands", () => {
    assert.strictEqual(parsePushTarget("git status"), undefined);
  });
});

describe("guardGitPush", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "bash-guard-"));
    execSync("git init -b main", { cwd: repo });
    execSync("git config user.email test@example.com", { cwd: repo });
    execSync("git config user.name Test", { cwd: repo });
    writeFileSync(join(repo, "a.txt"), "a");
    execSync("git add . && git commit -m init", { cwd: repo });
    const remote = join(repo, "remote.git");
    execSync(`git init --bare ${remote}`);
    execSync(`git remote add origin ${remote}`, { cwd: repo });
    execSync("git push origin main", { cwd: repo });
    execSync("git remote set-head origin main", { cwd: repo });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("allows push when allowDirectPush is true", async () => {
    const ctx = { cwd: repo, allowDirectPush: true } as ToolContext;
    const result = await guardGitPush("git push origin main", ctx);
    assert.strictEqual(result, undefined);
  });

  it("blocks push to default branch", async () => {
    const ctx = { cwd: repo, allowDirectPush: false } as ToolContext;
    const result = await guardGitPush("git push origin main", ctx);
    assert.ok(result);
    assert.ok(result!.content.includes("Blocked"));
    assert.ok(result!.content.includes("github_create_pr"));
  });

  it("allows push to non-default branch", async () => {
    execSync("git checkout -b feat", { cwd: repo });
    const ctx = { cwd: repo, allowDirectPush: false } as ToolContext;
    const result = await guardGitPush("git push origin feat", ctx);
    assert.strictEqual(result, undefined);
  });

  it("blocks --all pushes", async () => {
    const ctx = { cwd: repo, allowDirectPush: false } as ToolContext;
    const result = await guardGitPush("git push --all origin", ctx);
    assert.ok(result);
    assert.ok(result!.content.includes("Blocked"));
  });
});
