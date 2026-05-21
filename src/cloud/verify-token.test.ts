import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { verifyApiTokenForWorkersAi } from "./verify-token.js";

interface Stub {
  url: string;
  status: number;
  body: unknown;
}

describe("verifyApiTokenForWorkersAi", () => {
  let originalFetch: typeof globalThis.fetch;
  let stubs: Stub[] = [];
  const calls: string[] = [];

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
      calls.push(url);
      const stub = stubs.find((s) => url.includes(s.url));
      if (!stub) throw new Error(`unstubbed fetch: ${url}`);
      return new Response(JSON.stringify(stub.body), {
        status: stub.status,
        headers: { "content-type": "application/json" },
      });
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    stubs = [];
    calls.length = 0;
  });

  it("returns ok when /tokens/verify is active and the Workers AI probe succeeds (no gateway)", async () => {
    stubs = [
      { url: "/user/tokens/verify", status: 200, body: { success: true, result: { status: "active" } } },
      { url: "api.cloudflare.com/client/v4/accounts/acct/ai/run/", status: 200, body: { result: { data: [[0]] }, success: true } },
    ];
    const r = await verifyApiTokenForWorkersAi("acct", "tok");
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(calls.length, 2);
  });

  it("returns ok when /tokens/verify + direct probe + gateway probe all succeed", async () => {
    stubs = [
      { url: "/user/tokens/verify", status: 200, body: { success: true, result: { status: "active" } } },
      { url: "api.cloudflare.com/client/v4/accounts/acct/ai/run/", status: 200, body: { result: { data: [[0]] }, success: true } },
      { url: "gateway.ai.cloudflare.com", status: 200, body: { result: { data: [[0]] }, success: true } },
    ];
    const r = await verifyApiTokenForWorkersAi("acct", "tok", "gw-1");
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(calls.length, 3);
  });

  it("returns reason=authenticated-gateway when direct succeeds but gateway 401s", async () => {
    stubs = [
      { url: "/user/tokens/verify", status: 200, body: { success: true, result: { status: "active" } } },
      { url: "api.cloudflare.com/client/v4/accounts/acct/ai/run/", status: 200, body: { result: { data: [[0]] }, success: true } },
      { url: "gateway.ai.cloudflare.com", status: 401, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } },
    ];
    const r = await verifyApiTokenForWorkersAi("acct", "tok", "gw-1");
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.reason, "authenticated-gateway");
  });

  it("returns reason=invalid when /tokens/verify rejects the token", async () => {
    stubs = [
      {
        url: "/user/tokens/verify",
        status: 401,
        body: { success: false, errors: [{ message: "Invalid API Token" }] },
      },
    ];
    const r = await verifyApiTokenForWorkersAi("acct", "bad");
    assert.strictEqual(r.ok, false);
    if (!r.ok) {
      assert.strictEqual(r.reason, "invalid");
      assert.match(r.message, /Invalid API Token/);
    }
    // Should NOT probe Workers AI when verify already failed.
    assert.strictEqual(calls.length, 1);
  });

  it("returns reason=missing-workers-ai-scope when verify passes but probe 403s", async () => {
    stubs = [
      { url: "/user/tokens/verify", status: 200, body: { success: true, result: { status: "active" } } },
      {
        url: "/ai/run/",
        status: 403,
        body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
      },
    ];
    const r = await verifyApiTokenForWorkersAi("acct", "tok");
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.reason, "missing-workers-ai-scope");
  });

  it("returns reason=invalid when /tokens/verify reports status != active", async () => {
    stubs = [
      {
        url: "/user/tokens/verify",
        status: 200,
        body: { success: true, result: { status: "disabled" } },
      },
    ];
    const r = await verifyApiTokenForWorkersAi("acct", "tok");
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.reason, "invalid");
  });
});
