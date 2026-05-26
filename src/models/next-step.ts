import type { KimiConfig } from "../config.js";
import { isUnifiedEligible, type ModelEntry } from "./registry.js";

export type NextStep =
  | { kind: "ready" }
  | { kind: "needs-gateway" }
  | { kind: "billing-choice" }
  | { kind: "needs-key" };

/**
 * Decide what (if anything) we need to ask the user after they pick a model.
 *
 *   ready          — no further setup; can chat right now.
 *   needs-gateway  — non-Workers-AI model but no aiGatewayId configured.
 *   billing-choice — provider supports Unified Billing AND we don't have a key or unified-on yet.
 *                    User picks: pay-via-CF-credits OR paste-own-key.
 *   needs-key      — BYOK-only provider (e.g. DeepSeek) with no stored key/alias.
 */
export function decideNextStep(cfg: KimiConfig | null, model: ModelEntry): NextStep {
  if (model.provider === "workers-ai") return { kind: "ready" };
  if (!cfg) return { kind: "ready" };
  if (!cfg.aiGatewayId) return { kind: "needs-gateway" };

  const providerKey = model.provider as "anthropic" | "openai" | "google" | "openai-compatible";
  const hasKey = !!cfg.providerKeys?.[providerKey];
  const hasAlias = !!cfg.providerKeyAliases?.[providerKey];
  const usingUnified = !!cfg.unifiedBilling;

  if (hasKey || hasAlias || usingUnified) return { kind: "ready" };
  if (isUnifiedEligible(model)) return { kind: "billing-choice" };
  return { kind: "needs-key" };
}
