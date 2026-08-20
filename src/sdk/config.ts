import { loadConfig, saveConfig, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, type KimiConfig } from "../config.js";
import { resolveCustomEndpoint } from "../agent/custom-endpoint.js";
import type { CreateSessionOptions } from "./types.js";

export { loadConfig, saveConfig, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT };
export type { KimiConfig };

export async function resolveSdkConfig(opts: CreateSessionOptions): Promise<KimiConfig> {
  const loaded = await loadConfig();
  const merged: KimiConfig = {
    accountId: "",
    apiToken: "",
    model: DEFAULT_MODEL,
    ...loaded,
    ...opts.config,
  };

  // Cloudflare credentials are only required when no custom OpenAI-compatible
  // endpoint is configured (KIMIFLARE_BASE_URL / config baseUrl) — with one,
  // the host's gateway owns routing and auth and no Cloudflare API is called.
  if ((!merged.accountId || !merged.apiToken) && !resolveCustomEndpoint(merged)) {
    throw new Error(
      "kimiflare SDK: missing credentials. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, " +
        "set KIMIFLARE_BASE_URL (+ KIMIFLARE_API_KEY) for a custom OpenAI-compatible endpoint, " +
        "or provide them in config.",
    );
  }

  return merged;
}
