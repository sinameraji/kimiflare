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
    });

    assert.strictEqual(payload.errorMessage, "Rate limit exceeded (HTTP 429)");
    assert.strictEqual(payload.httpStatus, 429);
    assert.strictEqual(payload.errorCode, 3040);
    assert.strictEqual(payload.sessionId, "test-session-123");
    assert.strictEqual(payload.userNote, "happened during a long conversation");
    assert.ok(payload.reportId);
    assert.ok(payload.version);
    assert.ok(payload.platform);
    assert.ok(payload.nodeVersion);
    assert.ok(Array.isArray(payload.recentLogs));
  });

  it("builds a payload without optional fields", () => {
    const payload = buildReport({
      errorMessage: "Something went wrong",
    });

    assert.strictEqual(payload.errorMessage, "Something went wrong");
    assert.strictEqual(payload.httpStatus, undefined);
    assert.strictEqual(payload.errorCode, undefined);
    assert.strictEqual(payload.sessionId, undefined);
    assert.strictEqual(payload.userNote, undefined);
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
});
