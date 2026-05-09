import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContextInjector } from "./context-injector.js";

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kimi-ctx-inject-test-"));
  return {
    dir,
    cleanup: () => { try { rmSync(dir, { recursive: true }); } catch { /* best effort */ } },
  };
}

function touch(dir: string, relPath: string, content = "test content"): string {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

function initGit(dir: string): void {
  mkdirSync(join(dir, ".git"));
}

describe("ContextInjector", () => {
  it("returns empty on same cwd", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const injector = new ContextInjector(dir);
      const blocks = injector.checkCwdChange(dir);
      assert.strictEqual(blocks.length, 0);
    } finally { cleanup(); }
  });

  it("returns empty on same cwd even after resolving trailing slash", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const injector = new ContextInjector(dir);
      const blocks = injector.checkCwdChange(dir + "/");
      assert.strictEqual(blocks.length, 0);
    } finally { cleanup(); }
  });

  it("injects AGENTS.md when moving into a subdirectory that has one", () => {
    const { dir, cleanup } = makeTemp();
    try {
      initGit(dir);
      touch(dir, "AGENTS.md", "root context");
      const sub = join(dir, "sub");
      mkdirSync(sub);
      touch(sub, "AGENTS.md", "sub context");
      const injector = new ContextInjector(dir);
      // Mark root AGENTS.md as already injected (static loading from startup)
      injector.markInjected(join(dir, "AGENTS.md"));

      // Move to sub
      const blocks = injector.checkCwdChange(sub);
      assert.strictEqual(blocks.length, 1);
      assert.ok(blocks[0]!.includes("sub context"));
    } finally { cleanup(); }
  });

  it("returns empty when subdirectory has no AGENTS.md", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const sub = join(dir, "sub");
      mkdirSync(sub);
      const injector = new ContextInjector(dir);
      const blocks = injector.checkCwdChange(sub);
      assert.strictEqual(blocks.length, 0);
    } finally { cleanup(); }
  });

  it("does not re-inject a file already marked as injected", () => {
    const { dir, cleanup } = makeTemp();
    try {
      initGit(dir);
      touch(dir, "AGENTS.md", "root");
      const injector = new ContextInjector(dir);
      injector.markInjected(join(dir, "AGENTS.md"));

      // First check — should return empty (already marked)
      const first = injector.checkCwdChange(join(dir, "sub1"));
      assert.strictEqual(first.length, 0);
    } finally { cleanup(); }
  });

  it("injects ancestor AGENTS.md not yet marked when moving into deeper subdir", () => {
    const { dir, cleanup } = makeTemp();
    try {
      initGit(dir);
      touch(dir, "AGENTS.md", "root context");
      const sub = join(dir, "a", "b", "c");
      mkdirSync(sub, { recursive: true });

      const injector = new ContextInjector(dir);
      // Do NOT mark root — simulate cold start with no static paths
      const blocks = injector.checkCwdChange(sub);
      // Should walk up and find root AGENTS.md
      assert.strictEqual(blocks.length, 1);
      assert.ok(blocks[0]!.includes("root context"));
    } finally { cleanup(); }
  });

  it("handles multiple nested AGENTS.md files (walk-up finds all)", () => {
    const { dir, cleanup } = makeTemp();
    try {
      initGit(dir);
      touch(dir, "AGENTS.md", "root");
      const aDir = join(dir, "a");
      touch(aDir, "AGENTS.md", "level a");
      const sub = join(aDir, "b", "c");
      mkdirSync(sub, { recursive: true });

      const injector = new ContextInjector(dir);
      injector.markInjected(join(dir, "AGENTS.md"));

      const blocks = injector.checkCwdChange(sub);
      // Should find level a's AGENTS.md on the walk from c up
      assert.strictEqual(blocks.length, 1);
      assert.ok(blocks[0]!.includes("level a"));
    } finally { cleanup(); }
  });

  it("skips files over 20KB", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const sub = join(dir, "sub");
      mkdirSync(sub);
      touch(sub, "AGENTS.md", "x".repeat(21 * 1024));
      const injector = new ContextInjector(dir);
      const blocks = injector.checkCwdChange(sub);
      assert.strictEqual(blocks.length, 0);
    } finally { cleanup(); }
  });

  it("walks up to git root (not filesystem root)", () => {
    const { dir, cleanup } = makeTemp();
    try {
      initGit(dir);
      touch(dir, "AGENTS.md", "root");
      const outsideGit = join(dir, "outside");
      mkdirSync(outsideGit);
      touch(outsideGit, "AGENTS.md", "outside git");

      const injector = new ContextInjector(dir);
      injector.markInjected(join(dir, "AGENTS.md"));

      // Move to outsideGit (should NOT find outsideGit's AGENTS.md because it's
      // in a different dir, but on first call it checks the new dir)
      const blocks = injector.checkCwdChange(outsideGit);
      assert.strictEqual(blocks.length, 1);
      assert.ok(blocks[0]!.includes("outside git"));
    } finally { cleanup(); }
  });
});
