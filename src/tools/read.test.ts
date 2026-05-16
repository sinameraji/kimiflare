import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTool, readSliceStreaming } from "./read.js";
import type { ToolContext } from "./registry.js";

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "read-tool-test-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { cwd: dir, ...overrides };
}

describe("readTool — small files (fast path)", () => {
  it("reads a small file in full", async () => {
    const p = join(dir, "small.txt");
    writeFileSync(p, "alpha\nbeta\ngamma\n");
    const out = await readTool.run({ path: "small.txt" }, ctx());
    assert.ok(typeof out === "string");
    assert.match(out as string, /^ ?1\talpha\n ?2\tbeta\n ?3\tgamma\n ?4\t$/);
  });

  it("slices small files with offset+limit", async () => {
    const p = join(dir, "ten.txt");
    writeFileSync(p, Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n"));
    const out = (await readTool.run({ path: "ten.txt", offset: 4, limit: 3 }, ctx())) as string;
    const lines = out.split("\n");
    assert.strictEqual(lines.length, 3);
    assert.match(lines[0]!, /4\tline4/);
    assert.match(lines[2]!, /6\tline6/);
  });
});

describe("readTool — large files (streaming path)", () => {
  /** 3 MB of "line N\n" content — comfortably over the 2 MB cap. */
  const makeBigFile = (name: string): string => {
    const p = join(dir, name);
    const chunks: string[] = [];
    let bytes = 0;
    let n = 0;
    while (bytes < 3 * 1024 * 1024) {
      n += 1;
      const line = `line${n}\n`;
      chunks.push(line);
      bytes += line.length;
    }
    writeFileSync(p, chunks.join(""));
    return p;
  };

  it("rejects an unbounded read on a file over the cap", async () => {
    makeBigFile("big-unbounded.txt");
    await assert.rejects(
      readTool.run({ path: "big-unbounded.txt" }, ctx()),
      /file too large: .* bytes \(max .* for full read; supply offset\+limit/,
    );
  });

  it("rejects with offset only (no limit)", async () => {
    makeBigFile("big-no-limit.txt");
    await assert.rejects(
      readTool.run({ path: "big-no-limit.txt", offset: 100 }, ctx()),
      /supply offset\+limit/,
    );
  });

  it("streams a small slice from a big file", async () => {
    makeBigFile("big-slice.txt");
    const out = (await readTool.run(
      { path: "big-slice.txt", offset: 50, limit: 3 },
      ctx(),
    )) as string;
    const lines = out.split("\n");
    assert.strictEqual(lines.length, 3);
    assert.match(lines[0]!, /50\tline50/);
    assert.match(lines[1]!, /51\tline51/);
    assert.match(lines[2]!, /52\tline52/);
  });

  it("returns fewer lines than requested when the slice runs past EOF", async () => {
    // 5 lines total, ask for 100 starting at line 3
    const p = join(dir, "short.txt");
    writeFileSync(p, "a\nb\nc\nd\ne\n");
    // Force the streaming path by also writing a separate big file? No —
    // the streaming function is exported, test it directly.
    const lines = await readSliceStreaming(p, 3, 100);
    assert.deepStrictEqual(lines, ["c", "d", "e"]);
  });

  it("respects an already-aborted signal before opening the file", async () => {
    makeBigFile("big-aborted.txt");
    const c = new AbortController();
    c.abort();
    await assert.rejects(
      readTool.run({ path: "big-aborted.txt", offset: 100, limit: 5 }, ctx({ signal: c.signal })),
      (err: Error) => err.name === "AbortError",
    );
  });

  it("aborts mid-stream when the signal fires", async () => {
    // Big file with a slice deep into it so the stream has time to react.
    const p = join(dir, "big-mid-abort.txt");
    const chunks: string[] = [];
    for (let i = 1; i <= 200_000; i++) chunks.push(`line${i}\n`);
    writeFileSync(p, chunks.join(""));
    const c = new AbortController();
    // Fire abort on the next tick so the read has actually started.
    setTimeout(() => c.abort(), 0);
    await assert.rejects(
      readSliceStreaming(p, 199_000, 100, c.signal),
      (err: Error) => err.name === "AbortError",
    );
  });
});
