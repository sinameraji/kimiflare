export type MemoryCategory = "fact" | "event" | "instruction" | "task" | "preference";

export interface Memory {
  id: string;
  content: string;
  embedding: Float32Array;
  category: MemoryCategory;
  sourceSessionId: string;
  repoPath: string;
  createdAt: number;
  accessedAt: number;
  importance: number;
  relatedFiles: string[];
  topicKey: string | null;
  supersededBy: string | null;
  forgotten: boolean;
  vectorized: boolean;
}

export interface MemoryInput {
  content: string;
  category: MemoryCategory;
  sourceSessionId: string;
  repoPath: string;
  importance: number;
  relatedFiles?: string[];
  topicKey?: string;
}

export interface MemoryQuery {
  text: string;
  embedding?: Float32Array;
  repoPath?: string;
  category?: MemoryCategory;
  limit?: number;
  maxAgeDays?: number;
}

export interface HybridResult {
  memory: Memory;
  ftsScore: number;
  vectorScore: number;
  exactScore: number;
  topicKeyScore: number;
  combinedScore: number;
}

export interface MemoryStats {
  totalCount: number;
  dbSizeBytes: number;
  lastCleanupAt: number | null;
  byCategory: Record<MemoryCategory, number>;
}

export const DEFAULT_EMBEDDING_DIM = 768;
export const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
