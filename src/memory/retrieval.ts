import type Database from "better-sqlite3";
import type { Memory, MemoryQuery, HybridResult } from "./schema.js";
import { searchMemoriesFts, listMemoriesForVectorSearch, updateAccessedAt } from "./db.js";
import { cosineSimilarity } from "./embeddings.js";

export interface RetrieveOpts {
  db: Database.Database;
  query: MemoryQuery;
}

function normalizeFtsRank(rank: number): number {
  // FTS5 rank is typically a small negative log value; normalize to 0-1
  // Lower rank = better match. Typical range: 0 to ~10
  const clamped = Math.max(0, Math.min(10, rank));
  return 1 - clamped / 10;
}

function normalizeVectorScore(score: number): number {
  // Cosine similarity range: -1 to 1; typically 0.5 to 1.0 for relevant matches
  return Math.max(0, (score - 0.5) * 2);
}

function computeExactScore(memory: Memory, queryText: string, cwd: string): number {
  let score = 0;
  const lowerQuery = queryText.toLowerCase();

  // File path matches
  for (const file of memory.relatedFiles) {
    const basename = file.split("/").pop() ?? file;
    if (lowerQuery.includes(basename.toLowerCase()) || basename.toLowerCase().includes(lowerQuery)) {
      score += 0.3;
    }
    if (cwd && file.startsWith(cwd)) {
      score += 0.1;
    }
  }

  // Content keyword overlap
  const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 3);
  const contentWords = new Set(memory.content.toLowerCase().split(/\s+/));
  let matches = 0;
  for (const qw of queryWords) {
    if (contentWords.has(qw)) matches++;
  }
  if (queryWords.length > 0) {
    score += (matches / queryWords.length) * 0.2;
  }

  return Math.min(1, score);
}

export async function retrieveMemories(opts: RetrieveOpts): Promise<HybridResult[]> {
  const { db, query } = opts;
  const limit = query.limit ?? 10;
  const repoPath = query.repoPath ?? process.cwd();
  const maxAgeDays = query.maxAgeDays ?? 90;
  const since = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  // 1. FTS5 search
  const ftsResults = searchMemoriesFts(db, query.text, repoPath, limit * 3);

  // 2. Vector search candidates (recent memories in repo)
  let vectorCandidates: Memory[] = [];
  if (query.embedding) {
    vectorCandidates = listMemoriesForVectorSearch(db, repoPath, since, 2000);
  }

  // 3. Combine and score
  const scored = new Map<string, HybridResult>();

  // Add FTS results
  for (const { memory, rank } of ftsResults) {
    const ftsScore = normalizeFtsRank(rank);
    const exactScore = computeExactScore(memory, query.text, repoPath);
    let vectorScore = 0;
    if (query.embedding) {
      vectorScore = normalizeVectorScore(cosineSimilarity(query.embedding, memory.embedding));
    }
    const combined = ftsScore * 0.4 + vectorScore * 0.5 + exactScore * 0.1;
    scored.set(memory.id, { memory, ftsScore, vectorScore, exactScore, combinedScore: combined });
  }

  // Add vector results (may overlap with FTS)
  if (query.embedding) {
    for (const memory of vectorCandidates) {
      if (scored.has(memory.id)) continue;
      const vectorScore = normalizeVectorScore(cosineSimilarity(query.embedding, memory.embedding));
      if (vectorScore < 0.1) continue; // Skip very low similarity
      const exactScore = computeExactScore(memory, query.text, repoPath);
      const combined = vectorScore * 0.5 + exactScore * 0.1; // No FTS score
      scored.set(memory.id, { memory, ftsScore: 0, vectorScore, exactScore, combinedScore: combined });
    }
  }

  // 4. Sort by combined score and take top-K
  const results = Array.from(scored.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit);

  // 5. Update accessed_at for recalled memories
  if (results.length > 0) {
    updateAccessedAt(db, results.map((r) => r.memory.id));
  }

  return results;
}

export function formatRecalledMemories(results: HybridResult[]): string {
  if (results.length === 0) return "";
  const lines = results.map((r) => {
    const files = r.memory.relatedFiles.length > 0 ? ` [${r.memory.relatedFiles.join(", ")}]` : "";
    return `- [${r.memory.category}] ${r.memory.content}${files}`;
  });
  return `Recalled memories from previous sessions:\n${lines.join("\n")}`;
}
