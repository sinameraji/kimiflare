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
import { detectRepoInfo, type RepoInfo } from "../util/repo-info.js";

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

    // Sandbox-driven workers need a repo to clone — detect once.
    const repoInfo = detectRepoInfo();
    if ("error" in repoInfo) {
      throw new Error(`cannot spawn workers: ${repoInfo.error}`);
    }
    const repo: RepoInfo = repoInfo;

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
    // Capture the instance Map so the inner runBatch (a regular function with
    // its own `this`) can reach it. Earlier this used `TurnSupervisor.prototype._activeWorkers`,
    // which is undefined because _activeWorkers is an instance field, not on
    // the prototype — that caused "Cannot read properties of undefined (reading 'entries')".
    const activeWorkers = this._activeWorkers;

    async function runBatch(batch: SpawnWorkerOpts[]): Promise<void> {
      await Promise.all(
        batch.map(async (w) => {
          const workerId = [...activeWorkers.entries()].find(
            ([, aw]) => aw.task === w.task && aw.status === "pending",
          )?.[0];
          if (!workerId) return;

          const worker = activeWorkers.get(workerId)!;
          worker.status = "running";
          onUpdate?.([...activeWorkers.values()]);

          try {
            const payload = {
              mode: w.mode,
              task: w.task,
              context: w.context ?? "",
              budget: { maxCostUsd: w.budgetUsd ?? 1.0 },
              outputFormat: "structured" as const,
              tools: w.mode === "plan" ? ("read-only" as const) : ("all" as const),
              model: w.model ?? "@cf/moonshotai/kimi-k2.6",
              // Sandbox-driven worker needs the repo to clone:
              githubToken: repo.token,
              owner: repo.owner,
              repo: repo.repo,
              baseBranch: w.baseBranch ?? repo.baseBranch,
              // Optionally override the in-sandbox kimiflare install so the
              // worker runs pre-release / branch code instead of the image-
              // baked version. e.g. `kimiflare@latest`, `kimiflare@1.2.3`,
              // `github:sinameraji/kimiflare#feat/foo`.
              ...(process.env.KIMIFLARE_CLI_REF
                ? { kimiflareInstall: process.env.KIMIFLARE_CLI_REF }
                : {}),
              ...(w.mode === "execute"
                ? {
                    branchName: w.branchName,
                    prTitle: w.prTitle,
                    prBody: w.prBody,
                  }
                : {}),
            };

            const controller = new AbortController();
            // Sandbox workers take 1-4 min typical (artifact + clone + agent loop + push).
            // 10 min default leaves headroom; override with KIMIFLARE_WORKER_TIMEOUT_MS.
            const timeoutMs = parseInt(process.env.KIMIFLARE_WORKER_TIMEOUT_MS ?? "600000", 10);
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
          onUpdate?.([...activeWorkers.values()]);
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
   * 1. Deduplicate findings by topic (case-insensitive), keeping the highest-confidence version.
   * 2. Detect conflicts — same topic with different recommendations.
   * 3. Tie-breaker: when conflicting recommendations exist, prefer the one from
   *    the worker with higher average confidence.
   * 4. Produce a markdown execution plan the coordinator can present to the user
   *    or feed into an executor worker.
   */
  synthesizeFindings(results: WorkerResultMessage[]): {
    plan: string;
    conflicts: string[];
    recommendations: string[];
  } {
    const allFindings = results.flatMap((r) => r.findings);
    const allRecommendations = results.flatMap((r) => r.recommendations);

    // Confidence score mapping for tie-breaking
    const CONFIDENCE_SCORE = { high: 3, medium: 2, low: 1 };

    // Deduplicate by topic, keeping the highest-confidence finding
    const topicToFinding = new Map<string, (typeof allFindings)[0]>();
    for (const f of allFindings) {
      const key = f.topic.toLowerCase().trim();
      const existing = topicToFinding.get(key);
      if (!existing || CONFIDENCE_SCORE[f.confidence] > CONFIDENCE_SCORE[existing.confidence]) {
        topicToFinding.set(key, f);
      }
    }
    const dedupedFindings = [...topicToFinding.values()];

    // Detect conflicts: same topic with different recommendations
    // Tie-breaker: prefer recommendations from higher-confidence workers
    const conflicts: string[] = [];
    const topicRecs = new Map<string, Map<string, number>>(); // topic -> rec -> max confidence score
    for (const r of allRecommendations) {
      const lower = r.toLowerCase();
      for (const f of dedupedFindings) {
        if (lower.includes(f.topic.toLowerCase())) {
          const recMap = topicRecs.get(f.topic) ?? new Map();
          const currentScore = recMap.get(r) ?? 0;
          const newScore = CONFIDENCE_SCORE[f.confidence];
          if (newScore > currentScore) {
            recMap.set(r, newScore);
          }
          topicRecs.set(f.topic, recMap);
        }
      }
    }

    const resolvedRecommendations: string[] = [];
    for (const [topic, recMap] of topicRecs) {
      const recs = [...recMap.entries()];
      if (recs.length > 1) {
        // Sort by confidence score descending and pick the highest
        recs.sort((a, b) => b[1] - a[1]);
        const winner = recs[0]![0];
        const losers = recs.slice(1).map((r) => r[0]);
        conflicts.push(`Topic "${topic}" had conflicting recommendations; preferred "${winner}" over ${losers.join(" / ")}`);
        resolvedRecommendations.push(winner);
      } else if (recs.length === 1) {
        resolvedRecommendations.push(recs[0]![0]);
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
      ...resolvedRecommendations.map((r) => `- ${r}`),
    ];

    if (conflicts.length > 0) {
      planLines.push("", "## Conflicts Resolved", ...conflicts.map((c) => `- ${c}`));
    }

    return {
      plan: planLines.join("\n"),
      conflicts,
      recommendations: resolvedRecommendations,
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
  ): Promise<{
    plan: string;
    conflicts: string[];
    recommendations: string[];
    prUrl?: string;
    executor?: { status: "completed" | "failed"; error?: string };
  }> {
    const workers = decomposePrompt(prompt, context);
    const results = await this.spawnWorkers(workers, onUpdate);
    const synth = this.synthesizeFindings(results);

    // Auto plan→execute chain ("the 4th agent"). Off by default for safety;
    // opt in with KIMIFLARE_AUTO_EXECUTE=1. Only fires when synthesis produced
    // actionable recommendations.
    const autoExecute = /^(1|true|yes|on)$/i.test(process.env.KIMIFLARE_AUTO_EXECUTE ?? "");
    if (!autoExecute || synth.recommendations.length === 0) {
      return synth;
    }

    const executeTask = [
      `Original request: ${prompt}`,
      "",
      "A research pass produced this plan. Implement it.",
      "",
      synth.plan,
    ].join("\n");

    try {
      const execResults = await this.spawnWorkers(
        [{ mode: "execute", task: executeTask, context }],
        onUpdate,
      );
      const exec = execResults[0];
      if (!exec) {
        return { ...synth, executor: { status: "failed", error: "executor worker did not return a result" } };
      }
      return {
        ...synth,
        prUrl: exec.prUrl,
        executor: { status: exec.status === "completed" ? "completed" : "failed", error: exec.error },
      };
    } catch (err) {
      return { ...synth, executor: { status: "failed", error: err instanceof Error ? err.message : String(err) } };
    }
  }

  clearWorkers(): void {
    this._activeWorkers.clear();
  }
}

/** Conservative heuristic to decompose a heavy prompt into parallel research tasks.
 *
 * Only splits the prompt when the user gave EXPLICIT list structure — numbered
 * (`1. … 2. … 3. …`) or bulleted (`- …`/`* …`) — because that's the only
 * cheap signal that's reliably a list. Earlier this also split on any
 * conjunction or comma, which chopped cohesive sentences like "do heavy
 * exploration AND research IN this project AND identify…" into nonsense
 * fragments.
 *
 * For prose prompts (no explicit list), spawn 2 workers with the FULL prompt
 * preserved and different angles. The synthesizer dedups overlapping findings,
 * so two well-formed angles beat N fragmented ones.
 */
export function decomposePrompt(prompt: string, context: string): SpawnWorkerOpts[] {
  const items = extractListItems(prompt);
  if (items.length >= 2) {
    return items.slice(0, 4).map((task) => ({ mode: "plan" as const, task, context }));
  }
  return [
    { mode: "plan", task: `Research overview and best practices for: ${prompt}`, context },
    { mode: "plan", task: `Investigate implementation details, trade-offs, and risks for: ${prompt}`, context },
  ];
}

/** Pull explicit list items from a prompt: numbered (`1. …`, `1) …`) or
 *  bulleted (`- …`, `* …`, `• …`). Returns trimmed item bodies, or [] when
 *  no clear list structure is present. */
function extractListItems(prompt: string): string[] {
  const numbered = [...prompt.matchAll(/(?:^|\n)\s*\d+[.)]\s+([^\n]+)/g)].map((m) => m[1]?.trim() ?? "");
  if (numbered.length >= 2) return numbered.filter((s) => s.length > 0);
  const bulleted = [...prompt.matchAll(/(?:^|\n)\s*[-*•]\s+([^\n]+)/g)].map((m) => m[1]?.trim() ?? "");
  if (bulleted.length >= 2) return bulleted.filter((s) => s.length > 0);
  return [];
}
