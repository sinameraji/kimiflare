import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import {
  generatePkce,
  buildAuthorizeUrl,
  tokenNeedsRefresh,
  loginWithCloudflare,
  refreshCloudflareToken,
  isCloudflareLoginConfigured,
  CloudflareOAuthError,
  CF_OAUTH_AUTH_URL,
  CF_OAUTH_TOKEN_URL,
  CF_OAUTH_SCOPES,
} from "./cloudflare-oauth.js";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

describe("cloudflare-oauth: PKCE + authorize URL", () => {
  it("generates a 96-char verifier from the PKCE charset and an S256 challenge", () => {
    const { verifier, challenge } = generatePkce();
    assert.strictEqual(verifier.length, 96);
    assert.match(verifier, /^[A-Za-z0-9\-._~]+$/);
    assert.strictEqual(challenge, base64url(createHash("sha256").update(verifier).digest()));
  });

  it("builds a dash.cloudflare.com authorize URL with PKCE, state and offline_access", () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: "abc123", state: "st4te", codeChallenge: "ch4llenge", redirectUri: "http://localhost:1234/oauth/callback" }),
    );
    assert.strictEqual(`${url.origin}${url.pathname}`, CF_OAUTH_AUTH_URL);
    assert.strictEqual(url.searchParams.get("response_type"), "code");
    assert.strictEqual(url.searchParams.get("client_id"), "abc123");
    assert.strictEqual(url.searchParams.get("redirect_uri"), "http://localhost:1234/oauth/callback");
    assert.strictEqual(url.searchParams.get("state"), "st4te");
    assert.strictEqual(url.searchParams.get("code_challenge"), "ch4llenge");
    assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
    const scopes = url.searchParams.get("scope")!.split(" ");
    for (const s of CF_OAUTH_SCOPES) assert.ok(scopes.includes(s), `missing scope ${s}`);
    assert.ok(scopes.includes("offline_access"));
    // Cloudflare's self-managed clients only accept dot-delimited scope ids.
    for (const s of scopes) assert.ok(!s.includes(":"), `legacy colon scope leaked: ${s}`);
  });

  it("asks for the AI Gateway + Workers AI + account scopes kimiflare needs", () => {
    for (const s of ["account-settings.read", "user-details.read", "ai.read", "aig.read", "aig.write", "aig.run"]) {
      assert.ok(CF_OAUTH_SCOPES.includes(s), `expected scope ${s}`);
    }
  });

  it("tokenNeedsRefresh honours the skew window", () => {
    const now = 1_000_000;
    assert.strictEqual(tokenNeedsRefresh(now + 10 * 60_000, now, 5 * 60_000), false);
    assert.strictEqual(tokenNeedsRefresh(now + 4 * 60_000, now, 5 * 60_000), true);
    assert.strictEqual(tokenNeedsRefresh(now - 1, now, 5 * 60_000), true);
  });

  it("isCloudflareLoginConfigured rejects the placeholder client id", () => {
    assert.strictEqual(isCloudflareLoginConfigured("__KIMIFLARE_CF_OAUTH_CLIENT_ID__"), false);
    assert.strictEqual(isCloudflareLoginConfigured(""), false);
    assert.strictEqual(isCloudflareLoginConfigured("223a6ddec4aad6a652bf9b5ce840912c"), true);
  });
});

describe("cloudflare-oauth: loopback login flow", () => {
  let originalFetch: typeof globalThis.fetch;
  let tokenRequests: URLSearchParams[] = [];
  let tokenResponse: () => Response = () =>
    new Response(
      JSON.stringify({ access_token: "cfoat_test", refresh_token: "cfort_test", expires_in: 3600, scope: "aig.read ai.read offline_access", token_type: "bearer" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === CF_OAUTH_TOKEN_URL) {
        tokenRequests.push(new URLSearchParams(String(init?.body ?? "")));
        return tokenResponse();
      }
      return originalFetch(input, init);
    };
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("opens the browser URL, receives the callback, exchanges the code with PKCE, and resolves tokens", async () => {
    tokenRequests = [];
    const port = await freePort();
    let authUrl = "";
    const login = loginWithCloudflare({
      clientId: "clientid123",
      port,
      timeoutMs: 10_000,
      onAuthUrl: (u) => {
        authUrl = u;
      },
    });
    // Give the server a tick to start and hand us the URL.
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(authUrl.startsWith(CF_OAUTH_AUTH_URL), "auth URL should point at dash.cloudflare.com");
    const parsed = new URL(authUrl);
    const state = parsed.searchParams.get("state")!;
    const redirect = parsed.searchParams.get("redirect_uri")!;
    assert.strictEqual(redirect, `http://localhost:${port}/oauth/callback`);

    // Simulate the browser redirect back to the loopback server.
    const cb = await originalFetch(`http://127.0.0.1:${port}/oauth/callback?code=AUTHCODE&state=${encodeURIComponent(state)}`);
    assert.strictEqual(cb.status, 200);
    assert.match(await cb.text(), /Signed in to kimiflare/);

    const tokens = await login;
    assert.strictEqual(tokens.accessToken, "cfoat_test");
    assert.strictEqual(tokens.refreshToken, "cfort_test");
    assert.deepStrictEqual(tokens.scopes, ["aig.read", "ai.read", "offline_access"]);
    assert.ok(tokens.expiresAt > Date.now() + 3000_000);

    assert.strictEqual(tokenRequests.length, 1);
    const body = tokenRequests[0]!;
    assert.strictEqual(body.get("grant_type"), "authorization_code");
    assert.strictEqual(body.get("code"), "AUTHCODE");
    assert.strictEqual(body.get("client_id"), "clientid123");
    assert.strictEqual(body.get("redirect_uri"), redirect);
    const verifier = body.get("code_verifier")!;
    assert.strictEqual(base64url(createHash("sha256").update(verifier).digest()), parsed.searchParams.get("code_challenge"));
    // Public client: no client_secret ever leaves the CLI.
    assert.strictEqual(body.get("client_secret"), null);
  });

  it("rejects a callback whose state does not match (CSRF guard)", async () => {
    const port = await freePort();
    const login = loginWithCloudflare({ clientId: "clientid123", port, timeoutMs: 10_000, onAuthUrl: () => {} });
    const expectation = assert.rejects(login, (e: CloudflareOAuthError) => e.code === "invalid_callback");
    await new Promise((r) => setTimeout(r, 50));
    const cb = await originalFetch(`http://127.0.0.1:${port}/oauth/callback?code=AUTHCODE&state=WRONG`);
    assert.strictEqual(cb.status, 400);
    await expectation;
  });

  it("surfaces an OAuth error redirect (user clicked Deny)", async () => {
    const port = await freePort();
    const login = loginWithCloudflare({ clientId: "clientid123", port, timeoutMs: 10_000, onAuthUrl: () => {} });
    const expectation = assert.rejects(login, (e: CloudflareOAuthError) => e.code === "access_denied" && /user denied/.test(e.message));
    await new Promise((r) => setTimeout(r, 50));
    await originalFetch(`http://127.0.0.1:${port}/oauth/callback?error=access_denied&error_description=user+denied`);
    await expectation;
  });

  it("aborts cleanly via AbortSignal", async () => {
    const port = await freePort();
    const ac = new AbortController();
    const login = loginWithCloudflare({ clientId: "clientid123", port, timeoutMs: 10_000, signal: ac.signal, onAuthUrl: () => {} });
    const expectation = assert.rejects(login, (e: CloudflareOAuthError) => e.code === "aborted");
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await expectation;
  });

  it("refuses to start without a configured client id", async () => {
    await assert.rejects(
      loginWithCloudflare({ clientId: "__KIMIFLARE_CF_OAUTH_CLIENT_ID__", onAuthUrl: () => {} }),
      (e: CloudflareOAuthError) => e.code === "not_configured",
    );
  });

  it("refreshCloudflareToken posts grant_type=refresh_token and keeps the old refresh token if none is returned", async () => {
    tokenRequests = [];
    const prev = tokenResponse;
    tokenResponse = () =>
      new Response(JSON.stringify({ access_token: "cfoat_new", expires_in: 3600, scope: "aig.read" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    try {
      const fresh = await refreshCloudflareToken("cfort_old", "clientid123");
      assert.strictEqual(fresh.accessToken, "cfoat_new");
      assert.strictEqual(fresh.refreshToken, "cfort_old");
      const body = tokenRequests[0]!;
      assert.strictEqual(body.get("grant_type"), "refresh_token");
      assert.strictEqual(body.get("refresh_token"), "cfort_old");
      assert.strictEqual(body.get("client_id"), "clientid123");
    } finally {
      tokenResponse = prev;
    }
  });

  it("turns token-endpoint errors into CloudflareOAuthError with the OAuth code", async () => {
    const prev = tokenResponse;
    tokenResponse = () =>
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "refresh token expired" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    try {
      await assert.rejects(
        refreshCloudflareToken("cfort_dead", "clientid123"),
        (e: CloudflareOAuthError) => e.code === "invalid_grant" && /refresh token expired/.test(e.message),
      );
    } finally {
      tokenResponse = prev;
    }
  });
});
