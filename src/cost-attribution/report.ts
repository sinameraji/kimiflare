/**
 * Report builder: aggregate SessionUsage entries into a CostAttributionReport.
 */

import type { SessionUsage } from "../usage-tracker.js";
import type {
  TaskCategory,
  CategoryReportEntry,
  TopSessionEntry,
  CostAttributionReport,
  ReconciliationResult,
} from "./types.js";
import { ALL_CATEGORIES } from "./types.js";

export interface BuildReportOptions {
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string; // YYYY-MM-DD inclusive
  sessions: SessionUsage[];
  previousSessions?: SessionUsage[]; // for week-over-week comparison
  reconciliation?: ReconciliationResult;
  categoryFilter?: TaskCategory;
}

function dateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function aggregate(sessions: SessionUsage[], filter?: TaskCategory): Map<TaskCategory, { cost: number; tokens: number; sessions: number }> {
  const map = new Map<TaskCategory, { cost: number; tokens: number; sessions: number }>();
  for (const s of sessions) {
    const cat = (s.category ?? "other") as TaskCategory;
    if (filter && cat !== filter) continue;
    const entry = map.get(cat) ?? { cost: 0, tokens: 0, sessions: 0 };
    entry.cost += s.cost;
    entry.tokens += s.promptTokens + s.completionTokens;
    entry.sessions += 1;
    map.set(cat, entry);
  }
  return map;
}

export function buildReport(opts: BuildReportOptions): CostAttributionReport {
  const thisMap = aggregate(opts.sessions, opts.categoryFilter);
  const prevMap = opts.previousSessions ? aggregate(opts.previousSessions, opts.categoryFilter) : new Map();

  const categories: CategoryReportEntry[] = [];

  for (const cat of ALL_CATEGORIES) {
    const thisPeriod = thisMap.get(cat) ?? { cost: 0, tokens: 0, sessions: 0 };
    const lastPeriod = prevMap.get(cat) ?? { cost: 0, tokens: 0, sessions: 0 };

    if (thisPeriod.sessions === 0 && lastPeriod.sessions === 0) continue;

    const changePct = lastPeriod.cost > 0
      ? Math.round(((thisPeriod.cost - lastPeriod.cost) / lastPeriod.cost) * 1000) / 10
      : thisPeriod.cost > 0 ? 100 : 0;

    categories.push({
      category: cat,
      thisPeriod,
      lastPeriod,
      changePct,
    });
  }

  // Sort by cost descending
  categories.sort((a, b) => b.thisPeriod.cost - a.thisPeriod.cost);

  // Top sessions
  const topSessions: TopSessionEntry[] = opts.sessions
    .filter((s) => !opts.categoryFilter || s.category === opts.categoryFilter)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)
    .map((s) => ({
      sessionId: s.id,
      date: s.date,
      cost: s.cost,
      category: (s.category ?? "other") as TaskCategory,
      summary: s.summary,
    }));

  // Per-agent metrics
  const agentMap = new Map<string, { sessions: number; cost: number; tokens: number; promptTokens: number; completionTokens: number; latencies: number[]; cacheHits: number; cacheTotal: number }>();
  for (const s of opts.sessions) {
    if (!s.agentRole) continue;
    const entry = agentMap.get(s.agentRole) ?? { sessions: 0, cost: 0, tokens: 0, promptTokens: 0, completionTokens: 0, latencies: [], cacheHits: 0, cacheTotal: 0 };
    entry.sessions += 1;
    entry.cost += s.cost;
    entry.tokens += s.promptTokens + s.completionTokens;
    entry.promptTokens += s.promptTokens;
    entry.completionTokens += s.completionTokens;
    for (const log of s.gatewayLogs ?? []) {
      if (typeof log.duration === "number") entry.latencies.push(log.duration);
      entry.cacheTotal += 1;
      if (log.cached) entry.cacheHits += 1;
    }
    agentMap.set(s.agentRole, entry);
  }
  const agentMetrics = agentMap.size > 0
    ? Array.from(agentMap.entries()).map(([role, data]) => ({
        role,
        sessions: data.sessions,
        cost: data.cost,
        tokens: data.tokens,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        avgLatencyMs: data.latencies.length > 0
          ? Math.round(data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length)
          : undefined,
        cacheHitRatio: data.cacheTotal > 0
          ? Math.round((data.cacheHits / data.cacheTotal) * 1000) / 1000
          : undefined,
      })).sort((a, b) => b.cost - a.cost)
    : undefined;

  return {
    period: { start: opts.startDate, end: opts.endDate },
    categories,
    topSessions,
    reconciliation: opts.reconciliation ?? { status: "local-only", localCost: 0 },
    agentMetrics,
  };
}
