import type Database from "better-sqlite3";
import {
  deleteOldMemories,
  deleteExcessMemories,
  setLastCleanup,
  getMemoryStats,
} from "./db.js";
import { cosineSimilarity } from "./embeddings.js";
import type { Memory } from "./schema.js";

export interface CleanupOpts {
  db: Database.Database;
  repoPath: string;
  maxAgeDays: number;
  maxEntries: number;
  deduplicate?: boolean;
}

export interface CleanupResult {
  oldDeleted: number;
  excessDeleted: number;
  duplicatesMerged: number;
}

function findDuplicates(memories: Memory[], threshold = 0.95): Array<[string, string]> {
  const duplicates: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    const a = memories[i]!;
    if (seen.has(a.id)) continue;

    for (let j = i + 1; j < memories.length; j++) {
      const b = memories[j]!;
      if (seen.has(b.id)) continue;
      if (a.category !== b.category) continue;

      const sim = cosineSimilarity(a.embedding, b.embedding);
      if (sim >= threshold) {
        duplicates.push([a.id, b.id]);
        seen.add(b.id);
      }
    }
  }

  return duplicates;
}

export async function runCleanup(opts: CleanupOpts): Promise<CleanupResult> {
  const result: CleanupResult = { oldDeleted: 0, excessDeleted: 0, duplicatesMerged: 0 };

  // 1. Delete old memories
  const maxAgeMs = opts.maxAgeDays * 24 * 60 * 60 * 1000;
  result.oldDeleted = deleteOldMemories(opts.db, maxAgeMs);

  // 2. Deduplicate if requested
  if (opts.deduplicate !== false) {
    const { listMemoriesForVectorSearch } = await import("./db.js");
    const since = Date.now() - opts.maxAgeDays * 24 * 60 * 60 * 1000;
    const candidates = listMemoriesForVectorSearch(opts.db, opts.repoPath, since, 5000);
    const duplicates = findDuplicates(candidates);

    if (duplicates.length > 0) {
      const toDelete = duplicates.map(([, b]) => b);
      const { deleteMemoriesByIds } = await import("./db.js");
      result.duplicatesMerged = deleteMemoriesByIds(opts.db, toDelete);
    }
  }

  // 3. Enforce max entries per repo
  result.excessDeleted = deleteExcessMemories(opts.db, opts.repoPath, opts.maxEntries);

  setLastCleanup(opts.db);
  return result;
}

export function shouldCleanup(db: Database.Database, intervalMs = 24 * 60 * 60 * 1000): boolean {
  const row = db.prepare("SELECT value FROM memory_meta WHERE key = 'last_cleanup'").get() as
    | { value: string }
    | undefined;
  if (!row) return true;
  const lastCleanup = parseInt(row.value, 10);
  return Number.isNaN(lastCleanup) || Date.now() - lastCleanup > intervalMs;
}
