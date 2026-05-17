export class KimiApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "KimiApiError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export class KillSwitchError extends Error {
  endedAt: string | undefined;
  constructor(endedAt?: string) {
    super("SERVICE_ENDED");
    this.name = "KillSwitchError";
    this.endedAt = endedAt;
  }
}

export function isKillSwitchError(err: unknown): err is KillSwitchError {
  return err instanceof KillSwitchError;
}

/** Detect the cloud kill-switch response (503 + {error: "SERVICE_ENDED"}).
 *  Call this immediately after fetch() and before checking res.ok.
 *  Throws KillSwitchError when matched; otherwise returns silently. */
export async function detectKillSwitch(res: Response): Promise<void> {
  if (res.status === 503) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (data.error === "SERVICE_ENDED") {
      throw new KillSwitchError(typeof data.ended_at === "string" ? data.ended_at : undefined);
    }
  }
}

export function isCloudQuotaExhaustedError(err: unknown): err is KimiApiError {
  return (
    err instanceof KimiApiError &&
    err.httpStatus === 429 &&
    /token quota exhausted/i.test(err.message)
  );
}

/** Map known Cloudflare Workers AI / Gateway error codes to human-readable,
 *  actionable messages. Falls back to the original message with JSON stripped. */
export function humanizeCloudflareError(err: KimiApiError): string {
  const { code, httpStatus, message } = err;

  // If we already threw a friendly multi-line "kimiflare: …" message from the
  // client (e.g. missing provider key, missing AI Gateway), pass it through
  // verbatim instead of clobbering it with the generic 401/400 template.
  if (message.startsWith("kimiflare: ")) {
    return message.slice("kimiflare: ".length);
  }

  // Cloudflare-specific error codes
  if (code === 3040) {
    return "Cloudflare Workers AI is at capacity (code: 3040). Please wait a moment and try again.";
  }

  // HTTP-status-based buckets
  if (httpStatus === 429) {
    const codeStr = code !== undefined ? ` (code: ${code})` : "";
    return `Rate limit hit${codeStr}. Please wait a moment and try again.`;
  }

  if (httpStatus === 403 || code === 10000) {
    const codeStr = code !== undefined ? ` (code: ${code})` : "";
    return (
      `Authentication failed${codeStr}. Check that your Cloudflare API token has the 'Workers AI' permission.\n` +
      "Get a new token: https://dash.cloudflare.com/profile/api-tokens"
    );
  }

  if (httpStatus === 401) {
    const codeStr = code !== undefined ? ` (code: ${code})` : "";
    return (
      `Authentication required${codeStr}. Please check your API token or run \`kimiflare auth cloud\` if using cloud mode.`
    );
  }

  if (httpStatus === 400) {
    const codeStr = code !== undefined ? ` (code: ${code})` : "";
    if (message.includes("invalid escaped character")) {
      return `API rejected request${codeStr} (invalid JSON in conversation history). Run /clear to reset if it persists.`;
    }
    if (message.includes("Invalid model ID")) {
      return message; // already human-friendly
    }
    return `Bad request${codeStr}. The conversation may be too long or contain invalid characters. Run /compact or /clear.`;
  }

  if (httpStatus && httpStatus >= 500) {
    const codeStr = code !== undefined ? ` (code: ${code})` : "";
    return `Cloudflare servers are experiencing issues${codeStr}. Please wait a moment and try again.`;
  }

  // Fallback: strip any embedded JSON so we don't dump raw objects to the user
  return message.replace(/\{[\s\S]*?\}/g, "(see logs for details)");
}
