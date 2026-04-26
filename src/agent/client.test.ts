import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { runKimi } from "./client.js";

describe("runKimi session affinity header", () => {
  let originalFetch: typeof globalThis.fetch;
  let lastRequest: Request | null = null;
  let responseHeaders: Record<string, string> = { "content-type": "text/event-stream" };

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      lastRequest = new Request(input, init);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: responseHeaders,
      });
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends X-Session-ID and x-session-affinity headers when sessionId is provided", async () => {
    const gen = runKimi({
      accountId: "test",
      apiToken: "token",
      model: "@cf/test/model",
      messages: [{ role: "user", content: "hi" }],
      sessionId: "sess-123",
    });
    // exhaust generator
    for await (const _ of gen) {
      /* noop */
    }
    assert.ok(lastRequest);
    assert.strictEqual(lastRequest!.headers.get("X-Session-ID"), "sess-123");
    assert.strictEqual(lastRequest!.headers.get("x-session-affinity"), "sess-123");
  });

  it("does not send session headers when sessionId is omitted", async () => {
    const gen = runKimi({
      accountId: "test",
      apiToken: "token",
      model: "@cf/test/model",
      messages: [{ role: "user", content: "hi" }],
    });
    for await (const _ of gen) {
      /* noop */
    }
    assert.ok(lastRequest);
    assert.strictEqual(lastRequest!.headers.get("X-Session-ID"), null);
    assert.strictEqual(lastRequest!.headers.get("x-session-affinity"), null);
  });

  it("uses the direct Workers AI endpoint by default", async () => {
    const gen = runKimi({
      accountId: "acct",
      apiToken: "token",
      model: "@cf/test/model",
      messages: [{ role: "user", content: "hi" }],
    });
    for await (const _ of gen) {
      /* noop */
    }
    assert.ok(lastRequest);
    assert.strictEqual(
      lastRequest!.url,
      "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/test/model",
    );
  });

  it("routes through native AI Gateway when configured", async () => {
    const gen = runKimi({
      accountId: "acct",
      apiToken: "token",
      model: "@cf/test/model",
      messages: [{ role: "user", content: "hi" }],
      gateway: {
        id: "my-gateway",
        cacheTtl: 3600,
        skipCache: false,
        collectLogPayload: false,
        metadata: { team: "cli", test: true },
      },
    });
    for await (const _ of gen) {
      /* noop */
    }
    assert.ok(lastRequest);
    assert.strictEqual(
      lastRequest!.url,
      "https://gateway.ai.cloudflare.com/v1/acct/my-gateway/workers-ai/@cf/test/model",
    );
    assert.strictEqual(lastRequest!.headers.get("cf-aig-cache-ttl"), "3600");
    assert.strictEqual(lastRequest!.headers.get("cf-aig-skip-cache"), "false");
    assert.strictEqual(lastRequest!.headers.get("cf-aig-collect-log-payload"), "false");
    assert.strictEqual(
      lastRequest!.headers.get("cf-aig-metadata"),
      '{"team":"cli","test":true}',
    );
  });

  it("emits gateway metadata from response headers", async () => {
    responseHeaders = {
      "content-type": "text/event-stream",
      "cf-aig-cache-status": "HIT",
      "cf-aig-log-id": "log_123",
      "cf-aig-event-id": "evt_123",
      "cf-aig-model": "@cf/test/model",
    };
    const events: unknown[] = [];
    const gen = runKimi({
      accountId: "acct",
      apiToken: "token",
      model: "@cf/test/model",
      messages: [{ role: "user", content: "hi" }],
      gateway: { id: "my-gateway" },
    });
    for await (const ev of gen) {
      events.push(ev);
    }
    assert.deepStrictEqual(events[0], {
      type: "gateway_meta",
      meta: {
        cacheStatus: "HIT",
        logId: "log_123",
        eventId: "evt_123",
        model: "@cf/test/model",
      },
    });
    responseHeaders = { "content-type": "text/event-stream" };
  });
});
