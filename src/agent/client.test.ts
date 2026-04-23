import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { runKimi } from "./client.js";

describe("runKimi session affinity header", () => {
  let originalFetch: typeof globalThis.fetch;
  let lastRequest: Request | null = null;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      lastRequest = new Request(input, init);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends X-Session-ID header when sessionId is provided", async () => {
    const gen = runKimi({
      accountId: "test",
      apiToken: "token",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      sessionId: "sess-123",
    });
    // exhaust generator
    for await (const _ of gen) {
      /* noop */
    }
    assert.ok(lastRequest);
    assert.strictEqual(lastRequest!.headers.get("X-Session-ID"), "sess-123");
  });

  it("does not send X-Session-ID header when sessionId is omitted", async () => {
    const gen = runKimi({
      accountId: "test",
      apiToken: "token",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    for await (const _ of gen) {
      /* noop */
    }
    assert.ok(lastRequest);
    assert.strictEqual(lastRequest!.headers.get("X-Session-ID"), null);
  });
});
