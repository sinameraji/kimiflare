import { getUserAgent } from "../util/version.js";

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "missing-workers-ai-scope" | "network" | "other"; message: string };

/**
 * Validate that a Cloudflare API token is (a) recognised by Cloudflare and (b)
 * carries the Workers AI permission. We only call this from inside the token
 * update modal, so the cost (one /tokens/verify GET + one ~1-token Workers AI
 * call on success) is paid lazily when the user is already stuck on auth.
 *
 *   - /user/tokens/verify confirms the token is real, active, and parseable.
 *   - A 1-token request to the cheapest Workers AI model
 *     (@cf/baai/bge-base-en-v1.5 embeddings, billed at <$0.01/M) confirms the
 *     token actually carries Workers AI Read scope. /tokens/verify by itself
 *     can pass on a token that lacks Workers AI — that's exactly the failure
 *     mode this modal exists to catch, so we have to probe.
 */
export async function verifyApiTokenForWorkersAi(
  accountId: string,
  apiToken: string,
  signal?: AbortSignal,
): Promise<VerifyResult> {
  // Step 1: /user/tokens/verify
  let verifyRes: Response;
  try {
    verifyRes = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "User-Agent": getUserAgent(),
      },
      signal,
    });
  } catch (e) {
    return { ok: false, reason: "network", message: e instanceof Error ? e.message : String(e) };
  }

  if (!verifyRes.ok) {
    const text = await verifyRes.text().catch(() => "");
    return {
      ok: false,
      reason: "invalid",
      message: extractFirstError(text) ?? `HTTP ${verifyRes.status}`,
    };
  }

  type VerifyBody = {
    success?: boolean;
    result?: { status?: string };
    errors?: Array<{ message?: string }>;
  };
  let body: VerifyBody | null = null;
  try {
    body = (await verifyRes.json()) as VerifyBody;
  } catch {
    return { ok: false, reason: "other", message: "Cloudflare returned a non-JSON verify response" };
  }
  if (!body?.success || body.result?.status !== "active") {
    return {
      ok: false,
      reason: "invalid",
      message: body?.errors?.[0]?.message ?? "Token is not active",
    };
  }

  // Step 2: minimal Workers AI probe. We hit the embeddings model directly
  // (no gateway in the path) so any 401/403 is unambiguously about Workers AI
  // scope on this token — not about gateway settings, BYOK aliases, or UB.
  const probeUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId,
  )}/ai/run/@cf/baai/bge-base-en-v1.5`;
  let probeRes: Response;
  try {
    probeRes = await fetch(probeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        "User-Agent": getUserAgent(),
      },
      body: JSON.stringify({ text: ["k"] }),
      signal,
    });
  } catch (e) {
    return { ok: false, reason: "network", message: e instanceof Error ? e.message : String(e) };
  }

  if (probeRes.ok) return { ok: true };

  // 401/403/code 10000 here means the token verified but doesn't carry
  // Workers AI scope (or the wrong account id is paired with it).
  if (probeRes.status === 401 || probeRes.status === 403) {
    return {
      ok: false,
      reason: "missing-workers-ai-scope",
      message: "Token is valid but lacks Workers AI permission for this account.",
    };
  }
  const text = await probeRes.text().catch(() => "");
  return {
    ok: false,
    reason: "other",
    message: extractFirstError(text) ?? `HTTP ${probeRes.status}`,
  };
}

function extractFirstError(text: string): string | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { errors?: Array<{ message?: string; code?: number }> };
    const first = parsed.errors?.[0];
    if (first?.message) return first.message;
  } catch {
    /* not json */
  }
  return text.slice(0, 200) || null;
}
