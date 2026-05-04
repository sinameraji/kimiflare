/**
 * Budgeted Research Transaction — Core Types
 *
 * All state schemas for the deterministic research transaction controller.
 * See docs/plans/budgeted-research-transaction.md for full specification.
 */

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface ResearchBudget {
  maxCostUsd: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxWallTimeMs: number;
  maxFilesRead: number;
  maxWaves: number;
  maxWorkersPerWave: number;
  partitions: {
    scout: number;
    exploration: number;
    synthesis: number;
    emergency: number;
  };
}

export interface PhaseUsage {
  phase: "scout" | "exploration" | "synthesis" | "emergency";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  costUsd: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "killed"
  | "failed";

export interface TaskScope {
  includePaths?: string[];
  excludePaths?: string[];
  suggestedFiles?: string[];
  maxFiles?: number;
}

export interface TaskBudget {
  maxTokens: number;
  maxToolCalls: number;
  maxFilesRead: number;
  consumedTokens: number;
  consumedToolCalls: number;
  consumedFilesRead: number;
}

export interface ResearchTask {
  id: string;
  question: string;
  description: string;
  priority: 1 | 2 | 3 | 4 | 5;
  scope: TaskScope;
  dependencyIds: string[];
  status: TaskStatus;
  ownerWorkerId?: string;
  budget: TaskBudget;
  killReason?: string;
}

// ---------------------------------------------------------------------------
// Finding
// ---------------------------------------------------------------------------

export type Confidence = "high" | "medium" | "low";

export interface Evidence {
  filePath: string;
  lineRange?: [number, number];
  excerpt?: string;
}

export interface Finding {
  id: string;
  taskId: string;
  workerId: string;
  claim: string;
  evidence: Evidence[];
  confidence: Confidence;
  implications?: string[];
  unresolvedFollowups?: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// File Lease
// ---------------------------------------------------------------------------

export type LeaseStatus = "active" | "released" | "expired";

export interface FileLease {
  filePath: string;
  workerId: string;
  taskId: string;
  purpose: string;
  status: LeaseStatus;
  expiresAfterToolCalls: number;
}

// ---------------------------------------------------------------------------
// Open Question
// ---------------------------------------------------------------------------

export interface OpenQuestion {
  id: string;
  question: string;
  critical: boolean;
  sourceTaskId: string;
  status: "open" | "answered" | "abandoned";
}

// ---------------------------------------------------------------------------
// Convergence
// ---------------------------------------------------------------------------

export type ConvergenceDecision =
  | "converged"
  | "partial"
  | "continue"
  | "replan";

export interface ConvergenceMetrics {
  budgetRemainingPct: number;
  unresolvedCriticalQuestions: number;
  findingsDeltaLastWave: number;
  duplicateReadRate: number;
  coverageChecklistPct: number;
}

export interface ConvergenceState {
  score: number;
  metrics: ConvergenceMetrics;
  llmJudgeAdvisory?: string;
  decision: ConvergenceDecision;
}

// ---------------------------------------------------------------------------
// Scout
// ---------------------------------------------------------------------------

export interface ScoutResult {
  estimatedRelevantFiles: number;
  likelyAreas: string[];
  proposedTasks: ResearchTask[];
  dependencyHints: { taskId: string; dependsOn: string[] }[];
  falsificationQuestions: string[];
  recommendedWorkerCount: 1 | 2;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type ResearchStatus =
  | "scouting"
  | "executing"
  | "synthesizing"
  | "done"
  | "aborted";

export interface CheckpointRef {
  wave: number;
  timestamp: string;
  ledgerPath: string;
}

export interface OrchestratorNote {
  timestamp: string;
  note: string;
}

export interface ResearchPlan {
  version: 1;
  turnId: string;
  query: string;
  repoFingerprint: string;
  status: ResearchStatus;
  budget: ResearchBudget;
  phases: PhaseUsage[];
  tasks: ResearchTask[];
  findings: Finding[];
  fileLeases: FileLease[];
  openQuestions: OpenQuestion[];
  convergence: ConvergenceState;
  checkpoints: CheckpointRef[];
  notes: OrchestratorNote[];
}

// ---------------------------------------------------------------------------
// Terminal States
// ---------------------------------------------------------------------------

export type TerminalState =
  | "ANSWER_FOUND"
  | "LIKELY_ANSWER"
  | "NOT_FOUND"
  | "BLOCKED"
  | "BUDGET_EXHAUSTED"
  | "ABORTED";

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ResearchResult {
  content: string;
  terminalState: TerminalState;
  confidence: Confidence;
  coverageReport: {
    tasksPlanned: number;
    tasksCompleted: number;
    filesRead: string[];
    findingsCount: number;
    openQuestionsRemaining: number;
  };
  budgetUsed: PhaseUsage[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Controller Options
// ---------------------------------------------------------------------------

export interface ResearchTransactionOpts {
  query: string;
  repoFingerprint: string;
  budget?: Partial<ResearchBudget>;
  turnId?: string;
  signal?: AbortSignal;
}
