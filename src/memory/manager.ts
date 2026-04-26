import type Database from "better-sqlite3";
import type { AiGatewayOptions } from "../agent/client.js";
import type { ChatMessage } from "../agent/messages.js";
import type { MemoryInput, MemoryQuery, HybridResult, MemoryStats } from "./schema.js";
import { openMemoryDb, closeMemoryDb, insertMemories, getMemoryStats, clearMemoriesForRepo } from "./db.js";
import { fetchEmbeddings } from "./embeddings.js";
import { retrieveMemories, formatRecalledMemories } from "./retrieval.js";
import { runCleanup, shouldCleanup } from "./cleanup.js";

export interface MemoryManagerOpts {
  dbPath: string;
  accountId: string;
  apiToken: string;
  model?: string;
  embeddingModel?: string;
  gateway?: AiGatewayOptions;
  maxAgeDays?: number;
  maxEntries?: number;
}

export class MemoryManager {
  private db: Database.Database | null = null;
  private opts: MemoryManagerOpts;

  constructor(opts: MemoryManagerOpts) {
    this.opts = opts;
  }

  open(): void {
    if (!this.db) {
      this.db = openMemoryDb(this.opts.dbPath);
    }
  }

  close(): void {
    if (this.db) {
      closeMemoryDb();
      this.db = null;
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  async storeMemories(inputs: MemoryInput[]): Promise<number> {
    if (!this.db || inputs.length === 0) return 0;

    const texts = inputs.map((i) => i.content);
    try {
      const embeddings = await fetchEmbeddings({
        accountId: this.opts.accountId,
        apiToken: this.opts.apiToken,
        model: this.opts.embeddingModel,
        texts,
        gateway: this.opts.gateway,
      });

      const batch = inputs.map((input, i) => ({
        input,
        embedding: embeddings[i]!,
      }));

      insertMemories(this.db, batch);
      return inputs.length;
    } catch (e) {
      // If embeddings fail, store without vectors (FTS5 still works)
      const { DEFAULT_EMBEDDING_DIM } = await import("./schema.js");
      const zeroEmbedding = new Float32Array(DEFAULT_EMBEDDING_DIM);
      const batch = inputs.map((input) => ({
        input,
        embedding: zeroEmbedding,
      }));
      insertMemories(this.db, batch);
      return inputs.length;
    }
  }

  async recall(query: MemoryQuery): Promise<HybridResult[]> {
    if (!this.db) return [];

    // Fetch embedding for query text if not provided
    if (!query.embedding && query.text) {
      try {
        const embeddings = await fetchEmbeddings({
          accountId: this.opts.accountId,
          apiToken: this.opts.apiToken,
          model: this.opts.embeddingModel,
          texts: [query.text],
          gateway: this.opts.gateway,
        });
        query.embedding = embeddings[0];
      } catch {
        // Continue without vector search
      }
    }

    return retrieveMemories({ db: this.db, query });
  }

  async recallForSession(repoPath: string, firstPrompt: string): Promise<string> {
    const results = await this.recall({
      text: firstPrompt,
      repoPath,
      limit: 10,
    });
    return formatRecalledMemories(results);
  }

  async cleanup(repoPath: string): Promise<{ oldDeleted: number; excessDeleted: number; duplicatesMerged: number }> {
    if (!this.db) return { oldDeleted: 0, excessDeleted: 0, duplicatesMerged: 0 };

    const maxAgeDays = this.opts.maxAgeDays ?? 90;
    const maxEntries = this.opts.maxEntries ?? 1000;

    if (!shouldCleanup(this.db)) {
      return { oldDeleted: 0, excessDeleted: 0, duplicatesMerged: 0 };
    }

    const result = await runCleanup({
      db: this.db,
      repoPath,
      maxAgeDays,
      maxEntries,
    });

    return result;
  }

  getStats(): MemoryStats | null {
    if (!this.db) return null;
    return getMemoryStats(this.db);
  }

  clearRepo(repoPath: string): number {
    if (!this.db) return 0;
    return clearMemoriesForRepo(this.db, repoPath);
  }
}
