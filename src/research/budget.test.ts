import { describe, it } from "node:test";
import assert from "node:assert";
import {
  DEFAULT_BUDGET,
  createBudgetState,
  recordPhase,
  getPartitionUsage,
  checkCircuitBreaker,
  allocateTaskBudgets,
  recordFilesRead,
  isFilesBudgetExhausted,
  recordWave,
  isWavesBudgetExhausted,
  getBudgetSummary,
} from "./budget.js";
import type { ResearchTask, PhaseUsage } from "./types.js";

describe("budget", () => {
  it("has sensible defaults", () => {
    assert.strictEqual(DEFAULT_BUDGET.maxCostUsd, 2.0);
    assert.strictEqual(DEFAULT_BUDGET.maxWaves, 3);
    assert.strictEqual(DEFAULT_BUDGET.maxWorkersPerWave, 1);
    assert.strictEqual(DEFAULT_BUDGET.partitions.scout, 0.10);
    assert.strictEqual(DEFAULT_BUDGET.partitions.exploration, 0.65);
  });

  it("creates a budget state with zero usage", () => {
    const state = createBudgetState();
    assert.strictEqual(state.totalTokens, 0);
    assert.strictEqual(state.totalCostUsd, 0);
    assert.strictEqual(state.totalWaves, 0);
    assert.strictEqual(state.totalFilesRead, 0);
  });

  it("merges partial budget overrides", () => {
    const state = createBudgetState({ maxCostUsd: 1.0, maxWaves: 5 });
    assert.strictEqual(state.budget.maxCostUsd, 1.0);
    assert.strictEqual(state.budget.maxWaves, 5);
    assert.strictEqual(state.budget.maxInputTokens, DEFAULT_BUDGET.maxInputTokens);
  });

  it("records phase usage and updates totals", () => {
    let state = createBudgetState();
    const usage: PhaseUsage = {
      phase: "scout",
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cachedTokens: 200,
      costUsd: 0.05,
      durationMs: 1000,
    };
    state = recordPhase(state, usage);
    assert.strictEqual(state.totalTokens, 1500);
    assert.strictEqual(state.totalCostUsd, 0.05);
    assert.strictEqual(state.wallTimeMs, 1000);
  });

  it("calculates partition usage correctly", () => {
    let state = createBudgetState();
    state = recordPhase(state, {
      phase: "scout",
      promptTokens: 100_000,
      completionTokens: 50_000,
      totalTokens: 150_000,
      cachedTokens: 0,
      costUsd: 0.1,
      durationMs: 1000,
    });
    state = recordPhase(state, {
      phase: "scout",
      promptTokens: 50_000,
      completionTokens: 25_000,
      totalTokens: 75_000,
      cachedTokens: 0,
      costUsd: 0.05,
      durationMs: 500,
    });

    const scout = getPartitionUsage(state, "scout");
    assert.strictEqual(scout.tokens, 225_000);
    assert.ok(Math.abs(scout.cost - 0.15) < 0.001);
    assert.ok(scout.pct > 0);
  });

  it("returns ok when under budget", () => {
    const state = createBudgetState();
    assert.strictEqual(checkCircuitBreaker(state), "ok");
  });

  it("triggers abort_scout when scout partition exceeded", () => {
    let state = createBudgetState();
    // Scout partition is 10% of 2,080,000 tokens = 208,000
    state = recordPhase(state, {
      phase: "scout",
      promptTokens: 250_000,
      completionTokens: 0,
      totalTokens: 250_000,
      cachedTokens: 0,
      costUsd: 0.1,
      durationMs: 1000,
    });
    assert.strictEqual(checkCircuitBreaker(state), "abort_scout");
  });

  it("triggers stop_new_tasks when exploration partition exceeded", () => {
    let state = createBudgetState();
    // Exploration partition is 65% of 2,080,000 = 1,352,000
    state = recordPhase(state, {
      phase: "exploration",
      promptTokens: 1_500_000,
      completionTokens: 0,
      totalTokens: 1_500_000,
      cachedTokens: 0,
      costUsd: 0.5,
      durationMs: 1000,
    });
    assert.strictEqual(checkCircuitBreaker(state), "stop_new_tasks");
  });

  it("triggers emergency_conclusion when total tokens exceeded", () => {
    let state = createBudgetState();
    state = recordPhase(state, {
      phase: "exploration",
      promptTokens: 2_500_000,
      completionTokens: 0,
      totalTokens: 2_500_000,
      cachedTokens: 0,
      costUsd: 0.5,
      durationMs: 1000,
    });
    assert.strictEqual(checkCircuitBreaker(state), "emergency_conclusion");
  });

  it("triggers emergency_conclusion when cost exceeded", () => {
    let state = createBudgetState();
    state = recordPhase(state, {
      phase: "exploration",
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
      cachedTokens: 0,
      costUsd: 3.0,
      durationMs: 1000,
    });
    assert.strictEqual(checkCircuitBreaker(state), "emergency_conclusion");
  });

  it("triggers emergency_conclusion when wall time exceeded", () => {
    let state = createBudgetState();
    state = recordPhase(state, {
      phase: "exploration",
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
      cachedTokens: 0,
      costUsd: 0.01,
      durationMs: 10 * 60_000, // 10 minutes > 8 minute max
    });
    assert.strictEqual(checkCircuitBreaker(state), "emergency_conclusion");
  });

  it("allocates task budgets proportionally by priority", () => {
    const state = createBudgetState();
    const tasks: ResearchTask[] = [
      {
        id: "t1",
        question: "q1",
        description: "d1",
        priority: 1,
        scope: {},
        dependencyIds: [],
        status: "pending",
        budget: {
          maxTokens: 1000,
          maxToolCalls: 10,
          maxFilesRead: 5,
          consumedTokens: 0,
          consumedToolCalls: 0,
          consumedFilesRead: 0,
        },
      },
      {
        id: "t2",
        question: "q2",
        description: "d2",
        priority: 5,
        scope: {},
        dependencyIds: [],
        status: "pending",
        budget: {
          maxTokens: 1000,
          maxToolCalls: 10,
          maxFilesRead: 5,
          consumedTokens: 0,
          consumedToolCalls: 0,
          consumedFilesRead: 0,
        },
      },
    ];

    const allocations = allocateTaskBudgets(state, tasks);
    const t1 = allocations.get("t1")!;
    const t2 = allocations.get("t2")!;
    assert.ok(t1 > t2, "higher priority task should get more budget");
  });

  it("returns empty allocations when no active tasks", () => {
    const state = createBudgetState();
    const allocations = allocateTaskBudgets(state, []);
    assert.strictEqual(allocations.size, 0);
  });

  it("returns empty allocations when all tasks are done", () => {
    const state = createBudgetState();
    const tasks: ResearchTask[] = [
      {
        id: "t1",
        question: "q1",
        description: "d1",
        priority: 1,
        scope: {},
        dependencyIds: [],
        status: "done",
        budget: {
          maxTokens: 1000,
          maxToolCalls: 10,
          maxFilesRead: 5,
          consumedTokens: 0,
          consumedToolCalls: 0,
          consumedFilesRead: 0,
        },
      },
    ];
    const allocations = allocateTaskBudgets(state, tasks);
    assert.strictEqual(allocations.size, 0);
  });

  it("tracks files read and detects exhaustion", () => {
    let state = createBudgetState();
    assert.strictEqual(isFilesBudgetExhausted(state), false);

    state = recordFilesRead(state, 80);
    assert.strictEqual(state.totalFilesRead, 80);
    assert.strictEqual(isFilesBudgetExhausted(state), true);
  });

  it("tracks waves and detects exhaustion", () => {
    let state = createBudgetState();
    assert.strictEqual(isWavesBudgetExhausted(state), false);

    state = recordWave(state);
    state = recordWave(state);
    state = recordWave(state);
    assert.strictEqual(state.totalWaves, 3);
    assert.strictEqual(isWavesBudgetExhausted(state), true);
  });

  it("produces a budget summary", () => {
    let state = createBudgetState();
    state = recordPhase(state, {
      phase: "scout",
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cachedTokens: 0,
      costUsd: 0.05,
      durationMs: 1000,
    });
    state = recordFilesRead(state, 10);
    state = recordWave(state);

    const summary = getBudgetSummary(state);
    assert.strictEqual(summary.totalTokensUsed, 1500);
    assert.strictEqual(summary.filesRead, 10);
    assert.strictEqual(summary.wavesUsed, 1);
    assert.strictEqual(summary.circuitBreaker, "ok");
  });
});
