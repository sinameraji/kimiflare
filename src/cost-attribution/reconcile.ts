/**
 * Cloudflare reconciliation: compare local cost sum to gateway ground truth.
 */

import type { ReconciliationResult } from "./types.js";

export interface ReconcileOptions {
  localCost: number;
  accountId?: string;
  apiToken?: string;
  gatewayId?: string;
  startDate: string;
  endDate: string;
}

// In-memory cache for 1 hour
const cache = new Map<string, { result: ReconciliationResult; expires: number }>();

function cacheKey(opts: ReconcileOptions): string {
  return `${opts.gatewayId ?? "none"}:${opts.startDate}:${opts.endDate}`;
}

export async function reconcileWithCloudflare(opts: ReconcileOptions): Promise<ReconciliationResult> {
  if (!opts.accountId || !opts.apiToken) {
    return { status: "local-only", localCost: opts.localCost, message: "Missing Cloudflare credentials" };
  }

  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { ...cached.result, localCost: opts.localCost };
  }

  try {
    // TODO: implement GraphQL Analytics fetch when gateway API is available
    // For now, return local-only to avoid blocking the report
    const result: ReconciliationResult = {
      status: "local-only",
      localCost: opts.localCost,
      message: "Cloudflare reconciliation not yet implemented",
    };

    cache.set(key, { result, expires: Date.now() + 60 * 60 * 1000 });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { status: "error", localCost: opts.localCost, message };
  }
}
