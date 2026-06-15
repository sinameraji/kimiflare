/**
 * Error report sender — posts diagnostic reports to the KimiFlare Cloud
 * API so they can be forwarded to Discord for triage.
 */

import { getRecentLogs, type LogEntry } from "../util/logger.js";
import { getAppVersion } from "../util/version.js";
import { detectKillSwitch } from "../util/errors.js";

const REPORT_URL = "https://api.kimiflare.com/v1/report";

export interface ReportPayload {
  error: {
    message: string;
    code?: number;
    http_status?: number;
  };
  context: {
    command?: string;
    model?: string;
    session_id?: string;
    request_id?: string;
    tool_calls?: string[];
  };
  user_message?: string;
  metadata: {
    version: string;
    platform: string;
    node_version: string;
    cloud_mode: boolean;
  };
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
  requestId?: string;
  model?: string;
  userNote?: string;
  cloudMode?: boolean;
}): ReportPayload {
  return {
    error: {
      message: opts.errorMessage,
      code: opts.errorCode,
      http_status: opts.httpStatus,
    },
    context: {
      command: "/report",
      model: opts.model,
      session_id: opts.sessionId,
      request_id: opts.requestId,
    },
    user_message: opts.userNote,
    metadata: {
      version: getAppVersion(),
      platform: `${process.platform} ${process.arch}`,
      node_version: process.version,
      cloud_mode: opts.cloudMode ?? false,
    },
  };
}

/**
 * Send a report to the KimiFlare Cloud API.
 * The endpoint validates the token and forwards the report to Discord.
 */
export async function sendReport(payload: ReportPayload, token?: string): Promise<ReportResult> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const res = await fetch(REPORT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    await detectKillSwitch(res);

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
