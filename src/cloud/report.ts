/**
 * Error report sender — posts diagnostic reports to the KimiFlare Cloud
 * feedback endpoint so they can be forwarded to Discord for triage.
 */

import { getRecentLogs, type LogEntry } from "../util/logger.js";
import { getAppVersion } from "../util/version.js";

const FEEDBACK_REPORT_URL = "https://hello.kimiflare.com/report";

export interface ReportPayload {
  /** Random report ID */
  reportId: string;
  /** KimiFlare version */
  version: string;
  /** Platform info */
  platform: string;
  /** Node.js version */
  nodeVersion: string;
  /** Session ID if available */
  sessionId?: string;
  /** The error message shown to the user */
  errorMessage: string;
  /** HTTP status if applicable */
  httpStatus?: number;
  /** Cloudflare error code if applicable */
  errorCode?: number;
  /** Recent log entries (last N) */
  recentLogs: LogEntry[];
  /** Optional user-provided context */
  userNote?: string;
}

export interface ReportResult {
  ok: boolean;
  message: string;
}

/**
 * Build a report payload from the current session state.
 */
export function buildReport(opts: {
  errorMessage: string;
  httpStatus?: number;
  errorCode?: number;
  sessionId?: string;
  userNote?: string;
}): ReportPayload {
  return {
    reportId: crypto.randomUUID(),
    version: getAppVersion(),
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    sessionId: opts.sessionId,
    errorMessage: opts.errorMessage,
    httpStatus: opts.httpStatus,
    errorCode: opts.errorCode,
    recentLogs: getRecentLogs(50),
    userNote: opts.userNote,
  };
}

/**
 * Send a report to the KimiFlare Cloud feedback endpoint.
 * The endpoint validates the payload and forwards it to Discord.
 */
export async function sendReport(payload: ReportPayload): Promise<ReportResult> {
  try {
    const res = await fetch(FEEDBACK_REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      return { ok: true, message: "Report sent. Thanks for helping improve KimiFlare!" };
    }

    const body = await res.text().catch(() => "unknown error");
    return { ok: false, message: `Failed to send report (${res.status}): ${body}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Failed to send report: ${msg}` };
  }
}
