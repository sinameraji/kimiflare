/**
 * Model registry: single source of truth for per-model capabilities, pricing,
 * and routing decisions.
 *
 * KimiFlare is built around Kimi models served through Cloudflare Workers AI.
 * All seeded models are Workers AI models. AI Gateway is optional — when
 * configured it provides observability, caching, and unified billing for
 * multi-provider setups, but Workers AI models work fine without it via the
 * direct api.cloudflare.com path.
 *
 * Routing taxonomy:
 *   - Workers AI chat models go through EITHER:
 *     a) Direct path:  api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}
 *     b) Gateway path: gateway.ai.cloudflare.com/v1/{acct}/{gw}/compat/chat/completions
 *     The choice is made at runtime based on whether aiGatewayId is configured.
 *   - Embeddings use the same dual-path logic:
 *     a) Direct:  api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}
 *     b) Gateway: gateway.ai.cloudflare.com/v1/{acct}/{gw}/workers-ai/{model}
 *   - User-registered models (via ~/.kimiflare/models.json) can be any provider,
 *     but they require AI Gateway since only Workers AI has a direct path.
 */

export type ModelProvider =
  | "workers-ai"
  | "anthropic"
  | "openai"
  | "google"
  | "openai-compatible";

export type BillingMode = "unified" | "byok";

export interface ModelPricing {
  /** USD per million uncached input tokens. */
  inputPerMtok: number;
  /** USD per million cached input tokens. Omit if provider does not bill cached input differently. */
  cachedInputPerMtok?: number;
  /** USD per million output tokens. */
  outputPerMtok: number;
}

export interface ModelCapabilities {
  tools: boolean;
  reasoning: boolean;
  streaming: boolean;
  /**
   * Does this model accept the `temperature` field in the request body?
   * Reasoning models from OpenAI (gpt-5 family) and Anthropic (opus-4-7)
   * reject or deprecate it. Default: true.
   */
  temperature?: boolean;
}

export interface ModelEntry {
  /** Canonical model id, e.g. "@cf/moonshotai/kimi-k2.6". */
  id: string;
  provider: ModelProvider;
  contextWindow: number;
  maxOutputTokens: number;
  pricing: ModelPricing;
  supports: ModelCapabilities;
  /**
   * "unified" — Cloudflare's Unified Billing can pay this provider on the user's behalf.
   * "byok"    — user must supply their own provider API key.
   * Note: "unified" availability is provider/gateway-specific; "byok" always works.
   */
  billingMode: BillingMode;
}

/**
 * Providers Cloudflare AI Gateway supports paying for via Unified Billing
 * (CF credits, no upstream key). Workers AI is its own track and trivially
 * "ready" for any account that can reach AI Gateway at all.
 * Source: developers.cloudflare.com/ai-gateway/features/unified-billing/
 */
const UNIFIED_BILLING_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "openai",
  "google-ai-studio",
  "groq",
  "xai",
]);

/** True when the user can pay for this model through Cloudflare credits rather than BYOK. */
export function isUnifiedEligible(entry: ModelEntry): boolean {
  if (entry.provider === "workers-ai") return false; // own billing track
  // For openai-compatible upstreams we key off the model-id prefix
  // (e.g. "groq/llama-3.3-70b-versatile" → "groq").
  const slashIdx = entry.id.indexOf("/");
  if (slashIdx < 0) return false;
  const upstream = entry.id.slice(0, slashIdx).toLowerCase();
  return UNIFIED_BILLING_PROVIDERS.has(upstream);
}

const SEED: ModelEntry[] = [
  // ── Kimi models (Cloudflare Workers AI, native to kimiflare) ──────────────
  {
    id: "@cf/moonshotai/kimi-k2.6",
    provider: "workers-ai",
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    pricing: { inputPerMtok: 0.95, cachedInputPerMtok: 0.16, outputPerMtok: 4.0 },
    supports: { tools: true, reasoning: true, streaming: true },
    billingMode: "unified",
  },
  {
    id: "@cf/moonshotai/kimi-k2.5",
    provider: "workers-ai",
    contextWindow: 262_144,
    maxOutputTokens: 16_384,
    pricing: { inputPerMtok: 0.55, cachedInputPerMtok: 0.11, outputPerMtok: 2.19 },
    supports: { tools: true, reasoning: true, streaming: true },
    billingMode: "unified",
  },
];

const seedIndex = new Map<string, ModelEntry>(SEED.map((m) => [m.id, m]));
let userOverrides: Map<string, ModelEntry> = new Map();

/** Register or replace entries from a user-supplied config (e.g. ~/.kimiflare/models.json). */
export function registerUserModels(entries: ModelEntry[]): void {
  userOverrides = new Map(entries.map((m) => [m.id, m]));
}

/** Look up a model by id. Returns undefined for unknown models. */
export function getModel(id: string): ModelEntry | undefined {
  return userOverrides.get(id) ?? seedIndex.get(id);
}

/** Look up a model, falling back to a generic entry inferred from the id prefix. */
export function getModelOrInfer(id: string): ModelEntry {
  const hit = getModel(id);
  if (hit) return hit;
  const provider = inferProvider(id);
  // Conservative defaults for unknown models — context/output kept small so
  // the harness errs on the side of compaction rather than wasted prompt tokens.
  return {
    id,
    provider,
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMtok: 0, outputPerMtok: 0 },
    supports: { tools: true, reasoning: false, streaming: true },
    billingMode: provider === "workers-ai" ? "unified" : "byok",
  };
}

export function inferProvider(id: string): ModelProvider {
  if (id.startsWith("@cf/")) return "workers-ai";
  if (id.startsWith("anthropic/")) return "anthropic";
  if (id.startsWith("openai/")) return "openai";
  if (id.startsWith("google-ai-studio/") || id.startsWith("google/")) return "google";
  return "openai-compatible";
}

export function listModels(): ModelEntry[] {
  const out = new Map(seedIndex);
  for (const [k, v] of userOverrides) out.set(k, v);
  return [...out.values()];
}
