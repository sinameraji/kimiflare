import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listFilesByMtime, pruneFiles, rotateJsonl } from "./storage-limits.js";

let testDir: string;

before(async () => {
  testDir = join(tmpdir(), `kimiflare-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

after(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("listFilesByMtime", () => {
  it("returns files sorted by mtime descending", async () => {
    const f1 = join(testDir, "a.txt");
    const f2 = join(testDir, "b.txt");
    await writeFile(f1, "a", "utf8");
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(f2, "b", "utf8");
    const files = await listFilesByMtime(testDir, /\.txt$/);
    assert.strictEqual(files.length, 2);
    assert.strictEqual(files[0]!.path, f2);
    assert.strictEqual(files[1]!.path, f1);
  });
});

describe("pruneFiles", () => {
  it("removes files older than maxAgeDays", async () => {
    const oldFile = join(testDir, "old.json");
    await writeFile(oldFile, "{}", "utf8");
    // Manually backdate by touching
    const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const { utimes } = await import("node:fs");
    await new Promise<void>((resolve, reject) => {
      utimes(oldFile, oldTime, oldTime, (err) => (err ? reject(err) : resolve()));
    });

    const files = await listFilesByMtime(testDir, /\.json$/);
    const removed = await pruneFiles(files, 30, 100);
    assert.strictEqual(removed, 1);
    try {
      await stat(oldFile);
      assert.fail("should have been deleted");
    } catch {
      /* expected */
    }
  });

  it("enforces maxCount by deleting oldest", async () => {
    for (let i = 0; i < 5; i++) {
      await writeFile(join(testDir, `count_${i}.json`), "{}", "utf8");
      await new Promise((r) => setTimeout(r, 50));
    }
    const files = await listFilesByMtime(testDir, /count_\.*/);
    const removed = await pruneFiles(files, 365, 2);
    assert.strictEqual(removed, 3);
  });
});

describe("rotateJsonl", () => {
  it("rotates file when it exceeds maxBytes", async () => {
    const path = join(testDir, "rotate.jsonl");
    await writeFile(path, "x".repeat(100), "utf8");
    await rotateJsonl(path, 50, 2);
    try {
      await stat(path);
      // Original should have been renamed to .1
      assert.fail("original should have been rotated");
    } catch {
      /* expected */
    }
    const rotated = join(testDir, "rotate.jsonl.1");
    const s = await stat(rotated);
    assert.strictEqual(s.size, 100);
  });

  it("does nothing when file is under maxBytes", async () => {
    const path = join(testDir, "small.jsonl");
    await writeFile(path, "small", "utf8");
    await rotateJsonl(path, 1000, 2);
    const s = await stat(path);
    assert.strictEqual(s.size, 5);
  });
});
