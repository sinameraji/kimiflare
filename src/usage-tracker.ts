import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Usage } from "./agent/messages.js";
import type { GatewayMeta } from "./agent/client.js";
import { calculateCost } from "./pricing.js";
import { RETENTION } from "./storage-limits.js";

const LOG_VERSION = 1;

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  gatewayRequests?: number;
  gatewayCachedRequests?: number;
  gatewayCost?: number;
}

export interface SessionUsage {
  id: string;
  date: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  gatewayRequests?: number;
  gatewayCachedRequests?: number;
  gatewayCost?: number;
  gatewayLogs?: GatewayUsageSnapshot[];
}

export interface GatewayUsageSnapshot {
  logId?: string;
  eventId?: string;
  cacheStatus?: string;
  cached?: boolean;
  duration?: number;
  statusCode?: number;
  model?: string;
  provider?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
}

export interface GatewayUsageLookup {
  accountId: string;
  apiToken: string;
  gatewayId: string;
  meta: GatewayMeta;
}

interface UsageLog {
  version: number;
  days: DailyUsage[];
  sessions: SessionUsage[];
}

function usageDir(): string {
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdg, "kimiflare");
}

function usagePath(): string {
  return join(usageDir(), "usage.json");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function cutoffDate(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function loadLog(): Promise<UsageLog> {
  try {
    const raw = await readFile(usagePath(), "utf8");
    const parsed = JSON.parse(raw) as UsageLog;
    if (parsed.version === LOG_VERSION) return parsed;
  } catch {
    /* no file or unreadable */
  }
  return { version: LOG_VERSION, days: [], sessions: [] };
}

async function saveLog(log: UsageLog): Promise<void> {
  await mkdir(usageDir(), { recursive: true });
  await writeFile(usagePath(), JSON.stringify(log, null, 2), "utf8");
}

function getOrCreateDay(log: UsageLog, date: string): DailyUsage {
  let day = log.days.find((d) => d.date === date);
  if (!day) {
    day = { date, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
    log.days.push(day);
  }
  return day;
}

function getOrCreateSession(log: UsageLog, sessionId: string, date: string): SessionUsage {
  let session = log.sessions.find((s) => s.id === sessionId);
  if (!session) {
    session = { id: sessionId, date, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
    log.sessions.push(session);
  }
  return session;
}

function gatewaySnapshotFromMeta(meta: GatewayMeta): GatewayUsageSnapshot | undefined {
  if (!meta.logId && !meta.eventId && !meta.cacheStatus && !meta.model) return undefined;
  return {
    logId: meta.logId,
    eventId: meta.eventId,
    cacheStatus: meta.cacheStatus,
    cached: meta.cacheStatus ? meta.cacheStatus.toUpperCase() === "HIT" : undefined,
    model: meta.model,
  };
}

function toGatewaySnapshot(entry: unknown, meta: GatewayMeta): GatewayUsageSnapshot | undefined {
  if (!entry || typeof entry !== "object") return gatewaySnapshotFromMeta(meta);
  const raw = entry as Record<string, unknown>;
  const cacheStatus = typeof meta.cacheStatus === "string" ? meta.cacheStatus : undefined;
  const cached = typeof raw.cached === "boolean" ? raw.cached : cacheStatus?.toUpperCase() === "HIT";
  return {
    logId: typeof raw.id === "string" ? raw.id : meta.logId,
    eventId: meta.eventId,
    cacheStatus,
    cached,
    duration: typeof raw.duration === "number" ? raw.duration : undefined,
    statusCode: typeof raw.status_code === "number" ? raw.status_code : undefined,
    model: typeof raw.model === "string" ? raw.model : meta.model,
    provider: typeof raw.provider === "string" ? raw.provider : undefined,
    tokensIn: typeof raw.tokens_in === "number" ? raw.tokens_in : undefined,
    tokensOut: typeof raw.tokens_out === "number" ? raw.tokens_out : undefined,
    cost: typeof raw.cost === "number" ? raw.cost : undefined,
  };
}

export async function fetchGatewayUsageSnapshot(
  lookup: GatewayUsageLookup,
): Promise<GatewayUsageSnapshot | undefined> {
  if (!lookup.meta.logId) return gatewaySnapshotFromMeta(lookup.meta);
  const url = `https://api.cloudflare.com/client/v4/accounts/${lookup.accountId}/ai-gateway/gateways/${encodeURIComponent(
    lookup.gatewayId,
  )}/logs`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${lookup.apiToken}` },
  });
  if (!res.ok) return gatewaySnapshotFromMeta(lookup.meta);
  const parsed = (await res.json()) as { result?: unknown[] };
  const match = Array.isArray(parsed.result)
    ? parsed.result.find((entry) => {
        return (
          entry &&
          typeof entry === "object" &&
          (entry as Record<string, unknown>).id === lookup.meta.logId
        );
      })
    : undefined;
  return toGatewaySnapshot(match, lookup.meta);
}

/** Prune old day and session entries to enforce retention policy. */
export function pruneUsageLog(log: UsageLog): UsageLog {
  const dayCutoff = cutoffDate(RETENTION.usageDayMaxAgeDays);
  const sessionCutoff = cutoffDate(RETENTION.usageSessionMaxAgeDays);
  const days = log.days.filter((d) => d.date >= dayCutoff);
  let sessions = log.sessions.filter((s) => s.date >= sessionCutoff);
  if (sessions.length > RETENTION.usageSessionMaxCount) {
    // Keep most recent sessions by date, then by array order as tie-breaker
    sessions = sessions
      .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0))
      .slice(0, RETENTION.usageSessionMaxCount);
  }
  return { ...log, days, sessions };
}

export async function recordUsage(
  sessionId: string,
  usage: Usage,
  gateway?: GatewayUsageLookup,
): Promise<void> {
  const log = pruneUsageLog(await loadLog());
  const date = today();
  const gatewaySnapshot = gateway
    ? await fetchGatewayUsageSnapshot(gateway).catch(() => gatewaySnapshotFromMeta(gateway.meta))
    : undefined;
  const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, usage.prompt_tokens_details?.cached_tokens ?? 0);
  const totalCost = gatewaySnapshot?.cost ?? cost.total;

  const day = getOrCreateDay(log, date);
  day.promptTokens += usage.prompt_tokens;
  day.completionTokens += usage.completion_tokens;
  day.cachedTokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
  day.cost += totalCost;
  if (gatewaySnapshot) {
    day.gatewayRequests = (day.gatewayRequests ?? 0) + 1;
    day.gatewayCachedRequests = (day.gatewayCachedRequests ?? 0) + (gatewaySnapshot.cached ? 1 : 0);
    day.gatewayCost = (day.gatewayCost ?? 0) + (gatewaySnapshot.cost ?? 0);
  }

  const session = getOrCreateSession(log, sessionId, date);
  session.promptTokens += usage.prompt_tokens;
  session.completionTokens += usage.completion_tokens;
  session.cachedTokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
  session.cost += totalCost;
  if (gatewaySnapshot) {
    session.gatewayRequests = (session.gatewayRequests ?? 0) + 1;
    session.gatewayCachedRequests = (session.gatewayCachedRequests ?? 0) + (gatewaySnapshot.cached ? 1 : 0);
    session.gatewayCost = (session.gatewayCost ?? 0) + (gatewaySnapshot.cost ?? 0);
    session.gatewayLogs = [...(session.gatewayLogs ?? []), gatewaySnapshot].slice(-100);
  }

  await saveLog(log);
}

export interface CostReport {
  session: DailyUsage;
  today: DailyUsage;
  month: DailyUsage;
  allTime: DailyUsage;
}

export async function getCostReport(sessionId?: string): Promise<CostReport> {
  const log = pruneUsageLog(await loadLog());
  const date = today();
  const currentMonth = date.slice(0, 7); // YYYY-MM

  const session = sessionId
    ? (log.sessions.find((s) => s.id === sessionId) ??
      { date, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 })
    : { date, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };

  const todayUsage =
    log.days.find((d) => d.date === date) ??
    { date, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };

  const monthUsage: DailyUsage = {
    date: currentMonth,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cost: 0,
  };
  for (const d of log.days) {
    if (d.date.startsWith(currentMonth)) {
      monthUsage.promptTokens += d.promptTokens;
      monthUsage.completionTokens += d.completionTokens;
      monthUsage.cachedTokens += d.cachedTokens;
      monthUsage.cost += d.cost;
      monthUsage.gatewayRequests = (monthUsage.gatewayRequests ?? 0) + (d.gatewayRequests ?? 0);
      monthUsage.gatewayCachedRequests =
        (monthUsage.gatewayCachedRequests ?? 0) + (d.gatewayCachedRequests ?? 0);
      monthUsage.gatewayCost = (monthUsage.gatewayCost ?? 0) + (d.gatewayCost ?? 0);
    }
  }

  const allTime: DailyUsage = {
    date: "all",
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cost: 0,
  };
  for (const d of log.days) {
    allTime.promptTokens += d.promptTokens;
    allTime.completionTokens += d.completionTokens;
    allTime.cachedTokens += d.cachedTokens;
    allTime.cost += d.cost;
    allTime.gatewayRequests = (allTime.gatewayRequests ?? 0) + (d.gatewayRequests ?? 0);
    allTime.gatewayCachedRequests =
      (allTime.gatewayCachedRequests ?? 0) + (d.gatewayCachedRequests ?? 0);
    allTime.gatewayCost = (allTime.gatewayCost ?? 0) + (d.gatewayCost ?? 0);
  }

  return { session, today: todayUsage, month: monthUsage, allTime };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtGateway(u: DailyUsage): string {
  if (!u.gatewayRequests) return "";
  const cached = u.gatewayCachedRequests ? `, ${u.gatewayCachedRequests} cached` : "";
  const cost = u.gatewayCost ? `, gateway $${u.gatewayCost.toFixed(4)}` : "";
  return `  gateway: ${u.gatewayRequests} req${cached}${cost}`;
}

export function formatCostReport(report: CostReport): string {
  const lines: string[] = [];
  const add = (label: string, u: DailyUsage) => {
    const cached = u.cachedTokens > 0 ? ` (${fmtTokens(u.cachedTokens)} cached)` : "";
    lines.push(
      `${label.padEnd(9)} $${u.cost.toFixed(4)}  (in: ${fmtTokens(u.promptTokens)}${cached}  out: ${fmtTokens(u.completionTokens)})${fmtGateway(u)}`,
    );
  };
  add("Session", report.session);
  add("Today", report.today);
  add("Month", report.month);
  add("All time", report.allTime);
  return lines.join("\n");
}
