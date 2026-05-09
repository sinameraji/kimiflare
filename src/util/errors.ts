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

  // Cloudflare-specific error codes
  if (code === 3040) {
    return "Cloudflare Workers AI is at capacity. Retrying automatically…";
  }

  // HTTP-status-based buckets
  if (httpStatus === 429) {
    return "Rate limit hit. Please wait a moment and try again.";
  }

  if (httpStatus === 403 || code === 10000) {
    return (
      "Authentication failed. Check that your Cloudflare API token has the 'Workers AI' permission.\n" +
      "Get a new token: https://dash.cloudflare.com/profile/api-tokens"
    );
  }

  if (httpStatus === 401) {
    return (
      "Authentication required. Please check your API token or run `kimiflare auth cloud` if using cloud mode."
    );
  }

  if (httpStatus === 400) {
    if (message.includes("invalid escaped character")) {
      return "API rejected request (invalid JSON in conversation history). Run /clear to reset if it persists.";
    }
    if (message.includes("Invalid model ID")) {
      return message; // already human-friendly
    }
    return "Bad request. The conversation may be too long or contain invalid characters. Run /compact or /clear.";
  }

  if (httpStatus && httpStatus >= 500) {
    return "Cloudflare servers are experiencing issues. Retrying automatically…";
  }

  // Fallback: strip any embedded JSON so we don't dump raw objects to the user
  return message.replace(/\{[\s\S]*?\}/g, "(see logs for details)");
}
