import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { callWorkerEndpoint } from "./spawn-worker.js";
import type { WorkerResultMessage } from "../agent/messages.js";

const realFetch = globalThis.fetch;

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const sample: WorkerResultMessage = {
  workerId: "w1",
  status: "completed",
  task: "research",
  findings: [],
  recommendations: [],
  filesRead: [],
  webSources: [],
  costUsd: 0,
  tokensUsed: 0,
  reasoning: "",
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("callWorkerEndpoint", () => {
  it("parses a successful response", async () => {
    globalThis.fetch = (async () => mockResponse(200, sample)) as typeof fetch;
    const out = await callWorkerEndpoint("http://x", undefined, { task: "research" });
    assert.strictEqual(out.workerId, "w1");
  });

  it("retries once on 5xx and succeeds on the second attempt", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1 ? mockResponse(503, "down") : mockResponse(200, sample);
    }) as typeof fetch;
    const out = await callWorkerEndpoint("http://x", undefined, {});
    assert.strictEqual(calls, 2);
    assert.strictEqual(out.workerId, "w1");
  });

  it("throws when both attempts return 5xx", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return mockResponse(500, "boom");
    }) as typeof fetch;
    await assert.rejects(() => callWorkerEndpoint("http://x", undefined, {}), /500/);
    assert.strictEqual(calls, 2);
  });

  it("does not retry on a 4xx error", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return mockResponse(400, "bad request");
    }) as typeof fetch;
    await assert.rejects(() => callWorkerEndpoint("http://x", undefined, {}), /400/);
    assert.strictEqual(calls, 1);
  });

  it("sends the API key header when provided", async () => {
    let seenHeaders: Record<string, string> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seenHeaders = init.headers as Record<string, string>;
      return mockResponse(200, sample);
    }) as unknown as typeof fetch;
    await callWorkerEndpoint("http://x", "secret-key", {});
    assert.strictEqual(seenHeaders["X-Worker-Api-Key"], "secret-key");
  });
});
