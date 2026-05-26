/**
 * Probe whether Cloudflare Unified Billing is enabled for a given provider on
 * the user's AI Gateway. We can't read this from the gateway API directly —
 * Unified Billing is account-level (load credits in the dash) and the gateway
 * Get/Update endpoints don't expose a `unified_billing` field. So we send a
 * tiny test request through the gateway with ONLY the cf-aig-authorization
 * (CF token) header — no provider key — and look at the response.
 *
 *   - 2xx → UB is enabled for this provider; the call already worked.
 *   - 401/403 with the no-credits / unauthorized signature → UB needs setup.
 *   - anything else → "other" (network, gateway misconfigured, model rejected etc.).
 *
 * Cost: ~1 input token + ~1 output token through the cheapest model in the
 * provider. With Unified Billing active that's a fraction of a cent.
 */

import { getUserAgent } from "../util/version.js";

export type ProbeResult =
  | { ok: true; eventId: string | null }
  | {
      ok: false;
      reason: "needs-setup" | "network" | "other";
      message: string;
      /** Full response body (truncated) so the UI can show it for debugging. */
      rawBody: string;
      /** HTTP status if the request reached CF. */
      status: number | null;
      /** cf-aig-event-id from the response — look this up in the AI Gateway Logs UI. */
      eventId: string | null;
    };

export interface ProbeOptions {
  accountId: string;
  apiToken: string;
  gatewayId: string;
  /** Full model id including provider prefix, e.g. "anthropic/claude-haiku-4-5". */
  model: string;
  signal?: AbortSignal;
}

export async function probeUnifiedBilling(opts: ProbeOptions): Promise<ProbeResult> {
  const url = `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    opts.accountId,
  )}/${encodeURIComponent(opts.gatewayId)}/compat/chat/completions`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        // CRITICAL: for Unified Billing, we ONLY send cf-aig-authorization.
        // Do NOT send Authorization — CF Gateway treats the value of Authorization
        // as the upstream provider's BYOK key and forwards it as-is. Sending the
        // CF token there makes Google return "API_KEY_INVALID" (HTTP 400), making
        // UB look broken when the real issue is that the request never entered
        // the UB code path at all.
        "cf-aig-authorization": `Bearer ${opts.apiToken}`,
        "Content-Type": "application/json",
        "User-Agent": getUserAgent(),
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "user", content: "." }],
        max_tokens: 1,
        stream: false,
      }),
      signal: opts.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "network",
      message: msg,
      rawBody: "",
      status: null,
      eventId: null,
    };
  }

  const eventId = res.headers.get("cf-aig-event-id");
  if (res.ok) return { ok: true, eventId };

  const text = await res.text().catch(() => "");
  const lower = text.toLowerCase();

  // Unified-Billing-not-provisioned manifests several ways:
  //   - 401/403 from CF when UB isn't on the account at all.
  //   - 4xx from the upstream provider, forwarded by CF, complaining about a
  //     missing/invalid Authorization header (because CF didn't inject the
  //     provider key — it doesn't have one to inject under BYOK and UB is off
  //     for that provider).
  //   - 402 "payment required" when credits hit zero.
  // We collapse all of these into "needs-setup" so the user gets the dashboard
  // deep link instead of a confusing raw upstream error.
  const looksLikeMissingAuth =
    lower.includes("missing or invalid authorization") ||
    lower.includes("missing authorization") ||
    lower.includes("invalid authorization") ||
    lower.includes("authentication_error") ||
    lower.includes("authorization header");
  const looksLikeNoCredits =
    lower.includes("unified billing") ||
    lower.includes("no credits") ||
    lower.includes("insufficient credits") ||
    lower.includes("payment required");

  if (
    res.status === 401 ||
    res.status === 402 ||
    res.status === 403 ||
    looksLikeMissingAuth ||
    looksLikeNoCredits
  ) {
    return {
      ok: false,
      reason: "needs-setup",
      message: text.slice(0, 300) || `HTTP ${res.status}`,
      rawBody: text.slice(0, 1000),
      status: res.status,
      eventId,
    };
  }

  return {
    ok: false,
    reason: "other",
    message: `HTTP ${res.status}: ${text.slice(0, 300)}`,
    rawBody: text.slice(0, 1000),
    status: res.status,
    eventId,
  };
}
