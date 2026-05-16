import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  initOtelSink,
  isOtelEnabled,
  enqueueOtelLog,
  flushOtelSink,
  getOtelDropCount,
  getOtelQueueSize,
  resetOtelSinkForTesting,
  setFetchForTesting,
  buildOtlpPayload,
} from "./otel-sink.js";
import type { LogEntry } from "./logger.js";

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

let captured: CapturedRequest[] = [];

beforeEach(() => {
  resetOtelSinkForTesting();
  captured = [];
});

afterEach(() => {
  setFetchForTesting(null);
});

function mockFetch(status = 200): void {
  setFetchForTesting(async (url, init) => {
    captured.push({ url, init });
    return new Response("ok", { status });
  });
}

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    ts: "2026-05-17T10:00:00.000Z",
    level: "info",
    event: "tool:end",
    data: { duration_ms: 42, tool: "bash" },
    ...overrides,
  };
}

describe("initOtelSink", () => {
  it("returns false when no endpoint is configured", () => {
    assert.strictEqual(initOtelSink({}), false);
    assert.strictEqual(isOtelEnabled(), false);
  });

  it("returns true when endpoint is provided", () => {
    assert.strictEqual(initOtelSink({ endpoint: "https://otel.example.com" }), true);
    assert.strictEqual(isOtelEnabled(), true);
  });

  it("appends /v1/logs to a base URL", () => {
    mockFetch();
    initOtelSink({ endpoint: "https://otel.example.com" });
    enqueueOtelLog(entry());
    return flushOtelSink().then(() => {
      assert.strictEqual(captured[0]!.url, "https://otel.example.com/v1/logs");
    });
  });

  it("leaves a path-qualified URL alone", () => {
    mockFetch();
    initOtelSink({ endpoint: "https://otel.example.com/v1/logs" });
    enqueueOtelLog(entry());
    return flushOtelSink().then(() => {
      assert.strictEqual(captured[0]!.url, "https://otel.example.com/v1/logs");
    });
  });

  it("strips trailing slashes from the base URL", () => {
    mockFetch();
    initOtelSink({ endpoint: "https://otel.example.com///" });
    enqueueOtelLog(entry());
    return flushOtelSink().then(() => {
      assert.strictEqual(captured[0]!.url, "https://otel.example.com/v1/logs");
    });
  });

  it("parses comma-separated headers", () => {
    mockFetch();
    initOtelSink({
      endpoint: "https://otel.example.com",
      headers: "Authorization=Bearer xyz, X-Tenant=acme",
    });
    enqueueOtelLog(entry());
    return flushOtelSink().then(() => {
      const headers = captured[0]!.init.headers as Record<string, string>;
      assert.strictEqual(headers["Authorization"], "Bearer xyz");
      assert.strictEqual(headers["X-Tenant"], "acme");
    });
  });

  it("skips malformed header pairs without crashing", () => {
    initOtelSink({
      endpoint: "https://otel.example.com",
      headers: "ValidKey=ok, =missingKey, missingValue=, ,bad",
    });
    // No assertion needed — must not throw.
    assert.strictEqual(isOtelEnabled(), true);
  });
});

describe("enqueueOtelLog", () => {
  it("is a no-op when no endpoint is configured", () => {
    enqueueOtelLog(entry());
    assert.strictEqual(getOtelQueueSize(), 0);
  });

  it("queues entries when active", () => {
    initOtelSink({ endpoint: "https://otel.example.com" });
    enqueueOtelLog(entry());
    enqueueOtelLog(entry({ event: "tool:start" }));
    assert.strictEqual(getOtelQueueSize(), 2);
  });

  it("auto-flushes when the batch hits BATCH_MAX (100)", async () => {
    mockFetch();
    initOtelSink({ endpoint: "https://otel.example.com" });
    for (let i = 0; i < 100; i++) enqueueOtelLog(entry());
    // The auto-flush is fire-and-forget; await any in-flight.
    await flushOtelSink();
    assert.strictEqual(captured.length, 1);
    const body = JSON.parse(captured[0]!.init.body as string);
    assert.strictEqual(body.resourceLogs[0].scopeLogs[0].logRecords.length, 100);
    assert.strictEqual(getOtelQueueSize(), 0);
  });
});

describe("flushOtelSink", () => {
  it("does nothing on an empty queue", async () => {
    mockFetch();
    initOtelSink({ endpoint: "https://otel.example.com" });
    await flushOtelSink();
    assert.strictEqual(captured.length, 0);
  });

  it("ships a single batch", async () => {
    mockFetch();
    initOtelSink({ endpoint: "https://otel.example.com" });
    enqueueOtelLog(entry());
    enqueueOtelLog(entry({ event: "tool:start", level: "debug" }));
    await flushOtelSink();
    assert.strictEqual(captured.length, 1);
    const body = JSON.parse(captured[0]!.init.body as string);
    const records = body.resourceLogs[0].scopeLogs[0].logRecords;
    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].severityText, "INFO");
    assert.strictEqual(records[1].severityText, "DEBUG");
  });

  it("increments drop count on HTTP failure (5xx)", async () => {
    mockFetch(500);
    initOtelSink({ endpoint: "https://otel.example.com" });
    enqueueOtelLog(entry());
    enqueueOtelLog(entry());
    await flushOtelSink();
    assert.strictEqual(getOtelDropCount(), 2);
  });

  it("increments drop count when fetch throws", async () => {
    setFetchForTesting(async () => {
      throw new Error("ECONNREFUSED");
    });
    initOtelSink({ endpoint: "https://otel.example.com" });
    enqueueOtelLog(entry());
    await flushOtelSink();
    assert.strictEqual(getOtelDropCount(), 1);
  });

  it("clears the queue but no-ops when endpoint became unset", async () => {
    initOtelSink({ endpoint: "https://otel.example.com" });
    enqueueOtelLog(entry());
    assert.strictEqual(getOtelQueueSize(), 1);
    resetOtelSinkForTesting();
    await flushOtelSink();
    assert.strictEqual(getOtelQueueSize(), 0);
  });
});

describe("buildOtlpPayload — schema", () => {
  const cfg = {
    endpoint: "https://otel.example.com/v1/logs",
    headers: {},
    serviceName: "kimiflare",
    serviceVersion: "0.69.0",
  };

  it("emits a single resourceLogs entry with service.name + service.version", () => {
    const payload = buildOtlpPayload([entry()], cfg) as {
      resourceLogs: { resource: { attributes: { key: string; value: { stringValue: string } }[] } }[];
    };
    const attrs = payload.resourceLogs[0]!.resource.attributes;
    const byKey = Object.fromEntries(attrs.map((a) => [a.key, a.value.stringValue]));
    assert.strictEqual(byKey["service.name"], "kimiflare");
    assert.strictEqual(byKey["service.version"], "0.69.0");
  });

  it("lifts session_id / turn_id / request_id to record attributes", () => {
    const e = entry({
      session_id: "sess_a",
      turn_id: "turn_3",
      request_id: "req_xyz",
    });
    const payload = buildOtlpPayload([e], cfg) as {
      resourceLogs: { scopeLogs: { logRecords: { attributes: { key: string; value: { stringValue: string } }[] }[] }[] }[];
    };
    const recordAttrs = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes;
    const byKey = Object.fromEntries(recordAttrs.map((a) => [a.key, a.value.stringValue]));
    assert.strictEqual(byKey["session_id"], "sess_a");
    assert.strictEqual(byKey["turn_id"], "turn_3");
    assert.strictEqual(byKey["request_id"], "req_xyz");
  });

  it("flattens data fields into record attributes with type coercion", () => {
    const e = entry({
      data: { duration_ms: 42, tool: "bash", ok: true, nested: { a: 1 } },
    });
    const payload = buildOtlpPayload([e], cfg) as {
      resourceLogs: { scopeLogs: { logRecords: { attributes: { key: string; value: Record<string, unknown> }[] }[] }[] }[];
    };
    const recordAttrs = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes;
    const byKey = Object.fromEntries(recordAttrs.map((a) => [a.key, a.value]));
    assert.deepStrictEqual(byKey["duration_ms"], { intValue: "42" });
    assert.deepStrictEqual(byKey["tool"], { stringValue: "bash" });
    assert.deepStrictEqual(byKey["ok"], { boolValue: true });
    // Nested objects get JSON-stringified to keep them shippable.
    assert.strictEqual(
      (byKey["nested"] as { stringValue: string }).stringValue,
      '{"a":1}',
    );
  });

  it("does not duplicate request_id under data attributes", () => {
    const e = entry({
      request_id: "req_xyz",
      data: { request_id: "req_xyz", tool: "bash" },
    });
    const payload = buildOtlpPayload([e], cfg) as {
      resourceLogs: { scopeLogs: { logRecords: { attributes: { key: string }[] }[] }[] }[];
    };
    const keys = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes.map((a) => a.key);
    const requestIdCount = keys.filter((k) => k === "request_id").length;
    assert.strictEqual(requestIdCount, 1);
  });

  it("encodes timestamps as nanoseconds since epoch", () => {
    const e = entry({ ts: "2026-05-17T10:00:00.000Z" });
    const payload = buildOtlpPayload([e], cfg) as {
      resourceLogs: { scopeLogs: { logRecords: { timeUnixNano: string }[] }[] }[];
    };
    const expectedMs = new Date("2026-05-17T10:00:00.000Z").getTime();
    const expectedNs = String(BigInt(expectedMs) * 1_000_000n);
    assert.strictEqual(
      payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.timeUnixNano,
      expectedNs,
    );
  });

  it("maps log levels to OTel severity numbers", () => {
    const entries: LogEntry[] = [
      entry({ level: "debug" }),
      entry({ level: "info" }),
      entry({ level: "warn" }),
      entry({ level: "error" }),
    ];
    const payload = buildOtlpPayload(entries, cfg) as {
      resourceLogs: { scopeLogs: { logRecords: { severityNumber: number; severityText: string }[] }[] }[];
    };
    const records = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords;
    assert.strictEqual(records[0]!.severityNumber, 5);
    assert.strictEqual(records[0]!.severityText, "DEBUG");
    assert.strictEqual(records[1]!.severityNumber, 9);
    assert.strictEqual(records[2]!.severityNumber, 13);
    assert.strictEqual(records[3]!.severityNumber, 17);
  });
});
