// @rust-exception rationale: Characterization tests for platform-native SQLite memory layer.
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import {
  openMemoryDb,
  closeMemoryDb,
  insertMemory,
  getMemoryStats,
  findMemoriesByTopicKey,
  getMemoryById,
} from "./db.js";
import type { MemoryInput } from "./schema.js";

const TEST_DB = join(tmpdir(), `kf-mem-test-${Date.now()}.db`);

function fakeEmbedding(dim = 768): Float32Array {
  return new Float32Array(dim);
}

function makeInput(partial: Partial<MemoryInput> = {}): MemoryInput {
  return {
    content: partial.content ?? "test memory",
    category: partial.category ?? "fact",
    sourceSessionId: partial.sourceSessionId ?? "sess_001",
    repoPath: partial.repoPath ?? "/tmp/test-repo",
    importance: partial.importance ?? 3,
    relatedFiles: partial.relatedFiles ?? [],
    topicKey: partial.topicKey,
    agentRole: partial.agentRole,
    ...partial,
  };
}

describe("memory/db", () => {
  let db: Database.Database;

  before(() => {
    db = openMemoryDb(TEST_DB);
  });

  after(() => {
    closeMemoryDb();
    try {
      rmSync(TEST_DB);
    } catch {
      /* ignore */
    }
  });

  it("inserts a memory and returns it with generated fields", () => {
    const input = makeInput({ content: "Uses tsup for bundling" });
    const mem = insertMemory(db, input, fakeEmbedding());

    assert.strictEqual(mem.content, input.content);
    assert.strictEqual(mem.category, input.category);
    assert.strictEqual(mem.repoPath, input.repoPath);
    assert.strictEqual(mem.forgotten, false);
    assert.strictEqual(mem.vectorized, true);
    assert.ok(mem.id.length > 0);
    assert.ok(mem.createdAt > 0);
  });

  it("reports stats after insertion", () => {
    const before = getMemoryStats(db);
    insertMemory(db, makeInput({ content: "stat test" }), fakeEmbedding());
    const after = getMemoryStats(db);

    assert.strictEqual(after.totalCount, before.totalCount + 1);
    assert.ok(after.dbSizeBytes > 0);
  });

  it("finds memory by topic key", () => {
    const input = makeInput({
      content: "React 19 use hook",
      topicKey: "react_hooks",
    });
    const mem = insertMemory(db, input, fakeEmbedding());

    const found = findMemoriesByTopicKey(db, input.repoPath, "react_hooks");
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0]!.id, mem.id);
    assert.strictEqual(found[0]!.topicKey, "react_hooks");
  });

  it("finds nothing for unknown topic key", () => {
    const found = findMemoriesByTopicKey(
      db,
      "/tmp/nonexistent",
      "nonexistent_topic_12345",
    );
    assert.strictEqual(found.length, 0);
  });

  it("retrieves memory by id", () => {
    const input = makeInput({ content: "retrievable memory" });
    const mem = insertMemory(db, input, fakeEmbedding());

    const fetched = getMemoryById(db, mem.id);
    assert.ok(fetched);
    assert.strictEqual(fetched!.id, mem.id);
    assert.strictEqual(fetched!.content, input.content);
  });

  it("returns null for unknown id", () => {
    const fetched = getMemoryById(db, "no_such_id_12345");
    assert.strictEqual(fetched, null);
  });
});
