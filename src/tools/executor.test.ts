import { describe, it } from "node:test";
import assert from "node:assert";
import { isDiffCommand } from "./executor.js";

describe("isDiffCommand", () => {
  it("matches `git show` and its argument forms", () => {
    assert.strictEqual(isDiffCommand("git show"), true);
    assert.strictEqual(isDiffCommand("git show abc123"), true);
    assert.strictEqual(isDiffCommand("git show abc123:path/to/file.ts"), true);
    assert.strictEqual(isDiffCommand("  git show HEAD~1  "), true);
  });

  it("does not match `git show-ref` or `git show-branch`", () => {
    assert.strictEqual(isDiffCommand("git show-ref"), false);
    assert.strictEqual(isDiffCommand("git show-branch"), false);
    assert.strictEqual(isDiffCommand("git show-ref --heads"), false);
  });

  it("matches `git diff` with various flags", () => {
    assert.strictEqual(isDiffCommand("git diff"), true);
    assert.strictEqual(isDiffCommand("git diff --cached"), true);
    assert.strictEqual(isDiffCommand("git diff HEAD~1 HEAD"), true);
    assert.strictEqual(isDiffCommand("git diff -- src/"), true);
  });

  it("does not match commands that merely start with `git diff` as a substring", () => {
    assert.strictEqual(isDiffCommand("git diffx"), false);
    assert.strictEqual(isDiffCommand("git difftool"), false);
  });

  it("matches `git log` only when -p / --patch is present", () => {
    assert.strictEqual(isDiffCommand("git log"), false);
    assert.strictEqual(isDiffCommand("git log --oneline"), false);
    assert.strictEqual(isDiffCommand("git log -p"), true);
    assert.strictEqual(isDiffCommand("git log --patch"), true);
    assert.strictEqual(isDiffCommand("git log -p -- src/"), true);
    assert.strictEqual(isDiffCommand("git log --patch -- src/"), true);
  });

  it("matches `git format-patch`", () => {
    assert.strictEqual(isDiffCommand("git format-patch HEAD~3"), true);
    assert.strictEqual(isDiffCommand("git format-patch -1 HEAD"), true);
  });

  it("matches `git stash show` only when -p / --patch is present", () => {
    assert.strictEqual(isDiffCommand("git stash show"), false);
    assert.strictEqual(isDiffCommand("git stash show -p"), true);
    assert.strictEqual(isDiffCommand("git stash show --patch"), true);
    assert.strictEqual(isDiffCommand("git stash show -p stash@{0}"), true);
  });

  it("rejects unrelated commands", () => {
    assert.strictEqual(isDiffCommand(""), false);
    assert.strictEqual(isDiffCommand("git status"), false);
    assert.strictEqual(isDiffCommand("npm test"), false);
    assert.strictEqual(isDiffCommand("ls -la"), false);
    assert.strictEqual(isDiffCommand("show diff"), false);
  });
});
