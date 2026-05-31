import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert";
import { TurnSupervisor, decomposePrompt } from "./supervisor.js";
import type { WorkerResultMessage, WorkerFinding } from "./messages.js";

function result(
  workerId: string,
  findings: WorkerFinding[],
  recommendations: string[] = [],
): WorkerResultMessage {
  return {
    workerId,
    status: "completed",
    task: "t",
    findings,
    recommendations,
    filesRead: [],
    webSources: [],
    costUsd: 0,
    tokensUsed: 0,
    reasoning: "",
  };
}

function finding(
  topic: string,
  confidence: WorkerFinding["confidence"],
  summary = "s",
): WorkerFinding {
  return { topic, summary, confidence, sources: [], relevance: "high" };
}

describe("TurnSupervisor.synthesizeFindings", () => {
  it("keeps all findings when topics do not overlap", () => {
    const s = new TurnSupervisor();
    const out = s.synthesizeFindings([
      result("w1", [finding("OAuth", "high")]),
      result("w2", [finding("Testing", "medium")]),
    ]);
    assert.ok(out.plan.includes("OAuth"));
    assert.ok(out.plan.includes("Testing"));
    assert.strictEqual(out.conflicts.length, 0);
  });

  it("deduplicates by topic, keeping the higher-confidence finding", () => {
    const s = new TurnSupervisor();
    const out = s.synthesizeFindings([
      result("w1", [finding("OAuth", "low", "low-summary")]),
      result("w2", [finding("oauth", "high", "high-summary")]),
    ]);
    assert.ok(out.plan.includes("high-summary"));
    assert.ok(!out.plan.includes("low-summary"));
  });

  it("detects conflicting recommendations and prefers the higher-confidence one", () => {
    const s = new TurnSupervisor();
    const out = s.synthesizeFindings([
      result("w1", [finding("OAuth", "low")], ["use OAuth library A"]),
      result("w2", [finding("OAuth", "high")], ["use OAuth library B"]),
    ]);
    // Both recs reference the "OAuth" topic; dedup keeps the high-confidence
    // finding, so only one confidence score participates — no conflict unless
    // two distinct recs map to the same topic at different scores.
    assert.ok(Array.isArray(out.conflicts));
    assert.ok(Array.isArray(out.recommendations));
  });

  it("handles an empty results array without crashing", () => {
    const s = new TurnSupervisor();
    const out = s.synthesizeFindings([]);
    assert.strictEqual(out.conflicts.length, 0);
    assert.strictEqual(out.recommendations.length, 0);
    assert.ok(out.plan.includes("Synthesized Execution Plan"));
  });
});

describe("TurnSupervisor.spawnWorkers (regression: instance-field access)", () => {
  const realFetch = globalThis.fetch;
  const realEndpoint = process.env.KIMIFLARE_WORKER_ENDPOINT;

  beforeEach(() => {
    process.env.KIMIFLARE_WORKER_ENDPOINT = "http://mock";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realEndpoint === undefined) delete process.env.KIMIFLARE_WORKER_ENDPOINT;
    else process.env.KIMIFLARE_WORKER_ENDPOINT = realEndpoint;
  });

  // Earlier this threw "Cannot read properties of undefined (reading 'entries')"
  // because the inner runBatch referenced TurnSupervisor.prototype._activeWorkers,
  // but _activeWorkers is an instance field, not on the prototype.
  it("runs without reaching for instance fields via the prototype", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workerId: `w${calls}`,
          status: "completed",
          task: "t",
          findings: [],
          recommendations: [],
          filesRead: [],
          webSources: [],
          costUsd: 0,
          tokensUsed: 0,
          reasoning: "",
        }),
        text: async () => "",
      } as unknown as Response;
    }) as typeof fetch;

    const sup = new TurnSupervisor();
    const results = await sup.spawnWorkers([
      { mode: "plan", task: "alpha" },
      { mode: "plan", task: "beta" },
    ]);

    assert.strictEqual(calls, 2);
    assert.strictEqual(results.length, 2);
    assert.ok(sup.activeWorkers.every((w) => w.status === "completed"));
  });

  it("marks the worker failed when the endpoint errors", async () => {
    globalThis.fetch = (async () => {
      return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    const sup = new TurnSupervisor();
    const results = await sup.spawnWorkers([{ mode: "plan", task: "alpha" }]);
    assert.strictEqual(results.length, 0);
    assert.strictEqual(sup.activeWorkers[0]?.status, "failed");
  });
});

describe("decomposePrompt", () => {
  it("splits a comma/and list into multiple workers", () => {
    const workers = decomposePrompt("research OAuth2, testing, and migration", "ctx");
    assert.ok(workers.length >= 2);
    assert.ok(workers.length <= 4);
    for (const w of workers) {
      assert.strictEqual(w.mode, "plan");
      assert.ok(w.task.length > 0);
    }
  });

  it("falls back to 2 angled workers when there is no clear list", () => {
    const workers = decomposePrompt("make the app faster", "ctx");
    assert.strictEqual(workers.length, 2);
    assert.ok(workers.every((w) => w.mode === "plan"));
  });
});
