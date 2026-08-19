/**
 * Log in with Cloudflare — OAuth 2.0 authorization-code flow with PKCE.
 *
 * This is the "beautiful" onboarding path: instead of asking the user to open
 * the Cloudflare dashboard, mint an API token, pick permissions, and paste both
 * the token and their Account ID into the terminal, we
 *
 *   1. start a one-shot loopback HTTP server on 127.0.0.1,
 *   2. open https://dash.cloudflare.com/oauth2/auth in the browser with our
 *      client id + PKCE challenge + the scopes kimiflare needs,
 *   3. Cloudflare shows the user "kimiflare wants permission to …" and, once
 *      they approve, redirects to the loopback server with an auth code,
 *   4. we exchange the code (+ PKCE verifier) for an access token and a
 *      refresh token, then look up the user's account(s) via the API.
 *
 * The access token is a regular Cloudflare API bearer token: it works against
 * api.cloudflare.com (AI Gateway management, Workers AI, Secrets Store) and
 * gateway.ai.cloudflare.com (the gateway-level `Authorization` header). It is
 * short-lived, so `refreshCloudflareToken()` / `ensureFreshCloudflareToken()`
 * rotate it in the background using the refresh token (`offline_access`).
 *
 * The protocol is the same one `wrangler login` speaks (see
 * cloudflare/workers-sdk packages/wrangler/src/user/user.ts). kimiflare uses
 * its own OAuth client id — never wrangler's.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { getUserAgent } from "../util/version.js";
import { logger } from "../util/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_DOMAIN = process.env.KIMIFLARE_CF_AUTH_DOMAIN ?? "dash.cloudflare.com";
export const CF_OAUTH_AUTH_URL = `https://${AUTH_DOMAIN}/oauth2/auth`;
export const CF_OAUTH_TOKEN_URL = `https://${AUTH_DOMAIN}/oauth2/token`;
export const CF_OAUTH_REVOKE_URL = `https://${AUTH_DOMAIN}/oauth2/revoke`;

/**
 * kimiflare's OAuth client id, registered with Cloudflare ("Log in with
 * Cloudflare"). Override with KIMIFLARE_CF_OAUTH_CLIENT_ID for staging /
 * self-registered clients.
 */
export const CF_OAUTH_CLIENT_ID =
  process.env.KIMIFLARE_CF_OAUTH_CLIENT_ID ?? "__KIMIFLARE_CF_OAUTH_CLIENT_ID__";

/** True once a real OAuth client id is baked in (or provided via env). */
export function isCloudflareLoginConfigured(clientId: string = CF_OAUTH_CLIENT_ID): boolean {
  return !!clientId && !clientId.startsWith("__");
}

/**
 * Loopback redirect. The path/port must match what is registered for the
 * OAuth client. Port 0 is not allowed by Cloudflare's redirect matching, so we
 * bind a fixed port and fail loudly if it is taken.
 */
export const CF_OAUTH_CALLBACK_PORT = Number(process.env.KIMIFLARE_CF_OAUTH_CALLBACK_PORT ?? 8978);
export const CF_OAUTH_CALLBACK_PATH = "/oauth/callback";
export const CF_OAUTH_REDIRECT_URI = `http://localhost:${CF_OAUTH_CALLBACK_PORT}${CF_OAUTH_CALLBACK_PATH}`;

/**
 * Scopes kimiflare asks for. Keep this list tight — it is exactly what the
 * user sees on the consent screen. Names are Cloudflare's dot-delimited OAuth
 * scope ids (GET https://api.cloudflare.com/client/v4/oauth/scopes); the
 * colon-delimited `account:read` style is wrangler's legacy first-party
 * dialect and is rejected for self-managed clients.
 *
 *   user-details.read      GET /user  → show who is signed in
 *   account-settings.read  GET /accounts → pick the Account ID automatically
 *   ai.read / ai.write     Workers AI (also required by /accounts/{id}/ai/v1/*
 *                          — an AI-Gateway-only token gets 401 there)
 *   aig.read / aig.write   list / create / configure AI Gateways
 *   aig.run                run inference through gateway.ai.cloudflare.com
 *   secrets-store.read/write  store provider keys (BYOK aliases) in Secrets Store
 *
 * `offline_access` is appended at authorize time so we get a refresh token.
 * The registered client must allow every scope requested here.
 */
export const CF_OAUTH_SCOPES: readonly string[] = [
  "user-details.read",
  "account-settings.read",
  "ai.read",
  "ai.write",
  "aig.read",
  "aig.write",
  "aig.run",
  "secrets-store.read",
  "secrets-store.write",
];

/** How long before expiry we proactively refresh. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;
/** How long we wait for the user to finish in the browser. */
export const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CloudflareOAuthTokens {
  accessToken: string;
  /** Present when `offline_access` was granted. Rotates on every refresh. */
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
}

/** What we persist in config.json next to `apiToken` (which mirrors accessToken). */
export interface CloudflareOAuthState {
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
  clientId: string;
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

export class CloudflareOAuthError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly description?: string,
  ) {
    super(message);
    this.name = "CloudflareOAuthError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCE helpers (RFC 7636)
// ─────────────────────────────────────────────────────────────────────────────

const PKCE_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random string drawn from the PKCE charset. Exported for tests. */
export function randomFromCharset(length: number, charset = PKCE_CHARSET): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += charset[bytes[i]! % charset.length];
  return out;
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomFromCharset(96);
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl(params: {
  clientId?: string;
  redirectUri?: string;
  scopes?: readonly string[];
  state: string;
  codeChallenge: string;
}): string {
  const scopes = [...(params.scopes ?? CF_OAUTH_SCOPES), "offline_access"];
  const q = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId ?? CF_OAUTH_CLIENT_ID,
    redirect_uri: params.redirectUri ?? CF_OAUTH_REDIRECT_URI,
    scope: scopes.join(" "),
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${CF_OAUTH_AUTH_URL}?${q.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token endpoint
// ─────────────────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function postToken(params: URLSearchParams): Promise<CloudflareOAuthTokens> {
  const res = await fetch(CF_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": getUserAgent(),
    },
    body: params.toString(),
  });
  let json: TokenResponse;
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    throw new CloudflareOAuthError(`Cloudflare token endpoint returned HTTP ${res.status} with a non-JSON body`);
  }
  if (!res.ok || json.error || !json.access_token) {
    const code = json.error ?? `http_${res.status}`;
    throw new CloudflareOAuthError(
      `Cloudflare OAuth token request failed: ${code}${json.error_description ? ` — ${json.error_description}` : ""}`,
      code,
      json.error_description,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + Math.max(60, json.expires_in ?? 3600) * 1000,
    scopes: json.scope ? json.scope.split(" ").filter(Boolean) : [],
  };
}

export async function exchangeCodeForTokens(args: {
  code: string;
  codeVerifier: string;
  clientId?: string;
  redirectUri?: string;
}): Promise<CloudflareOAuthTokens> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri ?? CF_OAUTH_REDIRECT_URI,
      client_id: args.clientId ?? CF_OAUTH_CLIENT_ID,
      code_verifier: args.codeVerifier,
    }),
  );
}

export async function refreshCloudflareToken(
  refreshToken: string,
  clientId: string = CF_OAUTH_CLIENT_ID,
): Promise<CloudflareOAuthTokens> {
  const fresh = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  );
  // Cloudflare rotates refresh tokens; if the response omits one, keep the old.
  return { ...fresh, refreshToken: fresh.refreshToken ?? refreshToken };
}

export async function revokeCloudflareToken(
  refreshToken: string,
  clientId: string = CF_OAUTH_CLIENT_ID,
): Promise<void> {
  try {
    await fetch(CF_OAUTH_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": getUserAgent() },
      body: new URLSearchParams({ token: refreshToken, client_id: clientId }).toString(),
    });
  } catch (e) {
    logger.warn("cloudflare-oauth:revoke_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

/** True when the token is expired or within REFRESH_SKEW_MS of expiring. */
export function tokenNeedsRefresh(expiresAt: number, now: number = Date.now(), skewMs: number = REFRESH_SKEW_MS): boolean {
  return expiresAt - now <= skewMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare API helpers used right after login
// ─────────────────────────────────────────────────────────────────────────────

export async function listCloudflareAccounts(accessToken: string): Promise<CloudflareAccount[]> {
  const res = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": getUserAgent() },
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    result?: Array<{ id: string; name: string }>;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || !json.success || !Array.isArray(json.result)) {
    const msg = json.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
    throw new CloudflareOAuthError(`Couldn't list your Cloudflare accounts: ${msg}`);
  }
  return json.result.map((a) => ({ id: a.id, name: a.name }));
}

export async function whoAmI(accessToken: string): Promise<{ email?: string; id?: string } | null> {
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/user", {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": getUserAgent() },
    });
    const json = (await res.json()) as { success?: boolean; result?: { email?: string; id?: string } };
    return json.success && json.result ? json.result : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loopback callback server
// ─────────────────────────────────────────────────────────────────────────────

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>kimiflare — signed in</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:28rem;padding:2rem 2.5rem;border:1px solid #2a2f3a;border-radius:12px;background:#151922}h1{margin:0 0 .5rem;font-size:1.4rem;color:#f38020}p{margin:.25rem 0;color:#b9c0cc}</style></head>
<body><div class="card"><h1>✓ Signed in to kimiflare</h1><p>You can close this tab and return to your terminal.</p></div></body></html>`;

function errorHtml(msg: string): string {
  const safe = msg.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c);
  return `<!doctype html><html><head><meta charset="utf-8"><title>kimiflare — sign-in failed</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:32rem;padding:2rem 2.5rem;border:1px solid #2a2f3a;border-radius:12px;background:#151922}h1{margin:0 0 .5rem;font-size:1.4rem;color:#ff6b6b}p{color:#b9c0cc}</style></head>
<body><div class="card"><h1>Sign-in failed</h1><p>${safe}</p><p>Return to your terminal and try again.</p></div></body></html>`;
}

export interface LoginWithCloudflareOptions {
  /** Called with the URL the user must open. The caller decides whether to auto-open a browser. */
  onAuthUrl: (url: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  clientId?: string;
  scopes?: readonly string[];
  /** Override the callback port (tests). */
  port?: number;
}

/**
 * Run the full interactive flow. Resolves with the tokens once the user has
 * approved in the browser. Rejects on timeout, abort, or an OAuth error.
 */
export async function loginWithCloudflare(opts: LoginWithCloudflareOptions): Promise<CloudflareOAuthTokens> {
  const clientId = opts.clientId ?? CF_OAUTH_CLIENT_ID;
  if (!isCloudflareLoginConfigured(clientId)) {
    throw new CloudflareOAuthError(
      "Log in with Cloudflare isn't configured in this build (no OAuth client id). " +
        "Set KIMIFLARE_CF_OAUTH_CLIENT_ID, or paste an API token instead — see docs/login-with-cloudflare.md.",
      "not_configured",
    );
  }
  const port = opts.port ?? CF_OAUTH_CALLBACK_PORT;
  const redirectUri = `http://localhost:${port}${CF_OAUTH_CALLBACK_PATH}`;
  const { verifier, challenge } = generatePkce();
  const state = randomFromCharset(32);

  return new Promise<CloudflareOAuthTokens>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      server.close();
      fn();
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== CF_OAUTH_CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      if (err) {
        const desc = url.searchParams.get("error_description") ?? "";
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(errorHtml(`${err}${desc ? `: ${desc}` : ""}`));
        finish(() => reject(new CloudflareOAuthError(`Cloudflare sign-in was not completed: ${err}${desc ? ` — ${desc}` : ""}`, err, desc)));
        return;
      }
      if (!code || gotState !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(errorHtml("Invalid callback (missing code or state mismatch)."));
        finish(() => reject(new CloudflareOAuthError("OAuth callback was missing the code or had a mismatched state.", "invalid_callback")));
        return;
      }
      // Exchange first, then answer the browser, so a failed exchange shows an error page.
      exchangeCodeForTokens({ code, codeVerifier: verifier, clientId, redirectUri })
        .then((tokens) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(SUCCESS_HTML);
          finish(() => resolve(tokens));
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }).end(errorHtml(msg));
          finish(() => reject(e instanceof Error ? e : new CloudflareOAuthError(msg)));
        });
    });

    const onAbort = () => finish(() => reject(new CloudflareOAuthError("Sign-in cancelled.", "aborted")));
    const timer = setTimeout(
      () => finish(() => reject(new CloudflareOAuthError("Timed out waiting for the browser sign-in. Please try again.", "timeout"))),
      opts.timeoutMs ?? LOGIN_TIMEOUT_MS,
    );
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    server.on("error", (e: NodeJS.ErrnoException) => {
      const msg =
        e.code === "EADDRINUSE"
          ? `Port ${port} is already in use (another kimiflare or wrangler login in progress?). Close it and try again.`
          : `Couldn't start the local sign-in callback server: ${e.message}`;
      finish(() => reject(new CloudflareOAuthError(msg, e.code)));
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      logger.debug("cloudflare-oauth:listening", { port: addr?.port });
      opts.onAuthUrl(
        buildAuthorizeUrl({ clientId, redirectUri, scopes: opts.scopes, state, codeChallenge: challenge }),
      );
    });
  });
}
