/**
 * Load-bearing plan state.
 *
 * Unlike `tasks_set` (which is narrative-only UI display), the plan
 * here is read by the loop to decide whether the turn can terminate
 * naturally. If the model emits no tool calls while the plan still has
 * non-terminal entries, the loop nudges it to either dispatch the
 * remaining work or mark tasks abandoned with a reason.
 *
 * The plan is per-session and persists across turns within the session
 * — that matches how the rest of the per-session state is keyed
 * (drift events, web-fetch history, memory-extraction errors, …).
 *
 * Plan tools are tier-gated to `heavy`. Lighter turns don't even see
 * the tools, so the loop's plan nudge is naturally inert for them.
 *
 * See `docs/plans/m7-subagent-primitive.md`.
 */
import { logger } from "../util/logger.js";

export type PlanTaskStatus = "pending" | "in_progress" | "completed" | "abandoned";

export type SubagentTypeHint = "general" | "explore" | "plan";

export interface PlanTask {
  id: string;
  description: string;
  status: PlanTaskStatus;
  /** Which subagent type the model expects to use for this task, if any. */
  assigned_agent_type?: SubagentTypeHint;
  depends_on?: string[];
  notes?: string;
}

const plans = new Map<string, PlanTask[]>();

/** Maximum consecutive "no tool calls but plan not done" iterations
 *  before we let the turn end anyway. Prevents an infinite stall when
 *  the model genuinely cannot make progress. */
export const MAX_PLAN_STALLS = 3;

/** Per-session stall counter. Reset whenever the model emits tool
 *  calls (real progress) or the plan reaches a fully terminal state. */
const stallCounts = new Map<string, number>();

export function _resetPlanStateForTests(): void {
  plans.clear();
  stallCounts.clear();
}

const TERMINAL_STATUSES: PlanTaskStatus[] = ["completed", "abandoned"];

function isTerminal(t: PlanTask): boolean {
  return TERMINAL_STATUSES.includes(t.status);
}

export function getPlan(sessionId: string | undefined): PlanTask[] {
  return plans.get(sessionId ?? "default") ?? [];
}

export function setPlan(sessionId: string | undefined, tasks: PlanTask[]): void {
  const key = sessionId ?? "default";
  plans.set(key, tasks);
  // A fresh plan resets stall accounting — the model has shown
  // structural progress by re-decomposing.
  stallCounts.delete(key);
  logger.debug("plan.set", {
    sessionId: key,
    count: tasks.length,
    terminal: tasks.filter(isTerminal).length,
  });
}

export interface PlanUpdateInput {
  task_id: string;
  status: PlanTaskStatus;
  notes?: string;
}

export class PlanTaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Plan task "${taskId}" not found.`);
    this.name = "PlanTaskNotFoundError";
  }
}

export function updatePlanTask(
  sessionId: string | undefined,
  input: PlanUpdateInput,
): PlanTask {
  const key = sessionId ?? "default";
  const tasks = plans.get(key);
  if (!tasks) throw new PlanTaskNotFoundError(input.task_id);
  const idx = tasks.findIndex((t) => t.id === input.task_id);
  if (idx === -1) throw new PlanTaskNotFoundError(input.task_id);
  const updated: PlanTask = {
    ...tasks[idx]!,
    status: input.status,
    notes: input.notes ?? tasks[idx]!.notes,
  };
  tasks[idx] = updated;
  logger.debug("plan.update", {
    sessionId: key,
    task_id: input.task_id,
    status: input.status,
  });
  return updated;
}

/** Snapshot summary used both by the loop for nudge messages and by
 *  the tool `run` return values. */
export interface PlanSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  abandoned: number;
  /** True when every task is in a terminal status. An empty plan also
   *  counts as "all terminal" — nothing to wait on. */
  allTerminal: boolean;
  /** Tasks that are still actionable (pending or in_progress). */
  outstanding: PlanTask[];
}

export function summarizePlan(sessionId: string | undefined): PlanSummary {
  const tasks = getPlan(sessionId);
  const counts: Record<PlanTaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    abandoned: 0,
  };
  for (const t of tasks) counts[t.status]++;
  const outstanding = tasks.filter((t) => !isTerminal(t));
  return {
    total: tasks.length,
    pending: counts.pending,
    in_progress: counts.in_progress,
    completed: counts.completed,
    abandoned: counts.abandoned,
    allTerminal: outstanding.length === 0,
    outstanding,
  };
}

/** Called from the loop's natural-termination branch. Returns one of:
 *   - `null`: the turn may end (plan is empty / all terminal, or the
 *     stall cap has been exceeded so we let the model out gracefully).
 *   - `{ nudge }`: a system-message string to inject into the conversation
 *     before the next iteration, prompting the model to either dispatch
 *     remaining work or mark tasks abandoned.
 */
export function nextStallAction(sessionId: string | undefined): { nudge: string } | null {
  const summary = summarizePlan(sessionId);
  if (summary.allTerminal) {
    stallCounts.delete(sessionId ?? "default");
    return null;
  }
  const key = sessionId ?? "default";
  const stalls = (stallCounts.get(key) ?? 0) + 1;
  stallCounts.set(key, stalls);
  if (stalls > MAX_PLAN_STALLS) {
    logger.warn("plan.stall_cap_exceeded", {
      sessionId: key,
      stalls,
      outstanding: summary.outstanding.length,
    });
    stallCounts.delete(key);
    return null;
  }
  const outstandingList = summary.outstanding
    .map((t) => `  - [${t.status}] ${t.id}: ${t.description}`)
    .join("\n");
  return {
    nudge: [
      `Plan check: you produced no tool calls, but your plan still has ${summary.outstanding.length} outstanding task(s):`,
      "",
      outstandingList,
      "",
      "Either dispatch the next task (e.g. via the Agent tool), or call",
      "`plan_update` to mark tasks abandoned with a `notes` field explaining",
      "why. After all tasks are terminal, the turn ends naturally.",
      "",
      `(Stall ${stalls}/${MAX_PLAN_STALLS}. After ${MAX_PLAN_STALLS} stalls the turn ends anyway.)`,
    ].join("\n"),
  };
}

/** Reset the stall counter for a session — called when the model
 *  resumes emitting tool calls. */
export function clearStall(sessionId: string | undefined): void {
  stallCounts.delete(sessionId ?? "default");
}

export function isValidPlanTaskStatus(s: unknown): s is PlanTaskStatus {
  return s === "pending" || s === "in_progress" || s === "completed" || s === "abandoned";
}
