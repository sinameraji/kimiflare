/**
 * Custom OpenAI-compatible endpoint routing tests for runKimi.
 *
 * A host application (e.g. an agents platform running kimiflare inside a
 * container) points the CLI at its own gateway/broker with
 * KIMIFLARE_BASE_URL + KIMIFLARE_API_KEY instead of handing the process a raw
 * Cloudflare token. These tests pin the contract:
 *
 *   1. Requests go to `<baseUrl>/chat/completions` with
 *      `Authorization: Bearer <apiKey>` — and nothing else auth-wise: no
 *      cf-aig-authorization, no cf-aig-byok-alias, no cf-aig-* gateway
 *      headers, no Cloudflare token fallback.
 *   2. The custom endpoint wins over every Cloudflare path (gateway,
 *      cf-catalog, direct Workers AI, cloud mode) even when those are
 *      configured too.
 *   3. Model ids pass through in the body unchanged — no workers-ai/
 *      prefixing, no Cloudflare id-shape validation.
 *   4. Works with completely empty Cloudflare credentials.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { runKimi } from "./client.js";

const ENV_KEYS = ["KIMIFLARE_BASE_URL", "KIMIFLARE_API_KEY"] as const;

describe("runKimi: custom OpenAI-compatible endpoint", () => {
  let originalFetch: typeof globalThis.fetch;
  let lastRequest: Request | null = null;
  const savedEnv: Record<string, string | undefined> = {};

  before(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      lastRequest = new Request(input, init);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
  });
  after(() => {
    globalThis.fetch = originalFetch;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => {
    lastRequest = null;
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("routes to <baseUrl>/chat/completions with the custom bearer and no Cloudflare credentials", async () => {
    for await (const _ of runKimi({
      accountId: "",
      apiToken: "",
      model: "@cf/moonshotai/kimi-k2.6",
      messages: [{ role: "user", content: "hi" }],
      customEndpoint: { baseUrl: "https://aig.example.com/v1", apiKey: "broker-key" },
    })) {
      /* drain */
    }
    assert.ok(lastRequest);
    assert.strictEqual(lastRequest!.url, "https://aig.example.com/v1/chat/completions");
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer broker-key");
    const body = JSON.parse(await lastRequest!.text()) as Record<string, unknown>;
    // Model id passes through unchanged — no workers-ai/ prefix.
    assert.strictEqual(body.model, "@cf/moonshotai/kimi-k2.6");
    assert.deepStrictEqual(body.stream_options, { include_usage: true });
  });

  it("wins over gateway / BYOK / unified-billing config and sends no cf-aig-* headers", async () => {
    for await (const _ of runKimi({
      accountId: "acct",
      apiToken: "cf-token",
      model: "anthropic/claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }],
      gateway: { id: "gw", cacheTtl: 60, metadata: { feature: "chat" } },
      providerKeys: { anthropic: "sk-ant-should-not-leak" },
      providerKeyAliases: { anthropic: "alias-should-not-leak" },
      unifiedBilling: true,
      customEndpoint: { baseUrl: "https://aig.example.com/v1", apiKey: "broker-key" },
    })) {
      /* drain */
    }
    assert.ok(lastRequest);
    assert.strictEqual(lastRequest!.url, "https://aig.example.com/v1/chat/completions");
    // The broker bearer replaces the Cloudflare token — never both.
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer broker-key");
    assert.strictEqual(lastRequest!.headers.get("cf-aig-authorization"), null);
    assert.strictEqual(lastRequest!.headers.get("cf-aig-byok-alias"), null);
    assert.strictEqual(lastRequest!.headers.get("cf-aig-gateway-id"), null);
    assert.strictEqual(lastRequest!.headers.get("cf-aig-cache-ttl"), null);
    assert.strictEqual(lastRequest!.headers.get("cf-aig-metadata"), null);
  });

  it("accepts model ids the Cloudflare paths would reject (host gateway owns dispatch)", async () => {
    for await (const _ of runKimi({
      accountId: "",
      apiToken: "",
      model: "my-broker-alias", // no @cf/ or provider/ shape
      messages: [{ role: "user", content: "hi" }],
      customEndpoint: { baseUrl: "https://aig.example.com/v1", apiKey: "broker-key" },
    })) {
      /* drain */
    }
    const body = JSON.parse(await lastRequest!.text()) as Record<string, unknown>;
    assert.strictEqual(body.model, "my-broker-alias");
  });

  it("omits the Authorization header entirely when no apiKey is configured", async () => {
    for await (const _ of runKimi({
      accountId: "",
      apiToken: "",
      model: "@cf/moonshotai/kimi-k2.6",
      messages: [{ role: "user", content: "hi" }],
      customEndpoint: { baseUrl: "http://127.0.0.1:11434/v1" },
    })) {
      /* drain */
    }
    assert.strictEqual(lastRequest!.headers.get("Authorization"), null);
  });

  it("does not double /chat/completions when the base already includes it", async () => {
    for await (const _ of runKimi({
      accountId: "",
      apiToken: "",
      model: "@cf/moonshotai/kimi-k2.6",
      messages: [{ role: "user", content: "hi" }],
      customEndpoint: { baseUrl: "https://aig.example.com/v1/chat/completions", apiKey: "k" },
    })) {
      /* drain */
    }
    assert.strictEqual(lastRequest!.url, "https://aig.example.com/v1/chat/completions");
  });

  it("falls back to KIMIFLARE_BASE_URL / KIMIFLARE_API_KEY from the environment", async () => {
    process.env.KIMIFLARE_BASE_URL = "https://env.example.com/v1";
    process.env.KIMIFLARE_API_KEY = "env-key";
    for await (const _ of runKimi({
      accountId: "acct",
      apiToken: "cf-token",
      model: "@cf/moonshotai/kimi-k2.6",
      messages: [{ role: "user", content: "hi" }],
      gateway: { id: "gw" },
    })) {
      /* drain */
    }
    assert.strictEqual(lastRequest!.url, "https://env.example.com/v1/chat/completions");
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer env-key");
    assert.strictEqual(lastRequest!.headers.get("cf-aig-gateway-id"), null);
  });

  it("wins over cloud mode and does not demand a cloud token", async () => {
    // Without a custom endpoint this combination throws before any fetch.
    for await (const _ of runKimi({
      accountId: "",
      apiToken: "",
      model: "moonshotai/kimi-k3",
      messages: [{ role: "user", content: "hi" }],
      cloudMode: true,
      customEndpoint: { baseUrl: "https://aig.example.com/v1", apiKey: "broker-key" },
    })) {
      /* drain */
    }
    assert.strictEqual(lastRequest!.url, "https://aig.example.com/v1/chat/completions");
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer broker-key");
    // Body still carries the model verbatim (cloud shape would omit it).
    const body = JSON.parse(await lastRequest!.text()) as Record<string, unknown>;
    assert.strictEqual(body.model, "moonshotai/kimi-k3");
  });

  it("rejects an empty model id", async () => {
    await assert.rejects(async () => {
      for await (const _ of runKimi({
        accountId: "",
        apiToken: "",
        model: "",
        messages: [{ role: "user", content: "hi" }],
        customEndpoint: { baseUrl: "https://aig.example.com/v1", apiKey: "k" },
      })) {
        /* drain */
      }
    }, /Invalid model ID/);
  });
});
