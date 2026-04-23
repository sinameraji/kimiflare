/**
 * Cloudflare Workers AI pricing for @cf/moonshotai/kimi-k2.6
 * Source: https://developers.cloudflare.com/workers-ai/platform/pricing/
 *
 * Workers AI bills in Neurons ($0.011 / 1,000 Neurons).
 * The token prices below are the equivalent per-token rates.
 */

/** Price per million uncached input tokens (USD) */
export const PRICE_IN_PER_M = 0.95;

/** Price per million cached input tokens (USD) */
export const PRICE_IN_CACHED_PER_M = 0.16;

/** Price per million output tokens (USD) */
export const PRICE_OUT_PER_M = 4.0;

export interface CostBreakdown {
  uncachedIn: number;
  cachedIn: number;
  out: number;
  total: number;
}

export function calculateCost(
  promptTokens: number,
  completionTokens: number,
  cachedTokens = 0,
): CostBreakdown {
  const uncachedIn = Math.max(0, promptTokens - cachedTokens);
  const cachedIn = cachedTokens;
  const out = completionTokens;
  const total =
    (uncachedIn * PRICE_IN_PER_M) / 1_000_000 +
    (cachedIn * PRICE_IN_CACHED_PER_M) / 1_000_000 +
    (out * PRICE_OUT_PER_M) / 1_000_000;
  return { uncachedIn, cachedIn, out, total };
}
