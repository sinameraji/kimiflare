/**
 * Research Transaction Controller — Deterministic orchestrator.
 *
 * Owns the full lifecycle: scout → ledger → worker waves → convergence → synthesis.
 * Never calls an LLM directly except through scout/worker/synthesis modules.
 */

import { randomUUID } from "node:crypto";
import type { AiGatewayOptions } from "../agent/client.js";
import type { Usage } from "../agent/messages.js";
import {
  createBudgetState,
  recordPhase,
  recordFilesRead,
  recordWave,
  checkCircuitBreaker,
  allocateTaskBudgets,
  getBudgetSummary,
  type BudgetState,
} from "./budget.js";
import {
  createLedger,
  writeLedger,
  readLedger,
  setStatus,
  addTasks,
  updateTask,
  killTask,
  appendFinding,
  requestLease,
  releaseLease,
  expireLeases,
  addOpenQuestions,
  checkpoint,
  addNote,
  recordPhaseUsage,
} from "./ledger.js";
import {
  evaluateConvergence,
  countFindingsDelta,
  computeDuplicateReadRate,
  getReadyTasks,
} from "./convergence.js";
import { runScout } from "./scout.js";
import { runWorker } from "./worker.js";
import { runSynthesis } from "./synthesis.js";
import type {
  ResearchTransactionOpts,
  ResearchResult,
  ResearchPlan,
  ResearchTask,
  PhaseUsage,
  OpenQuestion,
  TerminalState,
  Confidence,
} from "./types.js";

export interface ControllerCallbacks {
  onProgress?: (message: string) => void;
  onPhase?: (phase: string, detail?: string) => void;
}

export interface ControllerOpts extends ResearchTransactionOpts {
  accountId: string;
  apiToken: string;
  model: string;
  cwd: string;
  gateway?: AiGatewayOptions;
  reasoningEffort?: "low" | "medium" | "high";
  sessionId?: string;
  callbacks?: ControllerCallbacks;
}

export async function runResearchTransaction(
  opts: ControllerOpts,
): Promise<ResearchResult> {
  const startTime = performance.now();
  const turnId = opts.turnId ?? randomUUID();
  const signal = opts.signal ?? new AbortController().signal;
  const callbacks = opts.callbacks ?? {};

  callbacks.onProgress?.(`Research mode: budget $${(opts.budget?.maxCostUsd ?? 2.0).toFixed(2)}, up to ${opts.budget?.maxWaves ?? 3} waves`);

  // -------------------------------------------------------------------------
  // Phase 1: Initialize budget and ledger
  // -------------------------------------------------------------------------
  let budgetState = createBudgetState(opts.budget);
  let plan = createLedger({
    turnId,
    query: opts.query,
    repoFingerprint: opts.repoFingerprint,
    budget: budgetState.budget,
  });

  await writeLedger(plan);

  // -------------------------------------------------------------------------
  // Phase 2: Scout
  // -------------------------------------------------------------------------
  callbacks.onPhase?.("scout");
  callbacks.onProgress?.("Scouting...");

  let scoutUsage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let scoutStart = performance.now();

  try {
    const scoutResult = await runScout({
      query: opts.query,
      cwd: opts.cwd,
      signal,
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      gateway: opts.gateway,
      reasoningEffort: opts.reasoningEffort,
      sessionId: opts.sessionId,
    });

    scoutUsage = scoutResult.usage;

    // Record scout phase usage
    const scoutPhase: PhaseUsage = {
      phase: "scout",
      promptTokens: scoutUsage.prompt_tokens,
      completionTokens: scoutUsage.completion_tokens,
      totalTokens: scoutUsage.total_tokens,
      cachedTokens: scoutUsage.prompt_tokens_details?.cached_tokens ?? 0,
      costUsd: 0, // TODO: compute from usage
      durationMs: Math.round(performance.now() - scoutStart),
    };
    budgetState = recordPhase(budgetState, scoutPhase);
    plan = recordPhaseUsage(plan, scoutPhase);

    // Check circuit breaker
    const cb = checkCircuitBreaker(budgetState);
    if (cb === "abort_scout" || cb === "emergency_conclusion") {
      plan = addNote(plan, `Scout aborted by circuit breaker: ${cb}`);
      plan = setStatus(plan, "aborted");
      await writeLedger(plan);
      return buildEmergencyResult(plan, budgetState, startTime, "BUDGET_EXHAUSTED");
    }

    // Populate ledger with scout results
    plan = setStatus(plan, "executing");
    plan = addTasks(plan, scoutResult.result.proposedTasks);

    // Add falsification questions as open questions
    if (scoutResult.result.falsificationQuestions.length > 0) {
      const questions: OpenQuestion[] = scoutResult.result.falsificationQuestions.map((q, i) => ({
        id: `open-q-${i}`,
        question: q,
        critical: true,
        sourceTaskId: "scout",
        status: "open",
      }));
      plan = addOpenQuestions(plan, questions);
    }

    plan = addNote(plan, `Scout complete: ${scoutResult.result.proposedTasks.length} tasks proposed, worker count recommended: ${scoutResult.result.recommendedWorkerCount}`);
    await writeLedger(plan);

    callbacks.onProgress?.(`${scoutResult.result.proposedTasks.length} tasks planned`);
  } catch (err) {
    // Scout failed — fall back to a single default task
    plan = addNote(plan, `Scout failed: ${err instanceof Error ? err.message : String(err)}`);
    plan = addTasks(plan, [{
      id: "fallback-task-0",
      question: opts.query,
      description: "Explore the codebase to answer the user's query.",
      priority: 1,
      scope: { maxFiles: 10 },
      dependencyIds: [],
      status: "pending",
      budget: {
        maxTokens: 100_000,
        maxToolCalls: 10,
        maxFilesRead: 10,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    }]);
    plan = setStatus(plan, "executing");
    await writeLedger(plan);
  }

  // -------------------------------------------------------------------------
  // Phase 3: Worker Waves
  // -------------------------------------------------------------------------
  let wave = 0;
  let previousFindingsCount = 0;
  const allFilesRead: string[] = [];

  while (wave < budgetState.budget.maxWaves) {
    if (signal.aborted) {
      plan = setStatus(plan, "aborted");
      await writeLedger(plan);
      return buildEmergencyResult(plan, budgetState, startTime, "ABORTED");
    }

    // Check circuit breaker before starting wave
    const cb = checkCircuitBreaker(budgetState);
    if (cb === "emergency_conclusion" || cb === "stop_new_tasks") {
      plan = addNote(plan, `Wave ${wave} blocked by circuit breaker: ${cb}`);
      break;
    }

    wave++;
    budgetState = recordWave(budgetState);
    callbacks.onPhase?.("execute", `wave ${wave}`);
    callbacks.onProgress?.(`Wave ${wave}/${budgetState.budget.maxWaves}: exploring...`);

    // Get ready tasks
    const readyTasks = getReadyTasks(plan.tasks);
    if (readyTasks.length === 0) {
      plan = addNote(plan, `Wave ${wave}: no ready tasks`);
      break;
    }

    // Allocate task budgets
    const taskBudgets = allocateTaskBudgets(budgetState, plan.tasks);

    // Select tasks for this wave (respect maxWorkersPerWave)
    const tasksToRun = readyTasks.slice(0, budgetState.budget.maxWorkersPerWave);

    // Run workers
    const workerPromises = tasksToRun.map((task) => {
      const workerId = `worker-${wave}-${task.id}`;
      plan = updateTask(plan, task.id, { status: "in_progress", ownerWorkerId: workerId });

      return runWorker({
        task,
        workerId,
        accountId: opts.accountId,
        apiToken: opts.apiToken,
        model: opts.model,
        cwd: opts.cwd,
        signal,
        gateway: opts.gateway,
        reasoningEffort: opts.reasoningEffort,
        sessionId: opts.sessionId,
      });
    });

    const workerResults = await Promise.all(workerPromises);

    // Process worker results
    const filesReadThisWave: string[] = [];
    let waveTokens = 0;

    for (let i = 0; i < workerResults.length; i++) {
      const result = workerResults[i]!;
      const task = tasksToRun[i]!;
      const workerId = `worker-${wave}-${task.id}`;

      waveTokens += result.usage.total_tokens;
      filesReadThisWave.push(...result.filesRead);
      allFilesRead.push(...result.filesRead);
      budgetState = recordFilesRead(budgetState, result.filesRead.length);

      // Update task budget consumption
      plan = updateTask(plan, task.id, {
        status: result.unknown ? "failed" : result.findings.length > 0 ? "done" : "failed",
        budget: {
          ...task.budget,
          consumedTokens: result.usage.total_tokens,
          consumedToolCalls: result.usage.total_tokens > 0 ? task.budget.maxToolCalls : 0, // approximate
          consumedFilesRead: result.filesRead.length,
        },
      });

      // Append findings
      for (const finding of result.findings) {
        const appendResult = appendFinding(plan, { finding, workerId });
        if (appendResult.error) {
          plan = addNote(plan, `Finding rejected: ${appendResult.error}`);
        } else {
          plan = appendResult.plan;
        }
      }

      // Process followups
      for (const followup of result.followups) {
        const newTask: ResearchTask = {
          id: `followup-${plan.tasks.length}`,
          question: followup.question,
          description: followup.description ?? followup.question,
          priority: (followup.priority ?? 3) as 1 | 2 | 3 | 4 | 5,
          scope: { suggestedFiles: followup.suggestedFiles, maxFiles: 10 },
          dependencyIds: [task.id],
          status: "pending",
          budget: {
            maxTokens: 50_000,
            maxToolCalls: 8,
            maxFilesRead: 10,
            consumedTokens: 0,
            consumedToolCalls: 0,
            consumedFilesRead: 0,
          },
        };
        plan = addTasks(plan, [newTask]);
        plan = addNote(plan, `Followup proposed: ${followup.question}`);
      }

      // Process file requests (leases)
      for (const req of result.fileRequests) {
        const leaseResult = requestLease(plan, {
          filePath: req.filePath,
          workerId,
          taskId: task.id,
          purpose: req.purpose,
          expiresAfterToolCalls: 5,
        });
        if (!leaseResult.granted) {
          plan = addNote(plan, `File lease denied: ${req.filePath} for ${workerId}`);
        } else {
          plan = leaseResult.plan;
        }
      }

      // Process unknown
      if (result.unknown) {
        plan = addNote(plan, `Task ${task.id} marked unknown: ${result.unknown.reason}`);
      }
    }

    // Record exploration phase usage for this wave
    const explorationPhase: PhaseUsage = {
      phase: "exploration",
      promptTokens: workerResults.reduce((s, r) => s + r.usage.prompt_tokens, 0),
      completionTokens: workerResults.reduce((s, r) => s + r.usage.completion_tokens, 0),
      totalTokens: waveTokens,
      cachedTokens: workerResults.reduce(
        (s, r) => s + (r.usage.prompt_tokens_details?.cached_tokens ?? 0),
        0,
      ),
      costUsd: 0,
      durationMs: 0, // TODO: track per-wave duration
    };
    budgetState = recordPhase(budgetState, explorationPhase);
    plan = recordPhaseUsage(plan, explorationPhase);

    // Expire old leases
    plan = expireLeases(plan);

    // Checkpoint
    plan = await checkpoint(plan, wave);
    await writeLedger(plan);

    // Evaluate convergence
    const findingsDelta = countFindingsDelta(previousFindingsCount, plan.findings.length);
    previousFindingsCount = plan.findings.length;
    const duplicateRate = computeDuplicateReadRate(filesReadThisWave, allFilesRead);
    const budgetSummary = getBudgetSummary(budgetState);

    const convergence = evaluateConvergence({
      plan,
      budgetRemainingPct: budgetSummary.totalTokensMax > 0
        ? ((budgetSummary.totalTokensMax - budgetSummary.totalTokensUsed) / budgetSummary.totalTokensMax) * 100
        : 100,
      findingsDeltaLastWave: findingsDelta,
      duplicateReadRate: duplicateRate,
    });

    plan = { ...plan, convergence };
    await writeLedger(plan);

    callbacks.onProgress?.(
      `Convergence check: ${convergence.decision} (score: ${convergence.score}/6)`
    );

    if (convergence.decision === "converged") {
      plan = addNote(plan, `Converged at wave ${wave} with score ${convergence.score}`);
      break;
    }

    if (convergence.decision === "replan") {
      // Kill stale pending tasks and create new ones from open questions
      const staleTasks = plan.tasks.filter((t) => t.status === "pending" && t.priority > 3);
      for (const t of staleTasks) {
        plan = killTask(plan, t.id, "Replanning: low priority task deprioritized");
      }
      plan = addNote(plan, `Replanning at wave ${wave}`);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 4: Synthesis
  // -------------------------------------------------------------------------
  callbacks.onPhase?.("synthesis");
  callbacks.onProgress?.("Synthesizing final answer...");

  plan = setStatus(plan, "synthesizing");
  await writeLedger(plan);

  let synthesisUsage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let synthesisStart = performance.now();
  let content = "";
  let terminalState: TerminalState = "NOT_FOUND";
  let confidence: Confidence = "low";

  try {
    const synthesisResult = await runSynthesis({
      plan,
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      signal,
      gateway: opts.gateway,
      reasoningEffort: opts.reasoningEffort,
      sessionId: opts.sessionId,
    });

    content = synthesisResult.content;
    terminalState = synthesisResult.terminalState;
    confidence = synthesisResult.confidence;
    synthesisUsage = synthesisResult.usage;

    const synthesisPhase: PhaseUsage = {
      phase: "synthesis",
      promptTokens: synthesisUsage.prompt_tokens,
      completionTokens: synthesisUsage.completion_tokens,
      totalTokens: synthesisUsage.total_tokens,
      cachedTokens: synthesisUsage.prompt_tokens_details?.cached_tokens ?? 0,
      costUsd: 0,
      durationMs: Math.round(performance.now() - synthesisStart),
    };
    budgetState = recordPhase(budgetState, synthesisPhase);
    plan = recordPhaseUsage(plan, synthesisPhase);
  } catch (err) {
    // Synthesis failed — generate emergency conclusion
    plan = addNote(plan, `Synthesis failed: ${err instanceof Error ? err.message : String(err)}`);
    content = buildEmergencyConclusion(plan);
    terminalState = "BLOCKED";
    confidence = "low";
  }

  // -------------------------------------------------------------------------
  // Phase 5: Finalize
  // -------------------------------------------------------------------------
  plan = setStatus(plan, "done");
  await writeLedger(plan);

  const durationMs = Math.round(performance.now() - startTime);

  callbacks.onProgress?.("Research complete.");

  return {
    content,
    terminalState,
    confidence,
    coverageReport: {
      tasksPlanned: plan.tasks.length,
      tasksCompleted: plan.tasks.filter((t) => t.status === "done").length,
      filesRead: [...new Set(allFilesRead)],
      findingsCount: plan.findings.length,
      openQuestionsRemaining: plan.openQuestions.filter((q) => q.status === "open").length,
    },
    budgetUsed: budgetState.phases,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Emergency result builder
// ---------------------------------------------------------------------------

function buildEmergencyResult(
  plan: ResearchPlan,
  budgetState: BudgetState,
  startTime: number,
  terminalState: TerminalState,
): ResearchResult {
  const content = buildEmergencyConclusion(plan);
  return {
    content,
    terminalState,
    confidence: "low",
    coverageReport: {
      tasksPlanned: plan.tasks.length,
      tasksCompleted: plan.tasks.filter((t) => t.status === "done").length,
      filesRead: [],
      findingsCount: plan.findings.length,
      openQuestionsRemaining: plan.openQuestions.filter((q) => q.status === "open").length,
    },
    budgetUsed: budgetState.phases,
    durationMs: Math.round(performance.now() - startTime),
  };
}

function buildEmergencyConclusion(plan: ResearchPlan): string {
  const findings = plan.findings.length > 0
    ? plan.findings.map((f) => `- ${f.claim} (${f.confidence})`).join("\n")
    : "No findings recorded.";

  return (
    `## Research Partial Results\n\n` +
    `**Status:** ${plan.status}\n\n` +
    `**Tasks:** ${plan.tasks.filter((t) => t.status === "done").length}/${plan.tasks.length} completed\n\n` +
    `**Findings:**\n${findings}\n\n` +
    `**Open Questions:**\n${plan.openQuestions.filter((q) => q.status === "open").map((q) => `- ${q.question}`).join("\n") || "None"}\n\n` +
    `**Note:** Research was interrupted. The above represents partial findings.`
  );
}
