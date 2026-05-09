import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchGatewayUsageSnapshot, getCostReport, recordUsage } from "../usage-tracker.js";

describe("AI Gateway usage enrichment", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalXdgDataHome: string | undefined;
  let lastRequest: Request | null = null;

  before(() => {
    originalFetch = globalThis.fetch;
    originalXdgDataHome = process.env.XDG_DATA_HOME;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      lastRequest = new Request(input, init);
      return Response.json({
        result: [
          {
            id: "log_123",
            cached: true,
            duration: 42,
            model: "@cf/test/model",
            provider: "workers-ai",
            status_code: 200,
            tokens_in: 10,
            tokens_out: 2,
            cost: 0.00001,
          },
        ],
      });
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
    if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalXdgDataHome;
  });

  it("fetches a gateway log by cf-aig-log-id", async () => {
    const snapshot = await fetchGatewayUsageSnapshot({
      accountId: "acct",
      apiToken: "token",
      gatewayId: "gateway",
      meta: { logId: "log_123", cacheStatus: "HIT", eventId: "evt_123" },
    });

    assert.ok(lastRequest);
    assert.strictEqual(
      lastRequest!.url,
      "https://api.cloudflare.com/client/v4/accounts/acct/ai-gateway/gateways/gateway/logs",
    );
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer token");
    assert.deepStrictEqual(snapshot, {
      logId: "log_123",
      eventId: "evt_123",
      cacheStatus: "HIT",
      cached: true,
      duration: 42,
      statusCode: 200,
      model: "@cf/test/model",
      provider: "workers-ai",
      tokensIn: 10,
      tokensOut: 2,
      cost: 0.00001,
    });
  });

  it("records local usage with gateway metadata as best-effort enrichment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kimiflare-usage-"));
    process.env.XDG_DATA_HOME = dir;
    try {
      await recordUsage(
        "session_1",
        {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
          prompt_tokens_details: { cached_tokens: 0 },
        },
        {
          accountId: "acct",
          apiToken: "token",
          gatewayId: "gateway",
          meta: { logId: "log_123", cacheStatus: "HIT" },
        },
      );

      const report = await getCostReport("session_1");
      assert.strictEqual(report.session.promptTokens, 10);
      assert.strictEqual(report.session.completionTokens, 2);
      assert.strictEqual(report.session.gatewayRequests, 1);
      assert.strictEqual(report.session.gatewayCachedRequests, 1);
      assert.strictEqual(report.session.gatewayCost, 0.00001);
      assert.strictEqual(report.session.cost, 0.00001);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Persistent history.jsonl", () => {
  let originalXdgDataHome: string | undefined;

  before(() => {
    originalXdgDataHome = process.env.XDG_DATA_HOME;
  });

  after(() => {
    if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalXdgDataHome;
  });

  it("writes daily usage to history.jsonl on recordUsage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kimiflare-history-"));
    process.env.XDG_DATA_HOME = dir;
    try {
      await recordUsage(
        "session_a",
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 10 },
        },
        undefined,
      );

      const historyRaw = await readFile(join(dir, "kimiflare", "history.jsonl"), "utf8");
      const lines = historyRaw.trim().split("\n");
      assert.strictEqual(lines.length, 1);
      assert.ok(lines[0]);
      const entry = JSON.parse(lines[0]);
      assert.strictEqual(entry.promptTokens, 100);
      assert.strictEqual(entry.completionTokens, 50);
      assert.strictEqual(entry.cachedTokens, 10);
      assert.ok(entry.date);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deduplicates same-day entries in history.jsonl", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kimiflare-history-"));
    process.env.XDG_DATA_HOME = dir;
    try {
      await recordUsage(
        "session_a",
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 0 },
        },
        undefined,
      );
      await recordUsage(
        "session_a",
        {
          prompt_tokens: 200,
          completion_tokens: 100,
          total_tokens: 300,
          prompt_tokens_details: { cached_tokens: 0 },
        },
        undefined,
      );

      const historyRaw = await readFile(join(dir, "kimiflare", "history.jsonl"), "utf8");
      const lines = historyRaw.trim().split("\n");
      assert.strictEqual(lines.length, 1);
      assert.ok(lines[0]);
      const entry = JSON.parse(lines[0]);
      assert.strictEqual(entry.promptTokens, 300);
      assert.strictEqual(entry.completionTokens, 150);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("includes history data in allTime and month totals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kimiflare-history-"));
    process.env.XDG_DATA_HOME = dir;
    try {
      // Seed history with an old day
      const historyDir = join(dir, "kimiflare");
      await mkdir(historyDir, { recursive: true });
      const historyPath = join(historyDir, "history.jsonl");
      await writeFile(
        historyPath,
        JSON.stringify({
          date: "2025-01-01",
          promptTokens: 1000,
          completionTokens: 500,
          cachedTokens: 100,
          cost: 0.5,
        }) + "\n",
        "utf8",
      );

      // Record usage for today
      await recordUsage(
        "session_b",
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 0 },
        },
        undefined,
      );

      const report = await getCostReport("session_b");
      // Today's session should only reflect today's usage
      assert.strictEqual(report.session.promptTokens, 100);
      // All time should include the old history entry
      assert.strictEqual(report.allTime.promptTokens, 1100);
      assert.strictEqual(report.allTime.completionTokens, 550);
      assert.strictEqual(report.allTime.cost, 0.5 + report.today.cost);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("gives usage.json precedence over history for overlapping dates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kimiflare-history-"));
    process.env.XDG_DATA_HOME = dir;
    try {
      const today = new Date().toISOString().slice(0, 10);

      // Seed history with today's data (simulating stale data)
      const historyDir = join(dir, "kimiflare");
      await mkdir(historyDir, { recursive: true });
      const historyPath = join(historyDir, "history.jsonl");
      await writeFile(
        historyPath,
        JSON.stringify({
          date: today,
          promptTokens: 9999,
          completionTokens: 9999,
          cachedTokens: 0,
          cost: 9.99,
        }) + "\n",
        "utf8",
      );

      // Record fresh usage for today
      await recordUsage(
        "session_c",
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 0 },
        },
        undefined,
      );

      const report = await getCostReport("session_c");
      // Today's total should reflect the fresh usage.json data, not stale history
      assert.strictEqual(report.today.promptTokens, 100);
      assert.strictEqual(report.allTime.promptTokens, 100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
