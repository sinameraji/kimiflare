/**
 * Model registry: single source of truth for per-model capabilities, pricing,
 * and routing decisions across providers reachable via Cloudflare AI Gateway.
 *
 * Routing taxonomy:
 *   - "workers-ai": @cf/* models on Cloudflare Workers AI. Reached either
 *     directly (api.cloudflare.com/.../ai/run/<model>) or via the Workers AI
 *     namespace on AI Gateway (/v1/{acct}/{gw}/workers-ai/<model>).
 *   - "anthropic" | "openai" | "google" | "openai-compatible": reached through
 *     the AI Gateway Universal Endpoint (/v1/{acct}/{gw}/compat/chat/completions)
 *     which accepts an OpenAI chat-completions payload with a "<provider>/<id>"
 *     model field and translates per-provider request/response shapes.
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
  /** Canonical model id, e.g. "@cf/moonshotai/kimi-k2.6", "anthropic/claude-sonnet-4-7", "openai/gpt-5". */
  id: string;
  provider: ModelProvider;
  contextWindow: number;
  maxOutputTokens: number;
  pricing: ModelPricing;
  supports: ModelCapabilities;
  /**
   * "unified" — Cloudflare's Unified Billing can pay this provider on the user's behalf.
   * "byok"    — user must supply their own provider API key (sent via cf-aig-authorization).
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
  // ── Workers AI (Cloudflare-hosted, native to kimiflare) ───────────────────
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
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    provider: "workers-ai",
    contextWindow: 24_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMtok: 0.29, outputPerMtok: 2.25 },
    supports: { tools: true, reasoning: false, streaming: true },
    billingMode: "unified",
  },
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    provider: "workers-ai",
    contextWindow: 131_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMtok: 0.27, outputPerMtok: 0.85 },
    supports: { tools: true, reasoning: false, streaming: true },
    billingMode: "unified",
  },

  // ── Anthropic (via Gateway Universal Endpoint) ────────────────────────────
  {
    id: "anthropic/claude-opus-4-7",
    provider: "anthropic",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
    pricing: { inputPerMtok: 15.0, cachedInputPerMtok: 1.5, outputPerMtok: 75.0 },
    supports: { tools: true, reasoning: true, streaming: true, temperature: false },
    billingMode: "byok",
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    provider: "anthropic",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
    pricing: { inputPerMtok: 3.0, cachedInputPerMtok: 0.3, outputPerMtok: 15.0 },
    supports: { tools: true, reasoning: true, streaming: true },
    billingMode: "byok",
  },
  {
    id: "anthropic/claude-haiku-4-5",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    pricing: { inputPerMtok: 1.0, cachedInputPerMtok: 0.1, outputPerMtok: 5.0 },
    supports: { tools: true, reasoning: false, streaming: true },
    billingMode: "byok",
  },

  // ── OpenAI (via Gateway Universal Endpoint) ───────────────────────────────
  {
    id: "openai/gpt-5",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMtok: 5.0, cachedInputPerMtok: 0.5, outputPerMtok: 20.0 },
    supports: { tools: true, reasoning: true, streaming: true, temperature: false },
    billingMode: "byok",
  },
  {
    id: "openai/gpt-5-mini",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMtok: 0.25, cachedInputPerMtok: 0.025, outputPerMtok: 2.0 },
    supports: { tools: true, reasoning: true, streaming: true, temperature: false },
    billingMode: "byok",
  },

  // ── Google (via Gateway Universal Endpoint) ───────────────────────────────
  {
    id: "google-ai-studio/gemini-2.5-pro",
    provider: "google",
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMtok: 1.25, outputPerMtok: 10.0 },
    supports: { tools: true, reasoning: true, streaming: true },
    billingMode: "byok",
  },
  {
    id: "google-ai-studio/gemini-2.5-flash",
    provider: "google",
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMtok: 0.075, outputPerMtok: 0.3 },
    supports: { tools: true, reasoning: false, streaming: true },
    billingMode: "byok",
  },

  // ── Other OpenAI-compatible providers via Gateway ─────────────────────────
  {
    id: "groq/llama-3.3-70b-versatile",
    provider: "openai-compatible",
    contextWindow: 128_000,
    maxOutputTokens: 8_000,
    pricing: { inputPerMtok: 0.59, outputPerMtok: 0.79 },
    supports: { tools: true, reasoning: false, streaming: true },
    billingMode: "byok",
  },
  // NOTE: DeepSeek is intentionally NOT seeded yet.
  // Our `providerKeys` schema has a single "openai-compatible" slot shared by
  // every upstream in this category — so a stored Groq key would be sent to
  // DeepSeek (and rejected with HTTP 401 "Authentication Fails (governor)").
  // Add DeepSeek back once providerKeys is per-upstream (groq/deepseek/...)
  // instead of per-provider-category.
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
