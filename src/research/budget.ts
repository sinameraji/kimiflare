/**
 * Budget Enforcer — Circuit breaker for research transactions.
 *
 * Tracks spend across partitions and triggers graceful degradation
 * when any partition is exhausted.
 */

import type { PhaseUsage, ResearchBudget, ResearchTask } from "./types.js";

export const DEFAULT_BUDGET: ResearchBudget = {
  maxCostUsd: 2.0,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 80_000,
  maxWallTimeMs: 8 * 60_000,
  maxFilesRead: 80,
  maxWaves: 3,
  maxWorkersPerWave: 1,
  partitions: {
    scout: 0.10,
    exploration: 0.65,
    synthesis: 0.15,
    emergency: 0.10,
  },
};

export type CircuitBreakerAction =
  | "ok"
  | "abort_scout"
  | "stop_new_tasks"
  | "truncate_synthesis"
  | "emergency_conclusion";

export interface BudgetState {
  budget: ResearchBudget;
  phases: PhaseUsage[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
  totalFilesRead: number;
  totalWaves: number;
  wallTimeMs: number;
}

export function createBudgetState(
  budget: Partial<ResearchBudget> = {},
): BudgetState {
  const merged: ResearchBudget = {
    ...DEFAULT_BUDGET,
    ...budget,
    partitions: { ...DEFAULT_BUDGET.partitions, ...budget.partitions },
  };
  return {
    budget: merged,
    phases: [],
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCachedTokens: 0,
    totalCostUsd: 0,
    totalFilesRead: 0,
    totalWaves: 0,
    wallTimeMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Phase tracking
// ---------------------------------------------------------------------------

export function recordPhase(
  state: BudgetState,
  usage: PhaseUsage,
): BudgetState {
  const phases = [...state.phases, usage];
  return {
    ...state,
    phases,
    totalPromptTokens: state.totalPromptTokens + usage.promptTokens,
    totalCompletionTokens: state.totalCompletionTokens + usage.completionTokens,
    totalTokens: state.totalTokens + usage.totalTokens,
    totalCachedTokens: state.totalCachedTokens + usage.cachedTokens,
    totalCostUsd: state.totalCostUsd + usage.costUsd,
    wallTimeMs: state.wallTimeMs + usage.durationMs,
  };
}

// ---------------------------------------------------------------------------
// Partition queries
// ---------------------------------------------------------------------------

function phaseTotal(
  phases: PhaseUsage[],
  phaseName: PhaseUsage["phase"],
): { tokens: number; cost: number; duration: number } {
  return phases
    .filter((p) => p.phase === phaseName)
    .reduce(
      (acc, p) => ({
        tokens: acc.tokens + p.totalTokens,
        cost: acc.cost + p.costUsd,
        duration: acc.duration + p.durationMs,
      }),
      { tokens: 0, cost: 0, duration: 0 },
    );
}

export function getPartitionUsage(
  state: BudgetState,
  partition: "scout" | "exploration" | "synthesis" | "emergency",
): { tokens: number; cost: number; duration: number; pct: number } {
  const used = phaseTotal(state.phases, partition);
  const maxTokens = state.budget.maxInputTokens + state.budget.maxOutputTokens;
  const pct = maxTokens > 0 ? (used.tokens / maxTokens) * 100 : 0;
  return { ...used, pct };
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export function checkCircuitBreaker(state: BudgetState): CircuitBreakerAction {
  const maxTokens = state.budget.maxInputTokens + state.budget.maxOutputTokens;

  // Total budget exhaustion
  if (
    state.totalTokens >= maxTokens ||
    state.totalCostUsd >= state.budget.maxCostUsd ||
    state.wallTimeMs >= state.budget.maxWallTimeMs
  ) {
    return "emergency_conclusion";
  }

  // Scout partition
  const scout = getPartitionUsage(state, "scout");
  if (scout.pct >= state.budget.partitions.scout * 100) {
    return "abort_scout";
  }

  // Exploration partition
  const exploration = getPartitionUsage(state, "exploration");
  if (exploration.pct >= state.budget.partitions.exploration * 100) {
    return "stop_new_tasks";
  }

  // Synthesis partition
  const synthesis = getPartitionUsage(state, "synthesis");
  if (synthesis.pct >= state.budget.partitions.synthesis * 100) {
    return "truncate_synthesis";
  }

  return "ok";
}

// ---------------------------------------------------------------------------
// Task budget allocation
// ---------------------------------------------------------------------------

export function allocateTaskBudgets(
  state: BudgetState,
  tasks: ResearchTask[],
): Map<string, number> {
  const exploration = getPartitionUsage(state, "exploration");
  const maxTokens = state.budget.maxInputTokens + state.budget.maxOutputTokens;
  const explorationCap = maxTokens * state.budget.partitions.exploration;
  const remaining = Math.max(0, explorationCap - exploration.tokens);

  const activeTasks = tasks.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  );
  if (activeTasks.length === 0) {
    return new Map();
  }

  const totalPriority = activeTasks.reduce(
    (s, t) => s + (6 - t.priority),
    0,
  );
  if (totalPriority === 0) {
    return new Map();
  }

  return new Map(
    activeTasks.map((t) => [
      t.id,
      Math.floor((remaining * (6 - t.priority)) / totalPriority),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Files read tracking
// ---------------------------------------------------------------------------

export function recordFilesRead(
  state: BudgetState,
  count: number,
): BudgetState {
  return {
    ...state,
    totalFilesRead: state.totalFilesRead + count,
  };
}

export function isFilesBudgetExhausted(state: BudgetState): boolean {
  return state.totalFilesRead >= state.budget.maxFilesRead;
}

// ---------------------------------------------------------------------------
// Waves tracking
// ---------------------------------------------------------------------------

export function recordWave(state: BudgetState): BudgetState {
  return {
    ...state,
    totalWaves: state.totalWaves + 1,
  };
}

export function isWavesBudgetExhausted(state: BudgetState): boolean {
  return state.totalWaves >= state.budget.maxWaves;
}

// ---------------------------------------------------------------------------
// Budget remaining summary
// ---------------------------------------------------------------------------

export interface BudgetSummary {
  totalTokensUsed: number;
  totalTokensMax: number;
  totalCostUsd: number;
  costMaxUsd: number;
  filesRead: number;
  filesMax: number;
  wavesUsed: number;
  wavesMax: number;
  wallTimeMs: number;
  wallTimeMaxMs: number;
  circuitBreaker: CircuitBreakerAction;
}

export function getBudgetSummary(state: BudgetState): BudgetSummary {
  const maxTokens = state.budget.maxInputTokens + state.budget.maxOutputTokens;
  return {
    totalTokensUsed: state.totalTokens,
    totalTokensMax: maxTokens,
    totalCostUsd: state.totalCostUsd,
    costMaxUsd: state.budget.maxCostUsd,
    filesRead: state.totalFilesRead,
    filesMax: state.budget.maxFilesRead,
    wavesUsed: state.totalWaves,
    wavesMax: state.budget.maxWaves,
    wallTimeMs: state.wallTimeMs,
    wallTimeMaxMs: state.budget.maxWallTimeMs,
    circuitBreaker: checkCircuitBreaker(state),
  };
}
