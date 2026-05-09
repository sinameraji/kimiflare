import { loadConfig, saveConfig, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, type KimiConfig } from "../config.js";
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

  if (!merged.accountId || !merged.apiToken) {
    throw new Error(
      "kimiflare SDK: missing credentials. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, " +
        "or provide them in config.",
    );
  }

  return merged;
}
