/**
 * Structured logger for KimiFlare turn lifecycle events.
 * Writes JSON lines to stderr so stdout remains clean for TUI.
 * Tail in a second terminal to observe real-time behavior:
 *
 *   npm run dev 2>&1 | jq -r 'select(.event | startswith("turn:"))'
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  sessionId?: string;
  requestId?: string;
  data?: Record<string, unknown>;
}

let globalMinLevel: LogLevel = (process.env.KIMIFLARE_LOG_LEVEL as LogLevel) ?? "info";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

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
  if (LEVEL_ORDER[level] < LEVEL_ORDER[globalMinLevel]) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    data,
  };

  // Write to stderr so stdout remains clean for TUI rendering
  console.error(JSON.stringify(entry));
}

/** Convenience wrappers */
export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => log("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) => log("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => log("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => log("error", event, data),
};
