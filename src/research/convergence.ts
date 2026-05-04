/**
 * Convergence Engine — Deterministic evaluation of whether research is complete.
 *
 * Uses weighted metrics to decide: converged, partial, continue, or replan.
 * Optional LLM judge advisory for edge cases (non-binding).
 */

import type {
  ConvergenceState,
  ConvergenceDecision,
  ConvergenceMetrics,
  ResearchPlan,
  ResearchTask,
  OpenQuestion,
} from "./types.js";

export interface EvaluateConvergenceOpts {
  plan: ResearchPlan;
  budgetRemainingPct: number;
  findingsDeltaLastWave: number;
  duplicateReadRate: number;
}

export function evaluateConvergence(opts: EvaluateConvergenceOpts): ConvergenceState {
  const metrics = computeMetrics(opts);
  const score = computeScore(metrics);

  let decision: ConvergenceDecision;
  if (score >= 5) {
    decision = "converged";
  } else if (score >= 3) {
    decision = "partial";
  } else if (metrics.findingsDeltaLastWave === 0 && metrics.budgetRemainingPct < 50) {
    decision = "replan";
  } else {
    decision = "continue";
  }

  return {
    score,
    metrics,
    decision,
  };
}

function computeMetrics(opts: EvaluateConvergenceOpts): ConvergenceMetrics {
  const unresolvedCritical = opts.plan.openQuestions.filter(
    (q) => q.status === "open" && q.critical,
  ).length;

  const coverageChecklist = buildCoverageChecklist(opts.plan);
  const coveragePct = coverageChecklist.length > 0
    ? coverageChecklist.filter((c) => c.checked).length / coverageChecklist.length
    : 0;

  return {
    budgetRemainingPct: opts.budgetRemainingPct,
    unresolvedCriticalQuestions: unresolvedCritical,
    findingsDeltaLastWave: opts.findingsDeltaLastWave,
    duplicateReadRate: opts.duplicateReadRate,
    coverageChecklistPct: Math.round(coveragePct * 100),
  };
}

function computeScore(metrics: ConvergenceMetrics): number {
  let score = 0;
  if (metrics.budgetRemainingPct > 20) score += 1;
  if (metrics.unresolvedCriticalQuestions === 0) score += 2;
  if (metrics.findingsDeltaLastWave === 0) score += 1;
  if (metrics.duplicateReadRate < 0.10) score += 1;
  if (metrics.coverageChecklistPct >= 80) score += 2;
  return score;
}

interface CoverageItem {
  taskId: string;
  question: string;
  checked: boolean;
}

function buildCoverageChecklist(plan: ResearchPlan): CoverageItem[] {
  return plan.tasks.map((t) => ({
    taskId: t.id,
    question: t.question,
    checked: t.status === "done" || t.status === "killed" || plan.findings.some((f) => f.taskId === t.id),
  }));
}

// ---------------------------------------------------------------------------
// Helpers for the controller to compute inputs
// ---------------------------------------------------------------------------

export function countFindingsDelta(
  previousFindingsCount: number,
  currentFindingsCount: number,
): number {
  return currentFindingsCount - previousFindingsCount;
}

export function computeDuplicateReadRate(
  filesReadThisWave: string[],
  allFilesRead: string[],
): number {
  if (filesReadThisWave.length === 0) return 0;
  const duplicates = filesReadThisWave.filter((f) => allFilesRead.includes(f));
  return duplicates.length / filesReadThisWave.length;
}

export function getReadyTasks(tasks: ResearchTask[]): ResearchTask[] {
  return tasks.filter((t) => {
    if (t.status !== "pending") return false;
    // All dependencies must be done or killed
    return t.dependencyIds.every((depId) => {
      const dep = tasks.find((dt) => dt.id === depId);
      return dep?.status === "done" || dep?.status === "killed";
    });
  });
}
