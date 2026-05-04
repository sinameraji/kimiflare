import { describe, it } from "node:test";
import assert from "node:assert";
import { buildTelemetryEntry } from "./telemetry.js";
import type { ResearchPlan, ResearchResult } from "./types.js";

function makePlan(): ResearchPlan {
  return {
    version: 1,
    turnId: "turn-1",
    query: "how does auth work",
    repoFingerprint: "abc123",
    status: "done",
    budget: {
      maxCostUsd: 2.0,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 80_000,
      maxWallTimeMs: 8 * 60_000,
      maxFilesRead: 80,
      maxWaves: 3,
      maxWorkersPerWave: 2,
      partitions: { scout: 0.10, exploration: 0.65, synthesis: 0.15, emergency: 0.10 },
    },
    phases: [
      { phase: "scout", promptTokens: 1000, completionTokens: 500, totalTokens: 1500, cachedTokens: 200, costUsd: 0.01, durationMs: 1000 },
      { phase: "exploration", promptTokens: 5000, completionTokens: 2000, totalTokens: 7000, cachedTokens: 1000, costUsd: 0.05, durationMs: 5000 },
      { phase: "synthesis", promptTokens: 2000, completionTokens: 1000, totalTokens: 3000, cachedTokens: 500, costUsd: 0.02, durationMs: 2000 },
    ],
    tasks: [
      {
        id: "t1",
        question: "how does jwt work",
        description: "explore jwt",
        priority: 1,
        scope: {},
        dependencyIds: [],
        status: "done",
        budget: { maxTokens: 1000, maxToolCalls: 10, maxFilesRead: 5, consumedTokens: 100, consumedToolCalls: 2, consumedFilesRead: 3 },
      },
      {
        id: "t2",
        question: "how does oauth work",
        description: "explore oauth",
        priority: 2,
        scope: {},
        dependencyIds: [],
        status: "killed",
        killReason: "budget",
        budget: { maxTokens: 1000, maxToolCalls: 10, maxFilesRead: 5, consumedTokens: 0, consumedToolCalls: 0, consumedFilesRead: 0 },
      },
    ],
    findings: [
      {
        id: "f1",
        taskId: "t1",
        workerId: "w1",
        claim: "JWT is validated in middleware",
        evidence: [{ filePath: "src/auth.ts", lineRange: [10, 20], excerpt: "verify(token)" }],
        confidence: "high",
        createdAt: new Date().toISOString(),
      },
    ],
    fileLeases: [],
    openQuestions: [
      { id: "q1", question: "what about refresh tokens", critical: true, sourceTaskId: "t1", status: "open" },
    ],
    convergence: {
      score: 4,
      metrics: {
        budgetRemainingPct: 60,
        unresolvedCriticalQuestions: 1,
        findingsDeltaLastWave: 1,
        duplicateReadRate: 0.05,
        coverageChecklistPct: 50,
      },
      decision: "partial",
    },
    checkpoints: [{ wave: 1, timestamp: new Date().toISOString(), ledgerPath: "/tmp/ledger.json" }],
    notes: [{ timestamp: new Date().toISOString(), note: "scout complete" }],
  };
}

function makeResult(): ResearchResult {
  return {
    content: "Auth works via JWT middleware.",
    terminalState: "ANSWER_FOUND",
    confidence: "high",
    coverageReport: {
      tasksPlanned: 2,
      tasksCompleted: 1,
      filesRead: ["src/auth.ts", "src/middleware.ts"],
      findingsCount: 1,
      openQuestionsRemaining: 1,
    },
    budgetUsed: [
      { phase: "scout", promptTokens: 1000, completionTokens: 500, totalTokens: 1500, cachedTokens: 200, costUsd: 0.01, durationMs: 1000 },
    ],
    durationMs: 8000,
  };
}

describe("telemetry", () => {
  it("builds a complete telemetry entry", () => {
    const plan = makePlan();
    const result = makeResult();

    const entry = buildTelemetryEntry({
      sessionId: "session-1",
      plan,
      result,
      durationMs: 8000,
      scoutDurationMs: 1000,
      synthesisDurationMs: 2000,
      errors: [],
      workersSpawned: 2,
    });

    assert.strictEqual(entry.sessionId, "session-1");
    assert.strictEqual(entry.turnId, "turn-1");
    assert.strictEqual(entry.query, "how does auth work");
    assert.strictEqual(entry.terminalState, "ANSWER_FOUND");
    assert.strictEqual(entry.confidence, "high");
    assert.strictEqual(entry.budgetMaxWorkersPerWave, 2);
    assert.strictEqual(entry.waves, 1);
    assert.strictEqual(entry.workersSpawned, 2);
    assert.strictEqual(entry.tasksPlanned, 2);
    assert.strictEqual(entry.tasksCompleted, 1);
    assert.strictEqual(entry.tasksKilled, 1);
    assert.strictEqual(entry.tasksFailed, 0);
    assert.strictEqual(entry.findingsCount, 1);
    assert.strictEqual(entry.openQuestionsRemaining, 1);
    assert.strictEqual(entry.filesReadCount, 2);
    assert.strictEqual(entry.duplicateReads, 0);
    assert.strictEqual(entry.duplicateReadRate, 0);
    assert.strictEqual(entry.convergenceScore, 4);
    assert.strictEqual(entry.convergenceDecision, "partial");
    assert.strictEqual(entry.totalTokens, 11_500);
    assert.strictEqual(entry.totalCachedTokens, 1_700);
  });

  it("detects duplicate reads", () => {
    const plan = makePlan();
    const result: ResearchResult = {
      ...makeResult(),
      coverageReport: {
        ...makeResult().coverageReport,
        filesRead: ["src/auth.ts", "src/auth.ts", "src/middleware.ts"],
      },
    };

    const entry = buildTelemetryEntry({
      sessionId: "session-1",
      plan,
      result,
      durationMs: 8000,
      scoutDurationMs: 1000,
      synthesisDurationMs: 2000,
      errors: [],
      workersSpawned: 2,
    });

    assert.strictEqual(entry.filesReadCount, 2); // unique
    assert.strictEqual(entry.duplicateReads, 1);
    assert.ok(entry.duplicateReadRate > 0);
  });

  it("includes errors", () => {
    const plan = makePlan();
    const result = makeResult();

    const entry = buildTelemetryEntry({
      sessionId: "session-1",
      plan,
      result,
      durationMs: 8000,
      scoutDurationMs: 1000,
      synthesisDurationMs: 2000,
      errors: ["scout timeout", "worker crash"],
      workersSpawned: 2,
    });

    assert.deepStrictEqual(entry.errors, ["scout timeout", "worker crash"]);
  });
});
