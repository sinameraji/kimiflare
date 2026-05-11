import { describe, it } from "node:test";
import assert from "node:assert";
import { getShellCommand } from "./bash.js";

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
