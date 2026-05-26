/**
 * Cloudflare Secrets Store helper — used by kimi-code's fire-and-forget BYOK
 * flow. The provider key is pushed to a CF Secrets Store with scope "ai_gateway"
 * and never lives on the user's disk; subsequent gateway requests reference it
 * by alias via the cf-aig-byok-alias header.
 *
 * Docs: https://developers.cloudflare.com/api/resources/secrets_store/
 *       https://developers.cloudflare.com/changelog/2025-08-25-secrets-store-ai-gateway/
 */

import { getUserAgent } from "../util/version.js";

const CF_API = "https://api.cloudflare.com/client/v4";
const STORE_NAME = "kimi-code";

export type SecretsStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "forbidden" | "network" | "other"; message: string };

interface CfEnvelope<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

function cfHeaders(apiToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
    "User-Agent": getUserAgent(),
  };
}

async function cfFetch<T>(
  url: string,
  init: { method: "GET" | "POST" | "DELETE"; apiToken: string; body?: unknown },
): Promise<SecretsStoreResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: cfHeaders(init.apiToken),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "network", message: msg };
  }

  const text = await res.text();
  let parsed: CfEnvelope<T> | null = null;
  try {
    parsed = JSON.parse(text) as CfEnvelope<T>;
  } catch {
    // Non-JSON response (e.g. HTML error page). Fall through with the raw text.
  }

  if (!res.ok || parsed?.success === false) {
    const apiMsg = parsed?.errors?.[0]?.message ?? text.slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "forbidden", message: apiMsg };
    }
    return { ok: false, reason: "other", message: `HTTP ${res.status}: ${apiMsg}` };
  }

  if (!parsed || parsed.result === undefined) {
    return { ok: false, reason: "other", message: "Cloudflare returned no result body" };
  }
  return { ok: true, value: parsed.result };
}

interface CfStore {
  id: string;
  name: string;
}

/**
 * Find the kimi-code Secrets Store on the account, or create one if it doesn't
 * exist. Returns the store id (which the caller should persist as
 * cfg.secretsStoreId so this lookup only happens once per machine).
 */
export async function ensureStore(
  accountId: string,
  apiToken: string,
): Promise<SecretsStoreResult<string>> {
  const listed = await cfFetch<CfStore[]>(
    `${CF_API}/accounts/${encodeURIComponent(accountId)}/secrets_store/stores`,
    { method: "GET", apiToken },
  );
  if (!listed.ok) return listed;

  const existing = listed.value.find((s) => s.name === STORE_NAME);
  if (existing) return { ok: true, value: existing.id };

  const created = await cfFetch<CfStore>(
    `${CF_API}/accounts/${encodeURIComponent(accountId)}/secrets_store/stores`,
    { method: "POST", apiToken, body: { name: STORE_NAME } },
  );
  if (!created.ok) return created;
  return { ok: true, value: created.value.id };
}

interface CfSecret {
  id: string;
  name: string;
}

/**
 * Push a provider API key into the Secrets Store with scope "ai_gateway".
 * Returns the alias name (= secret name) that callers should put in
 * cfg.providerKeyAliases.<provider> for future requests.
 *
 * The CF API for this endpoint accepts an array of secrets; we always send one.
 * If a secret with the same name already exists, CF returns an error — caller
 * should pick a unique name (e.g. include a short random suffix on retry).
 */
export async function pushProviderKey(
  accountId: string,
  apiToken: string,
  storeId: string,
  name: string,
  value: string,
  comment = "kimi-code BYOK",
): Promise<SecretsStoreResult<string>> {
  const res = await cfFetch<CfSecret[]>(
    `${CF_API}/accounts/${encodeURIComponent(accountId)}/secrets_store/stores/${encodeURIComponent(
      storeId,
    )}/secrets`,
    {
      method: "POST",
      apiToken,
      body: [{ name, value, scopes: ["ai_gateway"], comment }],
    },
  );
  if (!res.ok) return res;
  const first = res.value[0];
  if (!first?.name) {
    return { ok: false, reason: "other", message: "Cloudflare did not return the stored secret" };
  }
  return { ok: true, value: first.name };
}

/** Delete a secret by id (used when rotating or replacing a stored provider key). */
export async function deleteProviderKey(
  accountId: string,
  apiToken: string,
  storeId: string,
  secretId: string,
): Promise<SecretsStoreResult<true>> {
  const res = await cfFetch<unknown>(
    `${CF_API}/accounts/${encodeURIComponent(accountId)}/secrets_store/stores/${encodeURIComponent(
      storeId,
    )}/secrets/${encodeURIComponent(secretId)}`,
    { method: "DELETE", apiToken },
  );
  if (!res.ok) return res;
  return { ok: true, value: true };
}

/** Build a deterministic alias name for a provider. */
export function aliasFor(provider: "anthropic" | "openai" | "google" | "openai-compatible"): string {
  return `kimi-code-${provider}`;
}
