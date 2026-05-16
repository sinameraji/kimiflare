import { getUserAgent } from "../util/version.js";

export interface Gateway {
  id: string;
  cache_ttl?: number;
  collect_logs?: boolean;
  created_at?: string;
  modified_at?: string;
}

export type GatewayApiError =
  | { kind: "forbidden"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "network"; message: string }
  | { kind: "other"; status: number; message: string };

export class AiGatewayError extends Error {
  constructor(public readonly detail: GatewayApiError) {
    super(detail.message);
    this.name = "AiGatewayError";
  }
}

function baseUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai-gateway/gateways`;
}

function authHeaders(apiToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
    "User-Agent": getUserAgent(),
  };
}

async function parseCloudflareError(res: Response): Promise<GatewayApiError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* ignore */
  }
  let message = `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(text) as {
      errors?: Array<{ message?: string; code?: number }>;
    };
    if (parsed.errors?.length) {
      message = parsed.errors.map((e) => e.message).filter(Boolean).join("; ") || message;
    }
  } catch {
    if (text) message = text.slice(0, 200);
  }
  if (res.status === 403 || res.status === 401) {
    return { kind: "forbidden", message };
  }
  if (res.status === 404) {
    return { kind: "not_found", message };
  }
  return { kind: "other", status: res.status, message };
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new AiGatewayError({
      kind: "network",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function listGateways(
  accountId: string,
  apiToken: string,
): Promise<Gateway[]> {
  const res = await doFetch(baseUrl(accountId), {
    method: "GET",
    headers: authHeaders(apiToken),
  });
  if (!res.ok) {
    throw new AiGatewayError(await parseCloudflareError(res));
  }
  const json = (await res.json()) as { result?: Gateway[] };
  return Array.isArray(json.result) ? json.result : [];
}

export async function createGateway(
  accountId: string,
  apiToken: string,
  id: string,
): Promise<Gateway> {
  const res = await doFetch(baseUrl(accountId), {
    method: "POST",
    headers: authHeaders(apiToken),
    body: JSON.stringify({
      id,
      cache_invalidate_on_update: false,
      cache_ttl: 0,
      collect_logs: true,
      rate_limiting_interval: 0,
      rate_limiting_limit: 0,
      rate_limiting_technique: "fixed",
    }),
  });
  if (!res.ok) {
    throw new AiGatewayError(await parseCloudflareError(res));
  }
  const json = (await res.json()) as { result?: Gateway };
  if (!json.result) {
    throw new AiGatewayError({
      kind: "other",
      status: res.status,
      message: "Cloudflare returned no gateway result",
    });
  }
  return json.result;
}

/**
 * Validate that the gateway is reachable for a Workers AI request. We send a
 * minimal request to a known-cheap embeddings model and treat any 2xx/4xx
 * response from Cloudflare as proof that routing works; only network errors
 * and 5xx are surfaced as probe failures.
 */
export async function probeGateway(
  accountId: string,
  apiToken: string,
  gatewayId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/workers-ai/@cf/baai/bge-base-en-v1.5`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        "User-Agent": getUserAgent(),
        "cf-aig-skip-cache": "true",
      },
      body: JSON.stringify({ text: ["kimiflare probe"] }),
    });
    if (res.status >= 500) {
      return { ok: false, message: `Gateway returned HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
