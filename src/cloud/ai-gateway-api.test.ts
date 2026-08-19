import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { listGateways, createGateway, probeGateway, AiGatewayError } from "./ai-gateway-api.js";

describe("ai-gateway-api", () => {
  let originalFetch: typeof globalThis.fetch;
  let nextResponse: { status: number; body: unknown } = { status: 200, body: { result: [] } };
  let lastRequest: Request | null = null;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      lastRequest = new Request(input, init);
      return new Response(JSON.stringify(nextResponse.body), {
        status: nextResponse.status,
        headers: { "content-type": "application/json" },
      });
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("listGateways returns the result array", async () => {
    nextResponse = {
      status: 200,
      body: { result: [{ id: "gw-1" }, { id: "gw-2" }] },
    };
    const result = await listGateways("acct", "token");
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]!.id, "gw-1");
    assert.match(lastRequest!.url, /\/accounts\/acct\/ai-gateway\/gateways$/);
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer token");
  });

  it("listGateways throws AiGatewayError with kind=forbidden on 403", async () => {
    nextResponse = {
      status: 403,
      body: { errors: [{ message: "Missing AI Gateway:Read scope" }] },
    };
    await assert.rejects(
      () => listGateways("acct", "token"),
      (err: unknown) => {
        assert.ok(err instanceof AiGatewayError);
        assert.strictEqual(err.detail.kind, "forbidden");
        return true;
      },
    );
  });

  it("createGateway POSTs with cache_ttl=0 and collect_logs=true", async () => {
    nextResponse = {
      status: 200,
      body: { result: { id: "kimiflare", cache_ttl: 0, collect_logs: true } },
    };
    const gw = await createGateway("acct", "token", "kimiflare");
    assert.strictEqual(gw.id, "kimiflare");
    assert.strictEqual(lastRequest!.method, "POST");
    const body = JSON.parse(await lastRequest!.text()) as Record<string, unknown>;
    assert.strictEqual(body.id, "kimiflare");
    assert.strictEqual(body.cache_ttl, 0);
    assert.strictEqual(body.collect_logs, true);
  });

  it("probeGateway routes through the unified AI endpoint with cf-aig-gateway-id (works with OAuth tokens)", async () => {
    nextResponse = { status: 200, body: { result: { data: [[0.1]] }, success: true } };
    const r = await probeGateway("acct", "cfoat_token", "kimiflare");
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(
      lastRequest!.url,
      "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/baai/bge-base-en-v1.5",
    );
    assert.strictEqual(lastRequest!.headers.get("cf-aig-gateway-id"), "kimiflare");
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer cfoat_token");
  });

  it("probeGateway reports a missing gateway (HTTP 400 code 2001) and auth failures", async () => {
    nextResponse = { status: 400, body: { success: false, errors: [{ code: 2001, message: "Please configure AI Gateway in the Cloudflare dashboard" }] } };
    const missing = await probeGateway("acct", "tok", "nope");
    assert.strictEqual(missing.ok, false);
    assert.match((missing as { message: string }).message, /"nope" was not found/);

    nextResponse = { status: 401, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } };
    const denied = await probeGateway("acct", "tok", "kimiflare");
    assert.strictEqual(denied.ok, false);
    assert.match((denied as { message: string }).message, /Authentication error \(HTTP 401\)/);
  });
});
