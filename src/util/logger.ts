/**
 * Structured logger for KimiFlare turn lifecycle events.
 * Writes JSON lines to stderr so stdout remains clean for TUI.
 *
 * Logging is OFF by default. To enable, set the env var:
 *   KIMIFLARE_LOG_LEVEL=info npm run dev
 *
 * Tail in a second terminal to observe real-time behavior:
 *   npm run dev 2>&1 | jq -r 'select(.event | startswith("turn:"))'
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "off";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  sessionId?: string;
  requestId?: string;
  data?: Record<string, unknown>;
}

let globalMinLevel: LogLevel = (process.env.KIMIFLARE_LOG_LEVEL as LogLevel) ?? "off";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  off: 4,
};

/** In-memory circular buffer of recent log entries for error reporting.
 *  Captures all entries regardless of KIMIFLARE_LOG_LEVEL so that
 *  diagnostic context is available even when stderr logging is off. */
const RECENT_LOGS_MAX = 100;
const recentLogs: LogEntry[] = [];

export function getRecentLogs(limit = 50): LogEntry[] {
  return recentLogs.slice(-limit);
}

export function clearRecentLogs(): void {
  recentLogs.length = 0;
}

export function setLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalMinLevel;
}

export function log(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    data,
  };

  // Always buffer for diagnostic reporting
  recentLogs.push(entry);
  if (recentLogs.length > RECENT_LOGS_MAX) {
    recentLogs.shift();
  }

  // Write to stderr so stdout remains clean for TUI rendering
  if (LEVEL_ORDER[level] >= LEVEL_ORDER[globalMinLevel]) {
    console.error(JSON.stringify(entry));
  }
}

/** Convenience wrappers */
export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => log("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) => log("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => log("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => log("error", event, data),
};
