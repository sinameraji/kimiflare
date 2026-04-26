import type { AiGatewayOptions } from "../agent/client.js";

export interface EmbedOpts {
  accountId: string;
  apiToken: string;
  model?: string;
  texts: string[];
  gateway?: AiGatewayOptions;
}

const DEFAULT_MODEL = "@cf/baai/bge-base-en-v1.5";

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
    const body = JSON.stringify({ text: [text] });
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown error");
      throw new Error(`embeddings request failed (${res.status}): ${errText}`);
    }
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
    results.push(new Float32Array(vectors[0]!));
  }

  return results;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
