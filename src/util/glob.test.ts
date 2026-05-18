import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glob, globStream, matchGlob } from "./glob.js";

describe("matchGlob", () => {
  it("matches literal path", () => {
    assert.strictEqual(matchGlob("a/b.ts", "a/b.ts"), true);
  });

  it("rejects non-matching literal", () => {
    assert.strictEqual(matchGlob("a/b.ts", "a/c.ts"), false);
  });

  it("matches single-level wildcard", () => {
    assert.strictEqual(matchGlob("a.ts", "*.ts"), true);
    assert.strictEqual(matchGlob("src/a.ts", "*.ts"), false);
  });

  it("matches recursive wildcard", () => {
    assert.strictEqual(matchGlob("a.md", "**/*.md"), true);
    assert.strictEqual(matchGlob("src/a.md", "**/*.md"), true);
    assert.strictEqual(matchGlob("src/deep/a.md", "**/*.md"), true);
    assert.strictEqual(matchGlob("a.ts", "**/*.md"), false);
  });

  it("matches single-char wildcard", () => {
    assert.strictEqual(matchGlob("a.ts", "?.ts"), true);
    assert.strictEqual(matchGlob("ab.ts", "?.ts"), false);
  });

  it("matches mixed patterns", () => {
    assert.strictEqual(matchGlob("src/a.ts", "src/**/*.ts"), true);
    assert.strictEqual(matchGlob("src/deep/a.ts", "src/**/*.ts"), true);
    assert.strictEqual(matchGlob("a.ts", "src/**/*.ts"), false);
  });

  it("matches double-star zero segments", () => {
    assert.strictEqual(matchGlob("src/a.ts", "src/**/a.ts"), true);
  });

  it("matches double-star multiple segments", () => {
    assert.strictEqual(matchGlob("a/x/y/b", "a/**/b"), true);
    assert.strictEqual(matchGlob("a/b", "a/**/b"), true);
    assert.strictEqual(matchGlob("a/x", "a/**/b"), false);
  });
});

describe("glob", () => {
  let dir: string;

  async function setup(): Promise<void> {
    dir = await mkdtemp(join(tmpdir(), "kf-glob-"));
    await mkdir(join(dir, "src", "deep"), { recursive: true });
    await mkdir(join(dir, "node_modules", "foo"), { recursive: true });
    await writeFile(join(dir, "a.ts"), "a");
    await writeFile(join(dir, "b.ts"), "b");
    await writeFile(join(dir, "src", "c.ts"), "c");
    await writeFile(join(dir, "src", "deep", "d.ts"), "d");
    await writeFile(join(dir, "a.md"), "md");
    await writeFile(join(dir, "src", "e.md"), "md");
    await writeFile(join(dir, ".hidden.ts"), "hidden");
    await writeFile(join(dir, "node_modules", "foo", "index.ts"), "nm");
    await writeFile(join(dir, "temp.log"), "log");
  }

  async function cleanup(): Promise<void> {
    await rm(dir, { recursive: true, force: true });
  }

  it("simple *.ts wildcard", async () => {
    await setup();
    try {
      const results = await glob("*.ts", { cwd: dir, absolute: false });
      assert.deepStrictEqual(results.sort(), ["a.ts", "b.ts"]);
    } finally {
      await cleanup();
    }
  });

  it("recursive **/*.md", async () => {
    await setup();
    try {
      const results = await glob("**/*.md", { cwd: dir, absolute: false });
      assert.deepStrictEqual(results.sort(), ["a.md", "src/e.md"]);
    } finally {
      await cleanup();
    }
  });

  it("? wildcard", async () => {
    await setup();
    try {
      const results = await glob("?.ts", { cwd: dir, absolute: false });
      assert.deepStrictEqual(results.sort(), ["a.ts", "b.ts"]);
    } finally {
      await cleanup();
    }
  });

  it("ignore patterns", async () => {
    await setup();
    try {
      const results = await glob("**/*.ts", {
        cwd: dir,
        absolute: false,
        ignore: ["**/node_modules/**"],
      });
      assert.ok(!results.some((r) => r.includes("node_modules")));
      assert.ok(results.includes("a.ts"));
      assert.ok(results.includes("src/c.ts"));
    } finally {
      await cleanup();
    }
  });

  it("dot: false skips hidden files", async () => {
    await setup();
    try {
      const results = await glob("*.ts", { cwd: dir, absolute: false, dot: false });
      assert.ok(!results.includes(".hidden.ts"));
    } finally {
      await cleanup();
    }
  });

  it("dot: true includes hidden files", async () => {
    await setup();
    try {
      const results = await glob("*.ts", { cwd: dir, absolute: false, dot: true });
      assert.ok(results.includes(".hidden.ts"));
    } finally {
      await cleanup();
    }
  });

  it("absolute: true returns full paths", async () => {
    await setup();
    try {
      const results = await glob("*.ts", { cwd: dir, absolute: true });
      assert.ok(results.every((r) => r.startsWith(dir)));
    } finally {
      await cleanup();
    }
  });

  it("onlyFiles: true excludes directories", async () => {
    await setup();
    try {
      const results = await glob("**/*", {
        cwd: dir,
        absolute: false,
        onlyFiles: true,
      });
      assert.ok(!results.some((r) => r === "src" || r === "src/deep"));
      assert.ok(results.includes("a.ts"));
    } finally {
      await cleanup();
    }
  });

  it("markDirectories: true appends slash", async () => {
    await setup();
    try {
      const results = await glob("**/*", {
        cwd: dir,
        absolute: false,
        onlyFiles: false,
        markDirectories: true,
      });
      assert.ok(results.some((r) => r === "src/"));
      assert.ok(results.some((r) => r === "src/deep/"));
      assert.ok(!results.some((r) => r === "a.ts/"));
    } finally {
      await cleanup();
    }
  });

  it("suppressErrors: true on missing directory", async () => {
    const results = await glob("**/*.md", {
      cwd: join(tmpdir(), "kf-glob-missing-" + Date.now()),
      absolute: false,
      suppressErrors: true,
    });
    assert.deepStrictEqual(results, []);
  });

  it("multiple ignore patterns", async () => {
    await setup();
    try {
      const results = await glob("**/*", {
        cwd: dir,
        absolute: false,
        onlyFiles: true,
        ignore: ["**/node_modules/**", "**/*.log"],
      });
      assert.ok(!results.some((r) => r.includes("node_modules")));
      assert.ok(!results.includes("temp.log"));
      assert.ok(results.includes("a.ts"));
    } finally {
      await cleanup();
    }
  });
});

describe("globStream", () => {
  let dir: string;

  async function setup(): Promise<void> {
    dir = await mkdtemp(join(tmpdir(), "kf-glob-stream-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "a.ts"), "a");
    await writeFile(join(dir, "b.ts"), "b");
    await writeFile(join(dir, "src", "c.ts"), "c");
    await writeFile(join(dir, ".hidden.ts"), "hidden");
  }

  async function cleanup(): Promise<void> {
    await rm(dir, { recursive: true, force: true });
  }

  it("yields entries", async () => {
    await setup();
    try {
      const stream = globStream("*.ts", { cwd: dir, absolute: false });
      const entries: string[] = [];
      for await (const e of stream) {
        entries.push(e.path);
      }
      assert.deepStrictEqual(entries.sort(), ["a.ts", "b.ts"]);
    } finally {
      await cleanup();
    }
  });

  it("yields recursive entries", async () => {
    await setup();
    try {
      const stream = globStream("**/*.ts", { cwd: dir, absolute: false });
      const entries: string[] = [];
      for await (const e of stream) {
        entries.push(e.path);
      }
      assert.deepStrictEqual(entries.sort(), ["a.ts", "b.ts", "src/c.ts"]);
    } finally {
      await cleanup();
    }
  });

  it("destroy stops iteration", async () => {
    await setup();
    try {
      const stream = globStream("**/*.ts", { cwd: dir, absolute: false });
      const entries: string[] = [];
      for await (const e of stream) {
        entries.push(e.path);
        if (entries.length === 1) {
          stream.destroy();
        }
      }
      assert.strictEqual(entries.length, 1);
    } finally {
      await cleanup();
    }
  });

  it("stats includes mtimeMs", async () => {
    await setup();
    try {
      const stream = globStream("a.ts", {
        cwd: dir,
        absolute: false,
        stats: true,
      });
      const entries: Array<{ path: string; stats?: { mtimeMs: number } }> = [];
      for await (const e of stream) {
        entries.push(e);
      }
      assert.strictEqual(entries.length, 1);
      assert.ok(entries[0]!.stats);
      assert.ok(typeof entries[0]!.stats!.mtimeMs === "number");
      const actualStat = await stat(join(dir, "a.ts"));
      assert.strictEqual(entries[0]!.stats!.mtimeMs, actualStat.mtimeMs);
    } finally {
      await cleanup();
    }
  });

  it("respects dot option", async () => {
    await setup();
    try {
      const stream = globStream("*.ts", { cwd: dir, absolute: false, dot: false });
      const entries: string[] = [];
      for await (const e of stream) {
        entries.push(e.path);
      }
      assert.ok(!entries.includes(".hidden.ts"));
    } finally {
      await cleanup();
    }
  });
});
