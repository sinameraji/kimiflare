/**
 * KimiFlare Cloud — Billing client
 *
 * Thin client that talks to the KimiFlare Cloud worker for Stripe checkout,
 * customer portal, and subscription status. The worker owns all Stripe secrets
 * and webhook handling; this module only forwards the authenticated user's
 * request and opens the returned URL in the default browser.
 */

import { CLOUD_API_URL } from "./auth.js";
import { detectKillSwitch } from "../util/errors.js";

export type SubscriptionStatus = "inactive" | "active" | "past_due" | "canceled";

export interface BillingStatus {
  status: SubscriptionStatus;
  plan: string | null;
  /** ISO timestamp for the current billing period end, if active. */
  currentPeriodEnd: string | null;
}

export interface CheckoutSession {
  url: string;
}

export interface PortalSession {
  url: string;
}

function authHeaders(token: string, deviceId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (deviceId) headers["X-Device-ID"] = deviceId;
  return headers;
}

export async function fetchBillingStatus(token: string, deviceId?: string): Promise<BillingStatus | null> {
  const res = await fetch(`${CLOUD_API_URL}/v1/billing/status`, {
    headers: authHeaders(token, deviceId),
  });
  await detectKillSwitch(res);
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  if (typeof data.status !== "string") return null;
  return {
    status: data.status as SubscriptionStatus,
    plan: typeof data.plan === "string" ? data.plan : null,
    currentPeriodEnd: typeof data.current_period_end === "string" ? data.current_period_end : null,
  };
}

export async function createCheckoutSession(
  token: string,
  deviceId?: string,
  priceId?: string,
): Promise<CheckoutSession | null> {
  const res = await fetch(`${CLOUD_API_URL}/v1/billing/checkout`, {
    method: "POST",
    headers: authHeaders(token, deviceId),
    body: JSON.stringify({ price_id: priceId ?? null }),
  });
  await detectKillSwitch(res);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Checkout failed: ${res.statusText}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (typeof data.url !== "string") return null;
  return { url: data.url };
}

export async function createTopupSession(
  token: string,
  deviceId?: string,
): Promise<CheckoutSession | null> {
  const res = await fetch(`${CLOUD_API_URL}/v1/billing/topup`, {
    method: "POST",
    headers: authHeaders(token, deviceId),
    body: JSON.stringify({}),
  });
  await detectKillSwitch(res);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Top-up failed: ${res.statusText}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (typeof data.url !== "string") return null;
  return { url: data.url };
}

export async function createCustomerPortalSession(token: string, deviceId?: string): Promise<PortalSession | null> {
  const res = await fetch(`${CLOUD_API_URL}/v1/billing/portal`, {
    method: "POST",
    headers: authHeaders(token, deviceId),
  });
  await detectKillSwitch(res);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Portal failed: ${res.statusText}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (typeof data.url !== "string") return null;
  return { url: data.url };
}
