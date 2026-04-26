import type { AiGatewayOptions } from "../agent/client.js";

export interface EmbedOpts {
  accountId: string;
  apiToken: string;
  model?: string;
  texts: string[];
  gateway?: AiGatewayOptions;
}

const DEFAULT_MODEL = "@cf/baai/bge-base-en-v1.5";
const MAX_EMBED_CHARS = 2000; // Approximate token limit for bge-base-en-v1.5

function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_EMBED_CHARS) return text;
  return text.slice(0, MAX_EMBED_CHARS);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3
): Promise<Response> {
  let lastError: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        // Rate limit or server error — retry with backoff
        const delay = 1000 * 2 ** i;
        await sleep(delay);
        continue;
      }
      const errText = await res.text().catch(() => "unknown error");
      throw new Error(`embeddings request failed (${res.status}): ${errText}`);
    } catch (e) {
      lastError = e as Error;
      if (i < retries - 1) {
        await sleep(1000 * 2 ** i);
      }
    }
  }
  throw lastError ?? new Error("embeddings request failed after retries");
}

export async function fetchEmbeddings(opts: EmbedOpts): Promise<Float32Array[]> {
  const model = opts.model ?? DEFAULT_MODEL;
  const url = opts.gateway
    ? `https://gateway.ai.cloudflare.com/v1/${opts.accountId}/${opts.gateway.id}/workers-ai/${model}`
    : `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${model}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiToken}`,
    "Content-Type": "application/json",
  };

  if (opts.gateway?.metadata) {
    for (const [k, v] of Object.entries(opts.gateway.metadata)) {
      headers[`cf-aig-metadata-${k}`] = String(v);
    }
  }

  // Workers AI embeddings endpoint accepts single text or batch
  const results: Float32Array[] = [];
  for (const text of opts.texts) {
    const truncated = truncateForEmbedding(text);
    const body = JSON.stringify({ text: [truncated] });
    const res = await fetchWithRetry(url, { method: "POST", headers, body });
    const json = (await res.json()) as unknown;

    // Workers AI returns { result: { data: number[][] } } or { result: { shape: [...], data: number[] } }
    let vectors: number[][] = [];
    if (json && typeof json === "object") {
      const result = (json as Record<string, unknown>).result;
      if (result && typeof result === "object") {
        const data = (result as Record<string, unknown>).data;
        if (Array.isArray(data)) {
          if (Array.isArray(data[0])) {
            vectors = data as number[][];
          } else {
            // Flattened array with shape info
            const shape = (result as Record<string, unknown>).shape as number[] | undefined;
            if (shape && shape.length === 2) {
              const dim = shape[1]!;
              const flat = data as number[];
              vectors = [];
              for (let i = 0; i < flat.length; i += dim) {
                vectors.push(flat.slice(i, i + dim));
              }
            }
          }
        }
      }
    }

    if (vectors.length === 0) {
      throw new Error("embeddings response contained no vectors");
    }
    const vec = new Float32Array(vectors[0]!);
    if (vec.length === 0) {
      throw new Error("embeddings response contained empty vector");
    }
    results.push(vec);
  }

  return results;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    // Mismatched dimensions — skip this pair
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
