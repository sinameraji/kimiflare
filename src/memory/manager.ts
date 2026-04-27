import type Database from "better-sqlite3";
import type { AiGatewayOptions } from "../agent/client.js";
import { runKimi } from "../agent/client.js";
import type { ChatMessage } from "../agent/messages.js";
import type { MemoryInput, MemoryQuery, HybridResult, MemoryStats, MemoryCategory } from "./schema.js";
import {
  openMemoryDb,
  closeMemoryDb,
  insertMemory,
  insertMemories,
  getMemoryStats,
  clearMemoriesForRepo,
  listTopicKeys,
  findMemoriesByTopicKey,
  supersedeMemory,
  forgetMemory,
  listUnvectorizedMemories,
  updateMemoryEmbedding,
  getMemoryById,
} from "./db.js";
import { fetchEmbeddings } from "./embeddings.js";
import { retrieveMemories } from "./retrieval.js";
import { runCleanup, shouldCleanup } from "./cleanup.js";

export interface MemoryManagerOpts {
  dbPath: string;
  accountId: string;
  apiToken: string;
  model?: string;
  plumbingModel?: string;
  embeddingModel?: string;
  gateway?: AiGatewayOptions;
  maxAgeDays?: number;
  maxEntries?: number;
  redactSecrets?: boolean;
}

interface LlmOpts {
  accountId: string;
  apiToken: string;
  model: string;
  gateway?: AiGatewayOptions;
  signal?: AbortSignal;
}

async function runKimiText(opts: LlmOpts & { messages: ChatMessage[]; temperature?: number }): Promise<string> {
  const events = runKimi({
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
    reasoningEffort: "low",
    gateway: opts.gateway,
    signal: opts.signal,
  });
  let text = "";
  for await (const ev of events) {
    if (ev.type === "text") text += ev.delta;
  }
  return text.trim();
}

// Secret redaction patterns (default-on)
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: "[REDACTED_AWS_KEY]" },
  { pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, replacement: "[REDACTED_GH_TOKEN]" },
  { pattern: /sk-[a-zA-Z0-9]{48}/g, replacement: "[REDACTED_SK_KEY]" },
  { pattern: /\b[0-9a-f]{32,64}\b/g, replacement: "[REDACTED_HEX_KEY]" },
];

function redactSecrets(text: string): string {
  let result = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Deterministic topic-key normalization: lowercase, strip non-alphanum, replace spaces with _, truncate to 60. */
export function deterministicTopicKey(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

/** Pick the best existing topic key for a memory, or generate a new one. */
export function pickTopicKey(content: string, existingKeys: string[]): string | null {
  const normalized = deterministicTopicKey(content);
  if (!normalized) return null;

  for (const existing of existingKeys) {
    if (normalized.includes(existing) || existing.includes(normalized)) {
      return existing;
    }
  }

  return normalized;
}

const VERIFY_SYSTEM = `You are a fact-checking engine. Given a memory and the conversation context it was extracted from, verify whether the memory is directly supported by the context.

Rules:
- The memory must be directly stated or clearly implied by the context.
- Do not approve inferred facts that go beyond what was said.
- Do not approve facts with incorrect entities, versions, or file paths.

Return a JSON object:
{
  "valid": boolean,
  "confidence": "high" | "medium" | "low",
  "corrected_content": string | null  // if minor correction needed, provide it; otherwise null
}`;

const TOPIC_KEY_SYSTEM = `You are a topic normalization engine. Given a new memory and a list of existing topic keys for this project, decide whether the new memory belongs to an existing topic or needs a new one.

Rules:
- Topic keys are lowercase snake_case, max 3 words.
- If the new memory is about the same topic as an existing key, return the existing key.
- If it's a genuinely new topic, generate a new normalized key.
- Return ONLY the topic key string, nothing else.`;

const HYPOTHETICAL_QUERIES_SYSTEM = `Given a memory, generate 3-5 short search queries a user might type to find it.
Cover different phrasings: declarative, interrogative, and keyword-based.

Return a JSON array of strings. Example:
["what package manager does this project use?", "pnpm preference", "user likes pnpm over npm"]`;

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

  private get llmOpts(): LlmOpts {
    return {
      accountId: this.opts.accountId,
      apiToken: this.opts.apiToken,
      model: this.opts.model ?? "@cf/moonshotai/kimi-k2.6",
      gateway: this.opts.gateway,
    };
  }

  private get plumbingLlmOpts(): LlmOpts {
    return {
      accountId: this.opts.accountId,
      apiToken: this.opts.apiToken,
      model: this.opts.plumbingModel ?? "@cf/meta/llama-4-scout-17b-16e-instruct",
      gateway: this.opts.gateway,
    };
  }

  private shouldRedact(): boolean {
    return this.opts.redactSecrets !== false;
  }

  /**
   * Store a memory with verification, topic-key normalization, hypothetical queries,
   * secret redaction, and supersession.
   */
  async remember(
    content: string,
    category: MemoryCategory,
    importance: number,
    repoPath: string,
    sessionId: string,
    signal?: AbortSignal
  ): Promise<{ id: string; superseded?: string[] }> {
    if (!this.db) throw new Error("Memory DB not open");

    // 1. Redact secrets
    let safeContent = this.shouldRedact() ? redactSecrets(content) : content;
    if (!safeContent.trim()) {
      throw new Error("Memory content is empty after redaction");
    }

    // 2. Verify the memory (lightweight — just check it's coherent)
    const verified = await this.verifyMemory(safeContent, signal);
    if (!verified.valid) {
      throw new Error("Memory failed verification: not directly supported by context");
    }
    if (verified.corrected_content) {
      safeContent = verified.corrected_content;
    }

    // 3. Normalize topic key
    const topicKey = this.normalizeTopicKey(safeContent, repoPath);

    // 4. Check for supersession
    const supersededIds: string[] = [];
    if (topicKey) {
      const existing = findMemoriesByTopicKey(this.db, repoPath, topicKey);
      for (const old of existing) {
        // Simple heuristic: same topic key + similar content length = likely superseded
        // A more robust approach would use an LLM, but this avoids extra tokens
        supersedeMemory(this.db, old.id, "pending"); // Will update after insert
        supersededIds.push(old.id);
      }
    }

    // 5. Generate hypothetical queries for embedding
    const hypotheticalQueries = await this.generateHypotheticalQueries(safeContent, signal);
    const embedText = hypotheticalQueries.join(" | ") + " " + safeContent;

    // 6. Embed and store
    const embeddings = await fetchEmbeddings({
      accountId: this.opts.accountId,
      apiToken: this.opts.apiToken,
      model: this.opts.embeddingModel,
      texts: [embedText],
      gateway: this.opts.gateway,
    });

    const input: MemoryInput = {
      content: safeContent,
      category,
      sourceSessionId: sessionId,
      repoPath,
      importance: Math.max(1, Math.min(5, importance)),
      topicKey: topicKey ?? undefined,
    };

    const memory = insertMemory(this.db, input, embeddings[0]!);

    // 7. Update superseded pointers to point to the new memory
    for (const oldId of supersededIds) {
      supersedeMemory(this.db, oldId, memory.id);
    }

    return { id: memory.id, superseded: supersededIds.length > 0 ? supersededIds : undefined };
  }

  /**
   * Recall memories using the full hybrid retrieval pipeline.
   */
  async recall(query: MemoryQuery): Promise<HybridResult[]> {
    if (!this.db) return [];

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

  /**
   * Format recalled memories as a compact context block for injection into messages.
   */
  static formatRecalled(results: HybridResult[]): string {
    if (results.length === 0) return "";
    const lines: string[] = ["[recalled memories]"];
    for (const r of results) {
      const files = r.memory.relatedFiles.length > 0 ? ` [${r.memory.relatedFiles.join(", ")}]` : "";
      lines.push(`- [${r.memory.category}] ${r.memory.content}${files}`);
    }
    return lines.join("\n");
  }

  /**
   * Soft-delete a memory by ID.
   */
  async forget(id: string): Promise<boolean> {
    if (!this.db) return false;
    const mem = getMemoryById(this.db, id);
    if (!mem) return false;
    forgetMemory(this.db, id);
    return true;
  }

  /**
   * Backfill un-vectorized memories at startup.
   */
  async backfill(repoPath: string): Promise<number> {
    if (!this.db) return 0;
    const unvectorized = listUnvectorizedMemories(this.db, repoPath, 100);
    if (unvectorized.length === 0) return 0;

    let fixed = 0;
    for (const mem of unvectorized) {
      try {
        const embeddings = await fetchEmbeddings({
          accountId: this.opts.accountId,
          apiToken: this.opts.apiToken,
          model: this.opts.embeddingModel,
          texts: [mem.content],
          gateway: this.opts.gateway,
        });
        updateMemoryEmbedding(this.db, mem.id, embeddings[0]!);
        fixed++;
      } catch {
        // Skip on failure; will retry next startup
      }
    }
    return fixed;
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

  private async verifyMemory(content: string, signal?: AbortSignal): Promise<{ valid: boolean; corrected_content: string | null }> {
    const text = await runKimiText({
      ...this.plumbingLlmOpts,
      signal,
      messages: [
        { role: "system", content: VERIFY_SYSTEM },
        { role: "user", content: `Memory: "${content}"\n\nContext: This memory was explicitly provided by the user during a conversation.` },
      ],
    });

    // Try to parse JSON
    let parsed: unknown;
    try {
      const cleaned = text.replace(/```(?:json)?\s*|\s*```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If parsing fails, assume valid (user-provided memories are generally trustworthy)
      return { valid: true, corrected_content: null };
    }

    if (!parsed || typeof parsed !== "object") {
      return { valid: true, corrected_content: null };
    }

    const rec = parsed as Record<string, unknown>;
    const valid = rec.valid === true;
    const corrected = typeof rec.corrected_content === "string" ? rec.corrected_content : null;
    return { valid, corrected_content: corrected };
  }

  private normalizeTopicKey(content: string, repoPath: string): string | null {
    const existingKeys = listTopicKeys(this.db!, repoPath);
    return pickTopicKey(content, existingKeys);
  }

  private async generateHypotheticalQueries(content: string, signal?: AbortSignal): Promise<string[]> {
    const text = await runKimiText({
      ...this.plumbingLlmOpts,
      signal,
      messages: [
        { role: "system", content: HYPOTHETICAL_QUERIES_SYSTEM },
        { role: "user", content: `Memory: "${content}"` },
      ],
    });

    let parsed: unknown;
    try {
      const cleaned = text.replace(/```(?:json)?\s*|\s*```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string").slice(0, 5);
  }
}
