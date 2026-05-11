import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { buildReport, sendReport, type ReportPayload } from "./report.js";
import { clearRecentLogs } from "../util/logger.js";

describe("buildReport", () => {
  before(() => {
    clearRecentLogs();
  });

  after(() => {
    clearRecentLogs();
  });

  it("builds a payload with all fields", () => {
    const payload = buildReport({
      errorMessage: "Rate limit exceeded (HTTP 429)",
      httpStatus: 429,
      errorCode: 3040,
      sessionId: "test-session-123",
      userNote: "happened during a long conversation",
      model: "@cf/moonshotai/kimi-k2.6",
      cloudMode: true,
    });

    assert.strictEqual(payload.error.message, "Rate limit exceeded (HTTP 429)");
    assert.strictEqual(payload.error.http_status, 429);
    assert.strictEqual(payload.error.code, 3040);
    assert.strictEqual(payload.context.session_id, "test-session-123");
    assert.strictEqual(payload.user_message, "happened during a long conversation");
    assert.strictEqual(payload.context.model, "@cf/moonshotai/kimi-k2.6");
    assert.strictEqual(payload.metadata.cloud_mode, true);
    assert.ok(payload.metadata.version);
    assert.ok(payload.metadata.platform);
    assert.ok(payload.metadata.node_version);
  });

  it("builds a payload without optional fields", () => {
    const payload = buildReport({
      errorMessage: "Something went wrong",
    });

    assert.strictEqual(payload.error.message, "Something went wrong");
    assert.strictEqual(payload.error.http_status, undefined);
    assert.strictEqual(payload.error.code, undefined);
    assert.strictEqual(payload.context.session_id, undefined);
    assert.strictEqual(payload.user_message, undefined);
    assert.strictEqual(payload.metadata.cloud_mode, false);
  });
});

describe("sendReport", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns ok on success", async () => {
    globalThis.fetch = async () =>
      new Response("OK", { status: 200 }) as unknown as ReturnType<typeof fetch>;

    const result = await sendReport({} as ReportPayload);
    assert.strictEqual(result.ok, true);
    assert.match(result.message, /Report sent/);
  });

  it("returns error on non-ok response", async () => {
    globalThis.fetch = async () =>
      new Response("bad request", { status: 400 }) as unknown as ReturnType<typeof fetch>;

    const result = await sendReport({} as ReportPayload);
    assert.strictEqual(result.ok, false);
    assert.match(result.message, /Failed to send report/);
  });

  it("returns error on fetch failure", async () => {
    globalThis.fetch = async () => {
      throw new Error("network error");
    };

    const result = await sendReport({} as ReportPayload);
    assert.strictEqual(result.ok, false);
    assert.match(result.message, /network error/);
  });

  it("sends Authorization header when token is provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (_input, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("OK", { status: 200 }) as unknown as ReturnType<typeof fetch>;
    };

    await sendReport({} as ReportPayload, "my-cloud-token");
    assert.strictEqual(capturedHeaders["Authorization"], "Bearer my-cloud-token");
  });
});
