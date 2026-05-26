/**
 * TurnSupervisor — fire-and-forget wrapper around runAgentTurn.
 *
 * Decouples turn execution from UI control flow so that:
 * 1. The UI never blocks waiting for a turn to complete
 * 2. A watchdog can enforce maximum turn duration
 * 3. Preemption can kill a running turn and start a new one
 */

import { runAgentTurn } from "./loop.js";
import type { AgentTurnOpts } from "./loop.js";
import { logger } from "../util/logger.js";
import type { WorkerResultMessage } from "./messages.js";

export type TurnPhase = "idle" | "preparing" | "streaming" | "executing" | "compacting" | "error";

export interface SupervisorCallbacks {
  onDone?: () => void;
  onError?: (error: Error) => void;
}

/** Options for spawning a standalone worker. */
export interface SpawnWorkerOpts {
  mode: "plan" | "execute";
  task: string;
  context?: string;
  budgetUsd?: number;
  model?: string;
  branchName?: string;
  baseBranch?: string;
  prTitle?: string;
  prBody?: string;
}

/** Active worker tracking for UI status. */
export interface ActiveWorker {
  id: string;
  mode: "plan" | "execute";
  task: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: number;
  result?: WorkerResultMessage;
  error?: string;
}

export class TurnSupervisor {
  private currentTurn: Promise<void> | null = null;
  private _phase: TurnPhase = "idle";
  private _killRequested = false;
  private _activeWorkers: Map<string, ActiveWorker> = new Map();

  get phase(): TurnPhase {
    return this._phase;
  }

  get isRunning(): boolean {
    return this._phase !== "idle";
  }

  get killRequested(): boolean {
    return this._killRequested;
  }

  get activeWorkers(): ActiveWorker[] {
    return [...this._activeWorkers.values()];
  }

  startTurn(opts: AgentTurnOpts, callbacks?: SupervisorCallbacks): void {
    if (this.isRunning) {
      logger.warn("supervisor:start_rejected", { reason: "turn_already_running", phase: this._phase });
      // Graceful no-op instead of throwing — prevents unhandled crashes when
      // queued messages or rapid submissions race into processMessage().
      return;
    }
    this._phase = "preparing";
    this._killRequested = false;
    logger.debug("supervisor:turn_start", { sessionId: opts.sessionId });

    this.currentTurn = runAgentTurn(opts)
      .then(async () => {
        this._phase = "idle";
        if (this._killRequested) {
          logger.debug("supervisor:turn_killed", { sessionId: opts.sessionId });
        } else {
          logger.debug("supervisor:turn_done", { sessionId: opts.sessionId });
        }
        await callbacks?.onDone?.();
      })
      .catch(async (error) => {
        this._phase = "idle";
        const err = error as Error;
        logger.warn("supervisor:turn_error", {
          sessionId: opts.sessionId,
          error: err.message ?? String(err),
          name: err.name,
        });
        await callbacks?.onError?.(err);
      })
      .finally(() => {
        this.currentTurn = null;
        this._killRequested = false;
      });
  }

  /** Request that the current turn be killed. This does NOT directly abort
   *  the turn — the caller must abort the AbortScope that was passed to
   *  `startTurn`. This method only records the intent so the supervisor
   *  knows the turn was intentionally killed rather than failing. */
  killTurn(): void {
    if (!this.isRunning) return;
    this._killRequested = true;
    logger.debug("supervisor:kill_requested", { phase: this._phase });
  }

  /** Spawn multiple research/executor workers in parallel and return their results.
   *
   * Workers are batched according to KIMIFLARE_WORKER_MAX_PARALLEL (default 3).
   * Each worker POSTs to `${endpoint}/worker` with the mission brief.
   *
   * NOTE: This is currently only invoked programmatically (not wired to auto-triage).
   * Future: the coordinator will call this automatically when intent classification
   * signals a "heavy" task (see docs/plans/multi-agent-standalone-workers-plan.md).
   */
  async spawnWorkers(
    workers: SpawnWorkerOpts[],
    onUpdate?: (workers: ActiveWorker[]) => void,
  ): Promise<WorkerResultMessage[]> {
    const endpoint = process.env.KIMIFLARE_WORKER_ENDPOINT;
    if (!endpoint) {
      throw new Error("Worker endpoint not configured. Set KIMIFLARE_WORKER_ENDPOINT.");
    }

    const apiKey = process.env.KIMIFLARE_WORKER_API_KEY;
    const maxParallel = Math.min(
      workers.length,
      parseInt(process.env.KIMIFLARE_WORKER_MAX_PARALLEL ?? "3", 10),
    );

    // Register all workers as pending
    for (const w of workers) {
      const id = `worker-${crypto.randomUUID().slice(0, 8)}`;
      this._activeWorkers.set(id, {
        id,
        mode: w.mode,
        task: w.task,
        status: "pending",
        startedAt: Date.now(),
      });
    }
    onUpdate?.(this.activeWorkers);

    const results: WorkerResultMessage[] = [];
    const queue = [...workers];

    async function runBatch(batch: SpawnWorkerOpts[]): Promise<void> {
      await Promise.all(
        batch.map(async (w) => {
          const workerId = [...TurnSupervisor.prototype._activeWorkers.entries()].find(
            ([, aw]) => aw.task === w.task && aw.status === "pending",
          )?.[0];
          if (!workerId) return;

          const worker = TurnSupervisor.prototype._activeWorkers.get(workerId)!;
          worker.status = "running";
          onUpdate?.([...TurnSupervisor.prototype._activeWorkers.values()]);

          try {
            const payload = {
              mode: w.mode,
              task: w.task,
              context: w.context ?? "",
              budget: { maxCostUsd: w.budgetUsd ?? 1.0 },
              outputFormat: "structured" as const,
              tools: w.mode === "plan" ? ("read-only" as const) : ("all" as const),
              model: w.model ?? "@cf/moonshotai/kimi-k2.6",
              ...(w.mode === "execute"
                ? {
                    branchName: w.branchName,
                    baseBranch: w.baseBranch ?? "main",
                    prTitle: w.prTitle,
                    prBody: w.prBody,
                  }
                : {}),
            };

            const controller = new AbortController();
            const timeoutMs = parseInt(process.env.KIMIFLARE_WORKER_TIMEOUT_MS ?? "300000", 10);
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            const res = await fetch(`${endpoint}/worker`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(apiKey ? { "X-Worker-Api-Key": apiKey } : {}),
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
            clearTimeout(timer);

            if (!res.ok) {
              const text = await res.text().catch(() => "");
              throw new Error(`Worker endpoint returned ${res.status}: ${text.slice(0, 200)}`);
            }

            const data = (await res.json()) as WorkerResultMessage;
            worker.status = data.status === "completed" ? "completed" : "failed";
            worker.result = data;
            if (data.status === "completed") {
              results.push(data);
            }
          } catch (e) {
            worker.status = "failed";
            worker.error = (e as Error).message;
            logger.error("spawnWorkers:failed", { workerId, error: (e as Error).message });
          }
          onUpdate?.([...TurnSupervisor.prototype._activeWorkers.values()]);
        }),
      );
    }

    while (queue.length > 0) {
      const batch = queue.splice(0, maxParallel);
      await runBatch(batch);
    }

    return results;
  }

  /** Synthesize findings from multiple workers into a unified execution plan.
   *
   * Steps:
   * 1. Deduplicate findings by topic (case-insensitive).
   * 2. Detect conflicts — same topic with different recommendations.
   * 3. Produce a markdown execution plan the coordinator can present to the user
   *    or feed into an executor worker.
   *
   * TODO: Conflict resolution currently just flags conflicts; it does not pick
   * a winner. A future improvement could use confidence scores or a tie-breaker
   * LLM call to resolve conflicts automatically.
   */
  synthesizeFindings(results: WorkerResultMessage[]): {
    plan: string;
    conflicts: string[];
    recommendations: string[];
  } {
    const allFindings = results.flatMap((r) => r.findings);
    const allRecommendations = results.flatMap((r) => r.recommendations);

    // Deduplicate by topic
    const seenTopics = new Set<string>();
    const dedupedFindings = allFindings.filter((f) => {
      const key = f.topic.toLowerCase().trim();
      if (seenTopics.has(key)) return false;
      seenTopics.add(key);
      return true;
    });

    // Detect conflicts: same topic with different recommendations
    const conflicts: string[] = [];
    const topicRecs = new Map<string, Set<string>>();
    for (const r of allRecommendations) {
      const lower = r.toLowerCase();
      for (const f of dedupedFindings) {
        if (lower.includes(f.topic.toLowerCase())) {
          const set = topicRecs.get(f.topic) ?? new Set();
          set.add(r);
          topicRecs.set(f.topic, set);
        }
      }
    }
    for (const [topic, recs] of topicRecs) {
      if (recs.size > 1) {
        conflicts.push(`Topic "${topic}" has conflicting recommendations: ${[...recs].join(" vs ")}`);
      }
    }

    const planLines: string[] = [
      "# Synthesized Execution Plan",
      "",
      "## Findings Summary",
      ...dedupedFindings.map(
        (f) => `- **${f.topic}** (${f.confidence}): ${f.summary}`,
      ),
      "",
      "## Recommendations",
      ...[...new Set(allRecommendations)].map((r) => `- ${r}`),
    ];

    if (conflicts.length > 0) {
      planLines.push("", "## Conflicts to Resolve", ...conflicts.map((c) => `- ${c}`));
    }

    return {
      plan: planLines.join("\n"),
      conflicts,
      recommendations: [...new Set(allRecommendations)],
    };
  }

  /** Automatically spawn research workers for a heavy prompt.
   *
   * Decomposes the prompt into 2-4 parallel research tasks using a simple
   * heuristic (split on "and" / commas when multiple distinct topics are
   * mentioned). Falls back to 2 angled tasks when decomposition is unclear.
   *
   * Returns the synthesized plan after all workers complete.
   */
  async autoSpawnWorkers(
    prompt: string,
    context: string,
    onUpdate?: (workers: ActiveWorker[]) => void,
  ): Promise<{ plan: string; conflicts: string[]; recommendations: string[] }> {
    const workers = decomposePrompt(prompt, context);
    const results = await this.spawnWorkers(workers, onUpdate);
    return this.synthesizeFindings(results);
  }

  clearWorkers(): void {
    this._activeWorkers.clear();
  }
}

/** Simple heuristic to decompose a heavy prompt into parallel research tasks.
 *
 * Looks for:
 * - Lists: "research X, Y, and Z" → 3 workers
 * - Conjunctions: "research X and Y" → 2 workers
 * - Fallback: 2 workers with different angles (overview + deep-dive)
 */
function decomposePrompt(prompt: string, context: string): SpawnWorkerOpts[] {
  // Try to find comma-separated or "and"-separated research topics
  const listMatch = prompt.match(/research\s+(.+?)(?:\s+and\s+|,\s+)(.+)/i);
  if (listMatch) {
    const parts = prompt
      .replace(/research\s+/i, "")
      .split(/\s+and\s+|,\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length >= 2) {
      return parts.slice(0, 4).map((task) => ({
        mode: "plan" as const,
        task: `Research ${task}`,
        context,
      }));
    }
  }

  // Fallback: 2 workers with different angles
  return [
    {
      mode: "plan",
      task: `Research overview and best practices for: ${prompt}`,
      context,
    },
    {
      mode: "plan",
      task: `Research implementation details and migration path for: ${prompt}`,
      context,
    },
  ];
}
