/**
 * Research Telemetry — Structured logging for research transactions.
 *
 * Integrates with the existing cost-debug system but adds research-specific
 * metrics: waves, workers, tasks, findings, convergence path, duplicate reads.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { rotateJsonl, RETENTION } from "../storage-limits.js";
import type { Usage } from "../agent/messages.js";
import type { ResearchPlan, ResearchResult, TerminalState, Confidence } from "./types.js";

const LOG_VERSION = 1;

export interface ResearchTelemetryEntry {
  v: number;
  ts: string;
  sessionId: string;
  turnId: string;
  query: string;
  repoFingerprint: string;

  // Lifecycle
  status: ResearchPlan["status"];
  terminalState: TerminalState;
  confidence: Confidence;

  // Budget
  budgetMaxCostUsd: number;
  budgetMaxTokens: number;
  budgetMaxWaves: number;
  budgetMaxWorkersPerWave: number;

  // Usage by phase
  phases: Array<{
    phase: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
    durationMs: number;
  }>;

  // Totals
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number; // TODO: compute from model pricing

  // Work
  waves: number;
  workersSpawned: number;
  tasksPlanned: number;
  tasksCompleted: number;
  tasksKilled: number;
  tasksFailed: number;
  findingsCount: number;
  openQuestionsRemaining: number;

  // Files
  filesRead: string[];
  filesReadCount: number;
  duplicateReads: number;
  duplicateReadRate: number;

  // Convergence
  convergenceScore: number;
  convergenceDecision: string;

  // Performance
  durationMs: number;
  scoutDurationMs: number;
  synthesisDurationMs: number;

  // Errors
  errors: string[];
}

function telemetryDir(): string {
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdg, "kimiflare");
}

function telemetryPath(): string {
  return join(telemetryDir(), "research-telemetry.jsonl");
}

function now(): string {
  return new Date().toISOString();
}

export interface BuildTelemetryOpts {
  sessionId: string;
  plan: ResearchPlan;
  result: ResearchResult;
  durationMs: number;
  scoutDurationMs: number;
  synthesisDurationMs: number;
  errors: string[];
  workersSpawned: number;
}

export function buildTelemetryEntry(opts: BuildTelemetryOpts): ResearchTelemetryEntry {
  const plan = opts.plan;
  const result = opts.result;

  const totalPrompt = plan.phases.reduce((s, p) => s + p.promptTokens, 0);
  const totalCompletion = plan.phases.reduce((s, p) => s + p.completionTokens, 0);
  const totalTokens = plan.phases.reduce((s, p) => s + p.totalTokens, 0);
  const totalCached = plan.phases.reduce((s, p) => s + p.cachedTokens, 0);

  const filesRead = result.coverageReport.filesRead;
  const uniqueFiles = new Set(filesRead);
  const duplicateReads = filesRead.length - uniqueFiles.size;
  const duplicateRate = filesRead.length > 0 ? duplicateReads / filesRead.length : 0;

  return {
    v: LOG_VERSION,
    ts: now(),
    sessionId: opts.sessionId,
    turnId: plan.turnId,
    query: plan.query,
    repoFingerprint: plan.repoFingerprint,
    status: plan.status,
    terminalState: result.terminalState,
    confidence: result.confidence,
    budgetMaxCostUsd: plan.budget.maxCostUsd,
    budgetMaxTokens: plan.budget.maxInputTokens + plan.budget.maxOutputTokens,
    budgetMaxWaves: plan.budget.maxWaves,
    budgetMaxWorkersPerWave: plan.budget.maxWorkersPerWave,
    phases: plan.phases.map((p) => ({
      phase: p.phase,
      promptTokens: p.promptTokens,
      completionTokens: p.completionTokens,
      totalTokens: p.totalTokens,
      cachedTokens: p.cachedTokens,
      durationMs: p.durationMs,
    })),
    totalPromptTokens: totalPrompt,
    totalCompletionTokens: totalCompletion,
    totalTokens,
    totalCachedTokens: totalCached,
    totalCostUsd: 0, // TODO: model pricing
    waves: plan.checkpoints.length,
    workersSpawned: opts.workersSpawned,
    tasksPlanned: result.coverageReport.tasksPlanned,
    tasksCompleted: result.coverageReport.tasksCompleted,
    tasksKilled: plan.tasks.filter((t) => t.status === "killed").length,
    tasksFailed: plan.tasks.filter((t) => t.status === "failed").length,
    findingsCount: result.coverageReport.findingsCount,
    openQuestionsRemaining: result.coverageReport.openQuestionsRemaining,
    filesRead: [...uniqueFiles],
    filesReadCount: uniqueFiles.size,
    duplicateReads,
    duplicateReadRate: Math.round(duplicateRate * 1000) / 10, // 1 decimal
    convergenceScore: plan.convergence.score,
    convergenceDecision: plan.convergence.decision,
    durationMs: opts.durationMs,
    scoutDurationMs: opts.scoutDurationMs,
    synthesisDurationMs: opts.synthesisDurationMs,
    errors: opts.errors,
  };
}

export async function logResearchTelemetry(entry: ResearchTelemetryEntry): Promise<void> {
  await mkdir(telemetryDir(), { recursive: true });
  await rotateJsonl(telemetryPath(), RETENTION.costDebugMaxBytes, RETENTION.costDebugRotations);
  await appendFile(telemetryPath(), JSON.stringify(entry) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Convenience: log from controller result
// ---------------------------------------------------------------------------

export interface LogResearchTurnOpts {
  sessionId: string;
  plan: ResearchPlan;
  result: ResearchResult;
  durationMs: number;
  scoutDurationMs: number;
  synthesisDurationMs: number;
  errors: string[];
  workersSpawned: number;
}

export async function logResearchTurn(opts: LogResearchTurnOpts): Promise<void> {
  const entry = buildTelemetryEntry(opts);
  await logResearchTelemetry(entry);
}
