import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Usage } from "./agent/messages.js";
import { calculateCost } from "./pricing.js";
import { RETENTION } from "./storage-limits.js";

const LOG_VERSION = 1;

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
}

export interface SessionUsage {
  id: string;
  date: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
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

export async function recordUsage(sessionId: string, usage: Usage): Promise<void> {
  const log = pruneUsageLog(await loadLog());
  const date = today();
  const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, usage.prompt_tokens_details?.cached_tokens ?? 0);

  const day = getOrCreateDay(log, date);
  day.promptTokens += usage.prompt_tokens;
  day.completionTokens += usage.completion_tokens;
  day.cachedTokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
  day.cost += cost.total;

  const session = getOrCreateSession(log, sessionId, date);
  session.promptTokens += usage.prompt_tokens;
  session.completionTokens += usage.completion_tokens;
  session.cachedTokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
  session.cost += cost.total;

  await saveLog(log);
}

export interface CostReport {
  session: DailyUsage;
  today: DailyUsage;
  month: DailyUsage;
  allTime: DailyUsage;
}

export async function getCostReport(sessionId: string): Promise<CostReport> {
  const log = pruneUsageLog(await loadLog());
  const date = today();
  const currentMonth = date.slice(0, 7); // YYYY-MM

  const session =
    log.sessions.find((s) => s.id === sessionId) ??
    { date, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };

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
  }

  return { session, today: todayUsage, month: monthUsage, allTime };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatCostReport(report: CostReport): string {
  const lines: string[] = [];
  const add = (label: string, u: DailyUsage) => {
    const cached = u.cachedTokens > 0 ? ` (${fmtTokens(u.cachedTokens)} cached)` : "";
    lines.push(
      `${label.padEnd(9)} $${u.cost.toFixed(4)}  (in: ${fmtTokens(u.promptTokens)}${cached}  out: ${fmtTokens(u.completionTokens)})`,
    );
  };
  add("Session", report.session);
  add("Today", report.today);
  add("Month", report.month);
  add("All time", report.allTime);
  return lines.join("\n");
}
