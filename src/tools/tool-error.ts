/**
 * Structured tool error (OP-12 / M2.1). A thin envelope around `Error`
 * that carries a stable `code`, a `recoverable` flag the loop can read
 * to decide retry vs. fail-fast, and an optional `suggestion` the UI
 * can surface as a hint.
 *
 * The migration plan is gradual:
 *   - Tools that already throw plain `Error` keep working (the executor
 *     wraps them as `{ code: "UNKNOWN", recoverable: false }`).
 *   - Sites that have meaningful classification (MCP / LSP timeouts,
 *     abort, permission, invalid args) throw `ToolError` directly.
 *   - Downstream consumers (the loop, hooks added in M6.1, the UI) read
 *     the typed fields off `ToolResult.errorCode` / `recoverable` /
 *     `suggestion` once they're ready to act on them.
 *
 * No behavior change in this PR — the loop does not yet act on
 * `recoverable`. That decision lands with the retry-policy work it
 * unblocks (tracked separately).
 */

/**
 * Stable codes for the common failure modes. New codes can be added
 * over time; downstream consumers should default-handle unknown codes
 * as fatal/unrecoverable. Use lowercase snake_case for code names.
 */
export type ToolErrorCode =
  /** A request to an external service (MCP server, LSP server, HTTP
   *  fetch, …) exceeded its allowed time budget. Typically retryable. */
  | "timeout"
  /** The user (or a parent abort signal) cancelled the call. Never
   *  retry — the user explicitly stopped. */
  | "aborted"
  /** The tool was invoked with bad arguments — the call would always
   *  fail with the same input. Not retryable as-is; the model needs to
   *  reformulate. */
  | "invalid_args"
  /** Permission for the tool was denied by the user or by mode. Not
   *  retryable; the model should pick a different tool. */
  | "permission_denied"
  /** A transient external failure (network blip, 503, EAGAIN, …) that
   *  is reasonable to retry once. */
  | "transient_failure"
  /** The thing the tool was asked to operate on doesn't exist
   *  (file, URL, MCP server). Not retryable. */
  | "not_found"
  /** A guard rejected the call (sandbox policy, size cap, …). Not
   *  retryable. */
  | "policy_rejection"
  /** Catch-all for errors with no obvious classification. Not retryable
   *  by default. */
  | "unknown";

export interface ToolErrorOptions {
  code: ToolErrorCode;
  message: string;
  /** True if a retry is reasonable. The loop reads this to choose
   *  between retry-with-backoff and surfacing the error to the model.
   *  Defaults derived from `code` if omitted: timeout/transient → true,
   *  everything else → false. */
  recoverable?: boolean;
  /** Optional one-line hint the UI can render alongside the error.
   *  Should NOT include the original error message — that's already in
   *  `message`. Example: "try shortening the prompt" or "the LSP server
   *  for typescript has crashed — try /lsp restart". */
  suggestion?: string;
  /** Original error to wrap, if any. Preserved as `cause` for stack
   *  traces while the `ToolError` itself carries the classification. */
  cause?: unknown;
}

const RECOVERABLE_DEFAULT: Record<ToolErrorCode, boolean> = {
  timeout: true,
  aborted: false,
  invalid_args: false,
  permission_denied: false,
  transient_failure: true,
  not_found: false,
  policy_rejection: false,
  unknown: false,
};

/**
 * Thrown by a tool's `run` to signal a classified failure. The executor
 * catches it and lifts `code`, `recoverable`, `suggestion` onto the
 * `ToolResult`. Throwing a plain `Error` from a tool still works — the
 * executor wraps it as `{ code: "unknown", recoverable: false }`.
 */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly recoverable: boolean;
  readonly suggestion?: string;

  constructor(opts: ToolErrorOptions) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ToolError";
    this.code = opts.code;
    this.recoverable = opts.recoverable ?? RECOVERABLE_DEFAULT[opts.code];
    this.suggestion = opts.suggestion;
  }
}

/** Type guard. Cheaper + safer than `instanceof` across module boundaries. */
export function isToolError(e: unknown): e is ToolError {
  return (
    e instanceof Error &&
    e.name === "ToolError" &&
    typeof (e as { code?: unknown }).code === "string"
  );
}

// ── Factory helpers for common cases ─────────────────────────────────────

export function toolTimeoutError(label: string, ms: number, cause?: unknown): ToolError {
  return new ToolError({
    code: "timeout",
    message: `${label} timed out after ${ms}ms`,
    suggestion:
      "the external service was slow to respond — retry, or try a smaller request",
    cause,
  });
}

export function toolAbortError(label: string, cause?: unknown): ToolError {
  return new ToolError({
    code: "aborted",
    message: `${label} was cancelled`,
    cause,
  });
}

export function toolInvalidArgsError(message: string, suggestion?: string): ToolError {
  return new ToolError({
    code: "invalid_args",
    message,
    suggestion,
  });
}

export function toolNotFoundError(message: string, suggestion?: string): ToolError {
  return new ToolError({
    code: "not_found",
    message,
    suggestion,
  });
}

/** Coerce any thrown value into a `ToolError`. Pass-through for instances;
 *  wraps plain `Error` and primitives. Used by the executor's catch block
 *  so downstream code can always reason in terms of `ToolError`. */
export function wrapAsToolError(e: unknown): ToolError {
  if (isToolError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new ToolError({
    code: "unknown",
    message,
    recoverable: false,
    cause: e,
  });
}
