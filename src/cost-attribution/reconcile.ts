/**
 * Cloudflare AI Gateway reconciliation: bulk-fetch /ai-gateway logs in the
 * given date range and treat the gateway's cost as ground truth.
 */

import type { ReconciliationResult } from "./types.js";
import { getUserAgent } from "../util/version.js";

export interface ReconcileOptions {
  localCost: number;
  accountId?: string;
  apiToken?: string;
  gatewayId?: string;
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string;   // YYYY-MM-DD inclusive
}

// In-memory cache for 1 hour
const cache = new Map<string, { result: ReconciliationResult; expires: number }>();

function cacheKey(opts: ReconcileOptions): string {
  return `${opts.gatewayId ?? "none"}:${opts.startDate}:${opts.endDate}`;
}

interface GatewayLog {
  id?: string;
  cost?: number;
  cached?: boolean;
  metadata?: Record<string, unknown> | string | null;
  created_at?: string;
}

function toIsoStartOfDay(date: string): string {
  return `${date}T00:00:00Z`;
}

function toIsoEndOfDay(date: string): string {
  return `${date}T23:59:59Z`;
}

export async function fetchGatewayLogs(
  accountId: string,
  apiToken: string,
  gatewayId: string,
  startDate: string,
  endDate: string,
  pageLimit = 10,
): Promise<GatewayLog[]> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai-gateway/gateways/${encodeURIComponent(gatewayId)}/logs`;
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "User-Agent": getUserAgent(),
  };
  const out: GatewayLog[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < pageLimit; i++) {
    const params = new URLSearchParams({
      per_page: "500",
      start_date: toIsoStartOfDay(startDate),
      end_date: toIsoEndOfDay(endDate),
      order_by: "created_at",
      order_by_direction: "desc",
    });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${base}?${params.toString()}`, { headers });
    if (!res.ok) {
      throw new Error(`gateway logs HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: GatewayLog[];
      result_info?: { cursor?: string; total_pages?: number };
    };
    const page = Array.isArray(json.result) ? json.result : [];
    out.push(...page);
    cursor = json.result_info?.cursor;
    if (!cursor || page.length === 0) break;
  }
  return out;
}

export interface FeatureBreakdown {
  feature: string;
  cost: number;
  requests: number;
}

export function aggregateByFeature(logs: GatewayLog[]): FeatureBreakdown[] {
  const map = new Map<string, FeatureBreakdown>();
  for (const log of logs) {
    let feature = "unknown";
    const m = log.metadata;
    if (m && typeof m === "object" && !Array.isArray(m)) {
      const f = (m as Record<string, unknown>).feature;
      if (typeof f === "string") feature = f;
    } else if (typeof m === "string") {
      try {
        const parsed = JSON.parse(m) as Record<string, unknown>;
        if (typeof parsed.feature === "string") feature = parsed.feature;
      } catch {
        /* ignore */
      }
    }
    const entry = map.get(feature) ?? { feature, cost: 0, requests: 0 };
    entry.cost += typeof log.cost === "number" ? log.cost : 0;
    entry.requests += 1;
    map.set(feature, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

export async function reconcileWithCloudflare(opts: ReconcileOptions): Promise<ReconciliationResult> {
  if (!opts.accountId || !opts.apiToken) {
    return {
      status: "local-only",
      localCost: opts.localCost,
      message: "Missing Cloudflare credentials",
    };
  }
  if (!opts.gatewayId) {
    return {
      status: "local-only",
      localCost: opts.localCost,
      message: "No AI Gateway configured",
    };
  }

  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { ...cached.result, localCost: opts.localCost };
  }

  try {
    const logs = await fetchGatewayLogs(
      opts.accountId,
      opts.apiToken,
      opts.gatewayId,
      opts.startDate,
      opts.endDate,
    );
    const cloudflareCost = logs.reduce(
      (sum, log) => sum + (typeof log.cost === "number" ? log.cost : 0),
      0,
    );
    const driftPct =
      cloudflareCost > 0
        ? Math.abs(opts.localCost - cloudflareCost) / cloudflareCost
        : 0;
    const status: ReconciliationResult["status"] = driftPct < 0.02 ? "verified" : "drift";
    const result: ReconciliationResult = {
      status,
      localCost: opts.localCost,
      cloudflareCost,
      driftPct: Math.round(driftPct * 1000) / 10,
      message: `Reconciled ${logs.length} Gateway log entries`,
    };
    cache.set(key, { result, expires: Date.now() + 60 * 60 * 1000 });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { status: "error", localCost: opts.localCost, message };
  }
}
