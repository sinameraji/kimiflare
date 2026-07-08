import type { AiGatewayOptions } from "../agent/client.js";
import { getUserAgent } from "../util/version.js";

export interface EmbedOpts {
  accountId: string;
  apiToken: string;
  model?: string;
  texts: string[];
  gateway?: AiGatewayOptions;
  cloudMode?: boolean;
  cloudToken?: string;
  cloudDeviceId?: string;
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

/**
 * Parse the OpenAI-compatible embeddings response returned by AI Gateway's
 * /compat/embeddings endpoint.
 */
function parseOpenAiEmbeddingResponse(json: unknown): Float32Array[] {
  if (!json || typeof json !== "object") {
    throw new Error("embeddings response was not an object");
  }
  const data = (json as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new Error("embeddings response contained no data array");
  }

  const indexed: { index: number; vector: Float32Array }[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const embedding = (item as Record<string, unknown>).embedding;
    const idx = (item as Record<string, unknown>).index;
    if (!Array.isArray(embedding)) continue;
    indexed.push({
      index: typeof idx === "number" ? idx : indexed.length,
      vector: new Float32Array(embedding as number[]),
    });
  }

  if (indexed.length === 0) {
    throw new Error("embeddings response contained no vectors");
  }

  indexed.sort((a, b) => a.index - b.index);
  return indexed.map((item) => {
    if (item.vector.length === 0) {
      throw new Error("embeddings response contained empty vector");
    }
    return item.vector;
  });
}

/**
 * Parse the native Workers AI embeddings response returned by the direct
 * api.cloudflare.com endpoint.
 */
function parseWorkersAiEmbeddingResponse(json: unknown): Float32Array[] {
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

  return vectors.map((vec) => {
    const arr = new Float32Array(vec);
    if (arr.length === 0) {
      throw new Error("embeddings response contained empty vector");
    }
    return arr;
  });
}

export async function fetchEmbeddings(opts: EmbedOpts): Promise<Float32Array[]> {
  const model = opts.model ?? DEFAULT_MODEL;
  const texts = opts.texts.map(truncateForEmbedding);

  if (texts.length === 0) {
    return [];
  }

  let url: string;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": getUserAgent(),
  };
  let body: string;
  let parseResponse: (json: unknown) => Float32Array[];

  if (opts.cloudMode) {
    url = "https://api.kimiflare.com/v1/embeddings";
    if (opts.cloudToken) headers.Authorization = `Bearer ${opts.cloudToken}`;
    if (opts.cloudDeviceId) headers["X-Device-ID"] = opts.cloudDeviceId;

    body = JSON.stringify({ text: texts });
    parseResponse = parseWorkersAiEmbeddingResponse;
  } else if (opts.gateway) {
    // Gateway path: AI Gateway's OpenAI-compatible /compat/embeddings endpoint.
    // The native /workers-ai/{model} path returns HTTP 401 for embedding models,
    // so we route through the Universal Endpoint with a workers-ai/ model prefix.
    url = `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
      opts.accountId,
    )}/${encodeURIComponent(opts.gateway.id)}/compat/embeddings`;
    headers.Authorization = `Bearer ${opts.apiToken}`;

    const merged: Record<string, string | number | boolean> = {
      ...(opts.gateway.metadata ?? {}),
      feature: "embedding",
    };
    const entries = Object.entries(merged).slice(0, 5);
    headers["cf-aig-metadata"] = JSON.stringify(Object.fromEntries(entries));
    if (opts.gateway.cacheTtl !== undefined) {
      headers["cf-aig-cache-ttl"] = String(opts.gateway.cacheTtl);
    }
    if (opts.gateway.skipCache !== undefined) {
      headers["cf-aig-skip-cache"] = String(opts.gateway.skipCache);
    }

    body = JSON.stringify({
      model: `workers-ai/${model}`,
      input: texts,
    });
    parseResponse = parseOpenAiEmbeddingResponse;
  } else {
    // Direct Workers AI path: lower latency, no gateway overhead.
    url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      opts.accountId,
    )}/ai/run/${encodeURIComponent(model)}`;
    headers.Authorization = `Bearer ${opts.apiToken}`;

    body = JSON.stringify({ text: texts });
    parseResponse = parseWorkersAiEmbeddingResponse;
  }

  const res = await fetchWithRetry(url, { method: "POST", headers, body });
  const json = (await res.json()) as unknown;
  return parseResponse(json);
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
