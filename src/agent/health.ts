/**
 * Session health diagnosis (M7.1 — Tier 1).
 *
 * Long sessions slow exponentially. The dominant cause is cache hit rate
 * collapse as the prompt prefix drifts; secondary causes are prefill
 * cost from larger prompts and reasoning × input scaling. We already
 * collect every signal we need (`durationMs`, `cacheDiagnostics`,
 * `promptTotalApproxTokens`) per turn via cost-debug — this module
 * computes a diagnosis at turn end and stashes a one-line nudge that
 * the *next* turn injects into its conversation.
 *
 * The agent sees the nudge as a regular user-role message. The model
 * can then make its own call about whether to delegate the next task
 * to a fresh-context subagent. We never auto-shed context — only
 * surface the diagnosis. Quality regressions become impossible to make
 * invisibly, per the guardrail in the design doc.
 *
 * See `docs/plans/m7-subagent-primitive.md` §"Session health (Tier 1)".
 */
import { logger } from "../util/logger.js";

export type Tier = "light" | "medium" | "heavy";

export type HealthDiagnosis = "healthy" | "context_bloat" | "cache_collapse";

export interface TurnHealthSignals {
  sessionId: string;
  tier?: Tier;
  durationMs: number;
  promptTokens: number;
  cacheHitRatio: number;
}

export interface TurnHealth {
  diagnosis: HealthDiagnosis;
  /** Rolling p50 (≈ median) duration we'd expect for this tier in this
   *  session. Defaults to a tier-typical fallback when we don't yet
   *  have at least 3 prior turns of data. */
  expectedMs: number;
  /** Ratio of `signals.durationMs` to `expectedMs`. */
  durationRatio: number;
  /** The hint text (or null if healthy). */
  hint: string | null;
}

const TIER_DEFAULT_EXPECTED_MS: Record<Tier, number> = {
  light: 3_000,
  medium: 8_000,
  heavy: 20_000,
};

const PROMPT_BLOAT_THRESHOLD = 100_000;
const CACHE_LOW_THRESHOLD = 0.5;
const CACHE_HIGH_PREV_THRESHOLD = 0.7;
const SLOWDOWN_RATIO_THRESHOLD = 3.0;
const BASELINE_WINDOW = 10;
const MIN_BASELINE_SAMPLES = 3;

/** sessionId → tier → recent durations (most-recent last, capped at BASELINE_WINDOW). */
const rollingBaselines = new Map<string, Map<Tier, number[]>>();

/** sessionId → most-recent cacheHitRatio (for detecting collapse). */
const lastCacheRatios = new Map<string, number>();

/** sessionId → pending hint string to inject into the next turn. */
const pendingHints = new Map<string, string>();

export function _resetHealthForTests(): void {
  rollingBaselines.clear();
  lastCacheRatios.clear();
  pendingHints.clear();
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return sorted[mid]!;
}

function getRollingForSession(sessionId: string): Map<Tier, number[]> {
  let m = rollingBaselines.get(sessionId);
  if (!m) {
    m = new Map();
    rollingBaselines.set(sessionId, m);
  }
  return m;
}

/**
 * Called at turn end. Records the turn's duration into the rolling
 * baseline, produces a diagnosis, and (when non-healthy) stashes a hint
 * that the next turn will inject. Returns the diagnosis so callers can
 * also surface it via a UI callback (e.g. onWarning).
 */
export function recordTurnHealth(signals: TurnHealthSignals): TurnHealth {
  const tier: Tier = signals.tier ?? "medium";
  const key = signals.sessionId;

  const tierMap = getRollingForSession(key);
  const samples = tierMap.get(tier) ?? [];
  const expectedMs =
    samples.length >= MIN_BASELINE_SAMPLES ? median(samples) : TIER_DEFAULT_EXPECTED_MS[tier];
  const durationRatio = expectedMs > 0 ? signals.durationMs / expectedMs : 1;

  // Record the new sample (after computing the baseline so the current
  // turn isn't self-comparing).
  samples.push(signals.durationMs);
  while (samples.length > BASELINE_WINDOW) samples.shift();
  tierMap.set(tier, samples);

  const prevCache = lastCacheRatios.get(key);
  lastCacheRatios.set(key, signals.cacheHitRatio);

  // Diagnosis precedence: cache_collapse > context_bloat > healthy.
  // A cache collapse is the leading indicator of context bloat anyway;
  // surfacing it first gives the user/model the actionable signal.
  let diagnosis: HealthDiagnosis = "healthy";
  let hint: string | null = null;

  if (
    signals.cacheHitRatio < CACHE_LOW_THRESHOLD &&
    prevCache !== undefined &&
    prevCache > CACHE_HIGH_PREV_THRESHOLD
  ) {
    diagnosis = "cache_collapse";
    hint =
      `Session health: cache hit ratio dropped from ${Math.round(prevCache * 100)}% to ${Math.round(signals.cacheHitRatio * 100)}% ` +
      `on the last turn — the prompt prefix is no longer reused. If the next task is small and self-contained, ` +
      `consider delegating it to an Agent(explore) subagent so it runs with a fresh, cache-friendly context.`;
  } else if (
    signals.promptTokens > PROMPT_BLOAT_THRESHOLD &&
    durationRatio > SLOWDOWN_RATIO_THRESHOLD
  ) {
    diagnosis = "context_bloat";
    hint =
      `Session health: prompt is now ${Math.round(signals.promptTokens / 1000)}k tokens and the last turn ran ` +
      `~${durationRatio.toFixed(1)}× slower than the baseline for this tier. Heavy work is fine to keep in the ` +
      `main thread, but light/medium tasks can be delegated to an Agent subagent for speed.`;
  }

  if (hint) {
    pendingHints.set(key, hint);
  }

  logger.debug("health.recordTurn", {
    sessionId: key,
    tier,
    durationMs: signals.durationMs,
    expectedMs,
    durationRatio: Number(durationRatio.toFixed(2)),
    promptTokens: signals.promptTokens,
    cacheHitRatio: Number(signals.cacheHitRatio.toFixed(2)),
    diagnosis,
  });

  return { diagnosis, expectedMs, durationRatio, hint };
}

/**
 * Called at turn start. Returns the pending hint for this session
 * (or null) and clears it — single-shot per occurrence so a stale
 * health note doesn't keep firing on subsequent turns.
 */
export function consumePendingHealthHint(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  const hint = pendingHints.get(sessionId);
  if (!hint) return null;
  pendingHints.delete(sessionId);
  return hint;
}
