import { getUserAgent } from "../util/version.js";

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid"
        | "missing-workers-ai-scope"
        | "authenticated-gateway"
        | "network"
        | "other";
      message: string;
    };

/**
 * Validate that a Cloudflare API token is (a) recognised by Cloudflare, (b)
 * carries the Workers AI permission, and (c) can actually reach Workers AI
 * through the configured AI Gateway (if any). We call this from the token
 * update modal so the cost is paid only when the user is already stuck on
 * auth.
 *
 *   - /user/tokens/verify confirms the token is real, active, and parseable.
 *   - A 1-token request to the cheapest Workers AI model
 *     (@cf/baai/bge-base-en-v1.5 embeddings, billed at <$0.01/M) against the
 *     direct API confirms the token actually carries Workers AI Read scope.
 *     /tokens/verify by itself can pass on a token that lacks Workers AI.
 *   - When a gateway id is supplied, we re-run the embeddings probe through
 *     gateway.ai.cloudflare.com. If the direct probe succeeded but the
 *     gateway probe 401s, the gateway has "Authenticated Gateway" enabled,
 *     which requires a gateway-specific token in cf-aig-authorization — a
 *     separate credential kimiflare does not yet support. That diagnosis
 *     gets its own reason so the modal can offer the right recovery (turn
 *     the toggle off) instead of asking for yet another token paste.
 */
export async function verifyApiTokenForWorkersAi(
  accountId: string,
  apiToken: string,
  gatewayId?: string,
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

  if (!probeRes.ok) {
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

  // Direct probe succeeded. If a gateway is configured, also probe through it.
  // This is the path the runtime actually uses (see buildKimiRequestTarget in
  // client.ts), so a token that works direct-to-Workers-AI but fails through
  // the gateway tells us the gateway itself is rejecting the credential —
  // typically because "Authenticated Gateway" is on and CF wants a
  // gateway-specific token in cf-aig-authorization rather than the account
  // token in Authorization.
  if (!gatewayId) return { ok: true };

  const gatewayProbeUrl = `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    accountId,
  )}/${encodeURIComponent(gatewayId)}/workers-ai/@cf/baai/bge-base-en-v1.5`;
  let gatewayRes: Response;
  try {
    gatewayRes = await fetch(gatewayProbeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        "User-Agent": getUserAgent(),
        "cf-aig-skip-cache": "true",
      },
      body: JSON.stringify({ text: ["k"] }),
      signal,
    });
  } catch (e) {
    return { ok: false, reason: "network", message: e instanceof Error ? e.message : String(e) };
  }

  if (gatewayRes.ok) return { ok: true };
  if (gatewayRes.status === 401 || gatewayRes.status === 403) {
    return {
      ok: false,
      reason: "authenticated-gateway",
      message:
        "Direct Workers AI works, but the same call through your AI Gateway is rejected — \"Authenticated Gateway\" appears to be on.",
    };
  }
  const gatewayText = await gatewayRes.text().catch(() => "");
  return {
    ok: false,
    reason: "other",
    message: extractFirstError(gatewayText) ?? `gateway HTTP ${gatewayRes.status}`,
  };
}

/**
 * Diagnostic-only variant: probe the *current* stored apiToken without asking
 * the user for a new one. The modal calls this on mount to figure out whether
 * the original failure was a token problem (paste a new one) or a gateway
 * problem (turn off Authenticated Gateway). Skips the /tokens/verify GET
 * because we only need to know if the token can reach Workers AI as routed.
 */
export async function diagnoseCurrentToken(
  accountId: string,
  apiToken: string,
  gatewayId: string | undefined,
  signal?: AbortSignal,
): Promise<VerifyResult> {
  return verifyApiTokenForWorkersAi(accountId, apiToken, gatewayId, signal);
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
