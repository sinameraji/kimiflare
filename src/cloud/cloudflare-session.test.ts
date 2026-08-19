/**
 * "Log in with Cloudflare" sessions: loadConfig() surfaces the stored OAuth
 * block, and refreshes a stale access token (persisting the rotated refresh
 * token) so the rest of the app can keep treating cfg.apiToken as a plain
 * bearer token.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, refreshCloudflareSession, patchPersistedConfig } from "../config.js";
import { CF_OAUTH_TOKEN_URL } from "./cloudflare-oauth.js";

const ENV = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CF_ACCOUNT_ID", "CF_API_TOKEN", "XDG_CONFIG_HOME", "KIMIFLARE_CLOUD"] as const;

describe("Log in with Cloudflare session handling", () => {
  let originalFetch: typeof globalThis.fetch;
  let tokenCalls = 0;
  let dir = "";
  const saved = new Map<string, string | undefined>();

  before(async () => {
    for (const k of ENV) { saved.set(k, process.env[k]); delete process.env[k]; }
    dir = await mkdtemp(join(tmpdir(), "kimiflare-oauth-session-"));
    process.env.XDG_CONFIG_HOME = dir;
    await mkdir(join(dir, "kimiflare"), { recursive: true });
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === CF_OAUTH_TOKEN_URL) {
        tokenCalls++;
        const body = new URLSearchParams(String(init?.body ?? ""));
        assert.strictEqual(body.get("grant_type"), "refresh_token");
        assert.strictEqual(body.get("refresh_token"), "cfort_old");
        return new Response(
          JSON.stringify({ access_token: "cfoat_fresh", refresh_token: "cfort_rotated", expires_in: 3600, scope: "aig.read ai.read" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    };
  });
  after(async () => {
    globalThis.fetch = originalFetch;
    for (const k of ENV) { const v = saved.get(k); if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await rm(dir, { recursive: true, force: true });
  });

  it("loadConfig passes cloudflareOAuth through and leaves a still-valid token alone", async () => {
    tokenCalls = 0;
    await writeFile(
      join(dir, "kimiflare", "config.json"),
      JSON.stringify({
        accountId: "acct",
        apiToken: "cfoat_valid",
        model: "@cf/moonshotai/kimi-k2.6",
        cloudflareOAuth: { refreshToken: "cfort_old", expiresAt: Date.now() + 60 * 60_000, scopes: ["aig.read"], clientId: "cid", email: "me@example.com" },
      }),
    );
    const cfg = await loadConfig();
    assert.ok(cfg);
    assert.strictEqual(cfg.apiToken, "cfoat_valid");
    assert.strictEqual(cfg.cloudflareOAuth?.email, "me@example.com");
    assert.strictEqual(tokenCalls, 0);
  });

  it("loadConfig refreshes an expiring token and persists the rotated refresh token", async () => {
    tokenCalls = 0;
    await writeFile(
      join(dir, "kimiflare", "config.json"),
      JSON.stringify({
        accountId: "acct",
        apiToken: "cfoat_stale",
        model: "@cf/moonshotai/kimi-k2.6",
        theme: "everforest-light",
        cloudflareOAuth: { refreshToken: "cfort_old", expiresAt: Date.now() + 60_000, scopes: ["aig.read"], clientId: "cid" },
      }),
    );
    const cfg = await loadConfig();
    assert.ok(cfg);
    assert.strictEqual(tokenCalls, 1);
    assert.strictEqual(cfg.apiToken, "cfoat_fresh");
    assert.strictEqual(cfg.cloudflareOAuth?.refreshToken, "cfort_rotated");
    assert.ok(cfg.cloudflareOAuth!.expiresAt > Date.now() + 50 * 60_000);
    // Persisted with unrelated fields intact.
    const onDisk = JSON.parse(await readFile(join(dir, "kimiflare", "config.json"), "utf8"));
    assert.strictEqual(onDisk.apiToken, "cfoat_fresh");
    assert.strictEqual(onDisk.cloudflareOAuth.refreshToken, "cfort_rotated");
    assert.strictEqual(onDisk.theme, "everforest-light");
    assert.strictEqual(onDisk.accountId, "acct");
  });

  it("an env CLOUDFLARE_API_TOKEN overrides the OAuth session entirely", async () => {
    tokenCalls = 0;
    process.env.CLOUDFLARE_ACCOUNT_ID = "envacct";
    process.env.CLOUDFLARE_API_TOKEN = "envtoken";
    try {
      const cfg = await loadConfig();
      assert.ok(cfg);
      assert.strictEqual(cfg.apiToken, "envtoken");
      assert.strictEqual(cfg.cloudflareOAuth, undefined);
      assert.strictEqual(tokenCalls, 0);
    } finally {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
    }
  });

  it("refreshCloudflareSession is a no-op for manual API tokens and for fresh tokens", async () => {
    assert.strictEqual(await refreshCloudflareSession({ accountId: "a", apiToken: "manual", model: "m" }), null);
    assert.strictEqual(
      await refreshCloudflareSession({
        accountId: "a",
        apiToken: "cfoat",
        model: "m",
        cloudflareOAuth: { refreshToken: "cfort_old", expiresAt: Date.now() + 3_600_000, scopes: [], clientId: "cid" },
      }),
      null,
    );
  });

  it("patchPersistedConfig merges into the file without clobbering other keys", async () => {
    await writeFile(join(dir, "kimiflare", "config.json"), JSON.stringify({ accountId: "a", apiToken: "t", model: "m", theme: "x" }));
    await patchPersistedConfig({ apiToken: "t2", cloudMode: undefined });
    const onDisk = JSON.parse(await readFile(join(dir, "kimiflare", "config.json"), "utf8"));
    assert.deepStrictEqual(onDisk, { accountId: "a", apiToken: "t2", model: "m", theme: "x" });
  });
});
