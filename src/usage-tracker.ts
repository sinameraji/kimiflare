import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Usage } from "./agent/messages.js";
import type { GatewayMeta } from "./agent/client.js";
import { getUserAgent } from "./util/version.js";
import { calculateCost } from "./pricing.js";
import { RETENTION } from "./storage-limits.js";

const LOG_VERSION = 1;

/** Emits "update" with the sessionId whenever a session's cost/turn state changes
 *  out-of-band (e.g. after a Gateway-log reconcile). The UI subscribes to refresh
 *  its displayed numbers without polling. */
export const usageEvents = new EventEmitter();

/** Maximum number of per-turn records kept per session. */
const MAX_TURNS_PER_SESSION = 50;

/** Reconciliation poll schedule in ms — total budget ~7.5s. Tuned for Gateway
 *  log eventual-consistency: the log is usually queryable within 1–2s. */
const RECONCILE_DELAYS_MS = [500, 1000, 2000, 4000];

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  gatewayRequests?: number;
  gatewayCachedRequests?: number;
  gatewayCost?: number;
  /** True iff this is a session-scoped DailyUsage with at least one turn whose
   *  Gateway cost has not yet been confirmed. Always undefined for day/month/all-time. */
  reconcilePending?: boolean;
  /** Most recently confirmed turn duration in ms, sourced from the Gateway log.
   *  Only set on the session-scoped DailyUsage when at least one turn has been
   *  reconciled with a duration field. */
  lastTurnMs?: number;
}

/** A single agent turn's cost record. `estimatedCost` is the local-pricing
 *  number captured at recordUsage time; `confirmedCost` (if set) replaces it
 *  once the Gateway log API confirms the actual billed cost. */
export interface TurnCost {
  turnId: string;
  logId?: string;
  estimatedCost: number;
  confirmedCost?: number;
  durationMs?: number;
  cacheStatus?: string;
  reconciledAt?: number;
  reconcileFailed?: boolean;
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
  turns?: TurnCost[];
  // Cost attribution fields
  category?: string;
  confidence?: number;
  classifiedBy?: "heuristic" | "llm" | "user";
  classifiedAt?: string;
  summary?: string;
  tags?: string[];
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

export interface UsageLog {
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

function historyPath(): string {
  return join(usageDir(), "history.jsonl");
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

/** Serialize all read-modify-write operations on usage.json so concurrent
 *  recordUsage / reconcile calls don't clobber each other's edits. */
let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

/** Load the append-only history JSONL file. Never pruned. */
async function loadHistory(): Promise<DailyUsage[]> {
  try {
    const raw = await readFile(historyPath(), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const entries: DailyUsage[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as DailyUsage;
        if (parsed.date) entries.push(parsed);
      } catch {
        /* skip malformed line */
      }
    }
    return entries;
  } catch {
    /* no file or unreadable */
  }
  return [];
}

/** Append or update a day's entry in the history JSONL file.
 *  Reads the whole file (it's tiny), updates the matching day or appends,
 *  then writes back. This keeps the file compact and deduplicated by date.
 */
async function upsertHistoryDay(day: DailyUsage): Promise<void> {
  const entries = await loadHistory();
  const idx = entries.findIndex((e) => e.date === day.date);
  if (idx >= 0) {
    entries[idx] = day;
  } else {
    entries.push(day);
  }
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await mkdir(usageDir(), { recursive: true });
  await writeFile(historyPath(), lines, "utf8");
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
    headers: { Authorization: `Bearer ${lookup.apiToken}`, "User-Agent": getUserAgent() },
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
  model?: string,
): Promise<void> {
  const cost = calculateCost(
    usage.prompt_tokens,
    usage.completion_tokens,
    usage.prompt_tokens_details?.cached_tokens ?? 0,
    model,
  );
  const estimatedCost = cost.total;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const turnId = randomUUID();
  const logId = gateway?.meta.logId;

  await withLock(async () => {
    const log = pruneUsageLog(await loadLog());
    const date = today();

    const day = getOrCreateDay(log, date);
    day.promptTokens += usage.prompt_tokens;
    day.completionTokens += usage.completion_tokens;
    day.cachedTokens += cachedTokens;
    day.cost += estimatedCost;

    const session = getOrCreateSession(log, sessionId, date);
    session.promptTokens += usage.prompt_tokens;
    session.completionTokens += usage.completion_tokens;
    session.cachedTokens += cachedTokens;
    session.cost += estimatedCost;

    const turn: TurnCost = {
      turnId,
      logId,
      estimatedCost,
      cacheStatus: gateway?.meta.cacheStatus,
    };
    session.turns = [...(session.turns ?? []), turn].slice(-MAX_TURNS_PER_SESSION);

    // Capture whatever Gateway metadata is immediately available from headers,
    // so /cost has a stub to render before the reconcile lands.
    if (gateway) {
      const stub = gatewaySnapshotFromMeta(gateway.meta);
      if (stub) {
        session.gatewayRequests = (session.gatewayRequests ?? 0) + 1;
        session.gatewayCachedRequests =
          (session.gatewayCachedRequests ?? 0) + (stub.cached ? 1 : 0);
        session.gatewayLogs = [...(session.gatewayLogs ?? []), stub].slice(-100);
        day.gatewayRequests = (day.gatewayRequests ?? 0) + 1;
        day.gatewayCachedRequests =
          (day.gatewayCachedRequests ?? 0) + (stub.cached ? 1 : 0);
      }
    }

    await saveLog(log);
    await upsertHistoryDay(day);
  });

  usageEvents.emit("update", sessionId);

  // Fire-and-forget reconcile against the Gateway logs API. Eventual consistency
  // means the log may not be queryable for ~1s after the request, so we poll.
  if (gateway && logId) {
    void reconcileTurnCost(sessionId, turnId, gateway).catch(() => undefined);
  }
}

/** Poll the AI Gateway logs API until this turn's log surfaces (or we exhaust
 *  the retry budget), then patch the turn record with the real cost/duration
 *  and adjust the session/day totals. Emits "update" so the UI re-renders. */
export async function reconcileTurnCost(
  sessionId: string,
  turnId: string,
  gateway: GatewayUsageLookup,
): Promise<void> {
  for (const delay of RECONCILE_DELAYS_MS) {
    await new Promise((r) => setTimeout(r, delay));
    let snapshot: GatewayUsageSnapshot | undefined;
    try {
      snapshot = await fetchGatewayUsageSnapshot(gateway);
    } catch {
      continue;
    }
    // Require the matched log entry to carry an authoritative cost. The
    // header-only fallback (no cost field) is not a successful reconcile.
    if (!snapshot || typeof snapshot.cost !== "number") continue;

    const patched = await withLock(async () => {
      const log = pruneUsageLog(await loadLog());
      const session = log.sessions.find((s) => s.id === sessionId);
      const turn = session?.turns?.find((t) => t.turnId === turnId);
      if (!session || !turn || turn.confirmedCost !== undefined) return false;

      const delta = snapshot!.cost! - turn.estimatedCost;
      turn.confirmedCost = snapshot!.cost;
      turn.durationMs = snapshot!.duration;
      turn.cacheStatus = snapshot!.cacheStatus ?? turn.cacheStatus;
      turn.reconciledAt = Date.now();

      session.cost += delta;
      session.gatewayCost = (session.gatewayCost ?? 0) + snapshot!.cost!;

      const day = getOrCreateDay(log, session.date);
      day.cost += delta;
      day.gatewayCost = (day.gatewayCost ?? 0) + snapshot!.cost!;

      // Replace the latest gatewayLogs stub with the fully-populated snapshot
      // when we can match by logId; otherwise append.
      const logs = session.gatewayLogs ?? [];
      const idx = snapshot!.logId
        ? logs.findIndex((l) => l.logId === snapshot!.logId)
        : -1;
      if (idx >= 0) logs[idx] = snapshot!;
      else logs.push(snapshot!);
      session.gatewayLogs = logs.slice(-100);

      await saveLog(log);
      await upsertHistoryDay(day);
      return true;
    });

    if (patched) {
      usageEvents.emit("update", sessionId);
    }
    return;
  }

  // Retries exhausted — mark the turn so the UI can drop its spinner.
  await withLock(async () => {
    const log = await loadLog();
    const turn = log.sessions.find((s) => s.id === sessionId)?.turns?.find((t) => t.turnId === turnId);
    if (!turn || turn.confirmedCost !== undefined) return;
    turn.reconcileFailed = true;
    await saveLog(log);
  });
  usageEvents.emit("update", sessionId);
}

export interface CostReport {
  session: DailyUsage;
  today: DailyUsage;
  month: DailyUsage;
  allTime: DailyUsage;
}

/** Merge usage.json days with history.jsonl days. usage.json takes precedence for overlapping dates. */
function mergeDays(usageDays: DailyUsage[], historyDays: DailyUsage[]): DailyUsage[] {
  const map = new Map<string, DailyUsage>();
  for (const d of historyDays) map.set(d.date, d);
  for (const d of usageDays) map.set(d.date, d); // overwrite with fresher usage.json data
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function getCostReport(sessionId?: string): Promise<CostReport> {
  const log = pruneUsageLog(await loadLog());
  const history = await loadHistory();
  const allDays = mergeDays(log.days, history);
  const date = today();
  const currentMonth = date.slice(0, 7); // YYYY-MM

  const rawSession = sessionId ? log.sessions.find((s) => s.id === sessionId) : undefined;
  const session: DailyUsage = rawSession
    ? {
        date: rawSession.date,
        promptTokens: rawSession.promptTokens,
        completionTokens: rawSession.completionTokens,
        cachedTokens: rawSession.cachedTokens,
        cost: rawSession.cost,
        gatewayRequests: rawSession.gatewayRequests,
        gatewayCachedRequests: rawSession.gatewayCachedRequests,
        gatewayCost: rawSession.gatewayCost,
        reconcilePending: hasPendingReconcile(rawSession),
        lastTurnMs: latestConfirmedDurationMs(rawSession),
      }
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
  for (const d of allDays) {
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
  for (const d of allDays) {
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

function hasPendingReconcile(session: SessionUsage): boolean {
  if (!session.turns) return false;
  return session.turns.some(
    (t) => t.logId && t.confirmedCost === undefined && !t.reconcileFailed,
  );
}

function latestConfirmedDurationMs(session: SessionUsage): number | undefined {
  if (!session.turns) return undefined;
  for (let i = session.turns.length - 1; i >= 0; i--) {
    const ms = session.turns[i]?.durationMs;
    if (typeof ms === "number") return ms;
  }
  return undefined;
}

/** Fetch the GatewayUsageSnapshot array recorded against a session, for /cost rendering. */
export async function getSessionGatewayLogs(sessionId: string): Promise<GatewayUsageSnapshot[]> {
  const log = await loadLog();
  const session = log.sessions.find((s) => s.id === sessionId);
  return session?.gatewayLogs ?? [];
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

/** Render the AI Gateway section of /cost — cache hit ratio, recent log IDs,
 *  and a dashboard link. Returns empty string when no Gateway activity. */
export function formatGatewaySection(
  report: CostReport,
  accountId: string,
  gatewayId: string,
  recentLogs: GatewayUsageSnapshot[] = [],
): string {
  const session = report.session;
  const today = report.today;
  if (!session.gatewayRequests && !today.gatewayRequests) return "";
  const lines: string[] = ["─── AI Gateway ───"];
  const fmtRatio = (u: DailyUsage) => {
    const req = u.gatewayRequests ?? 0;
    if (!req) return "n/a";
    const cached = u.gatewayCachedRequests ?? 0;
    const pct = (cached / req) * 100;
    return `${cached}/${req} (${pct.toFixed(1)}%)`;
  };
  lines.push(`  cache hit ratio  session: ${fmtRatio(session)}   today: ${fmtRatio(today)}`);
  const logs = recentLogs.slice(-5).reverse();
  if (logs.length > 0) {
    lines.push("  recent requests:");
    for (const log of logs) {
      const id = log.logId ?? log.eventId ?? "?";
      const cache = log.cacheStatus ? ` [${log.cacheStatus}]` : "";
      lines.push(
        `    ${id}${cache}  https://dash.cloudflare.com/${accountId}/ai/ai-gateway/gateways/${gatewayId}/logs/${id}`,
      );
    }
  }
  lines.push(
    `  dashboard:  https://dash.cloudflare.com/${accountId}/ai/ai-gateway/gateways/${gatewayId}`,
  );
  return lines.join("\n");
}

/** Render the per-feature cost breakdown — one row per metadata.feature tag
 *  observed in the Gateway logs. Skips trivial breakdowns (1 unknown row). */
export function formatFeatureBreakdown(
  breakdown: Array<{ feature: string; cost: number; requests: number }> | undefined,
): string {
  if (!breakdown || breakdown.length === 0) return "";
  if (breakdown.length === 1 && breakdown[0]!.feature === "unknown") return "";
  const lines = ["─── By feature (Gateway-confirmed) ───"];
  for (const row of breakdown) {
    lines.push(
      `  ${row.feature.padEnd(20)} $${row.cost.toFixed(4)}  (${row.requests} req)`,
    );
  }
  return lines.join("\n");
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
