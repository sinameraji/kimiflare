/**
 * `plan_set` and `plan_update` tools.
 *
 * Load-bearing: the loop reads the plan state (see
 * `src/agent/plan-state.ts`) to decide whether a heavy-tier turn can
 * end naturally. These tools are tier-gated to `heavy` at the
 * tool-registration call site.
 */
import type { ToolSpec } from "./registry.js";
import { ToolError } from "./tool-error.js";
import {
  setPlan,
  updatePlanTask,
  summarizePlan,
  isValidPlanTaskStatus,
  PlanTaskNotFoundError,
  type PlanTask,
  type SubagentTypeHint,
} from "../agent/plan-state.js";

interface PlanSetArgs {
  tasks: Array<{
    id?: string;
    description: string;
    status?: string;
    assigned_agent_type?: string;
    depends_on?: string[];
    notes?: string;
  }>;
}

interface PlanUpdateArgs {
  task_id: string;
  status: string;
  notes?: string;
}

function validateAgentType(s: unknown): SubagentTypeHint | undefined {
  if (s === "general" || s === "explore" || s === "plan") return s;
  return undefined;
}

export const planSetTool: ToolSpec<PlanSetArgs> = {
  name: "plan_set",
  description: [
    "Set the load-bearing plan for this turn. The loop reads this plan and",
    "will NOT let the turn end while tasks are still pending or in_progress",
    "(up to a small stall cap, after which it ends anyway).",
    "",
    "Use this on heavy multi-step tasks to keep yourself honest: decompose",
    "the goal into discrete tasks, dispatch each via the Agent tool, and",
    "mark them complete or abandoned via plan_update as you go.",
    "",
    "Each call REPLACES the entire plan. To revise an existing plan,",
    "include all surviving tasks (with their current status) plus any new",
    "ones. Use plan_update to flip statuses without rewriting descriptions.",
    "",
    "For light tasks, don't call plan_set at all — the loop ends naturally",
    "the moment you stop emitting tool calls.",
  ].join("\n"),
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "Full ordered task list. Replaces the plan in its entirety.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Stable short id (e.g. 't1'). If omitted, auto-assigned from index.",
            },
            description: {
              type: "string",
              description: "One-line imperative description of the task.",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed", "abandoned"],
              description: "Defaults to 'pending'.",
            },
            assigned_agent_type: {
              type: "string",
              enum: ["general", "explore", "plan"],
              description: "Optional hint for which subagent type will handle this task.",
            },
            depends_on: {
              type: "array",
              items: { type: "string" },
              description: "Task IDs that must complete before this one starts.",
            },
            notes: {
              type: "string",
              description: "Optional notes (e.g. why abandoned).",
            },
          },
          required: ["description"],
        },
      },
    },
    required: ["tasks"],
  },
  needsPermission: false,
  render: (args) => {
    const tasks = Array.isArray(args.tasks) ? args.tasks : [];
    return {
      title: `plan (${tasks.length} tasks)`,
      body: tasks
        .map((t, i) => {
          const status = t.status ?? "pending";
          const mark =
            status === "completed" ? "✓" :
            status === "in_progress" ? "▸" :
            status === "abandoned" ? "✗" : "·";
          return `${mark} ${t.id ?? i + 1}: ${t.description}`;
        })
        .join("\n"),
    };
  },
  run: async (args, ctx) => {
    if (!Array.isArray(args.tasks)) {
      throw new ToolError({
        code: "invalid_args",
        message: "plan_set: `tasks` must be an array.",
      });
    }
    const normalized: PlanTask[] = args.tasks.map((t, i) => {
      const description = typeof t.description === "string" ? t.description.trim() : "";
      if (!description) {
        throw new ToolError({
          code: "invalid_args",
          message: `plan_set: tasks[${i}].description is required and must be non-empty.`,
        });
      }
      const status = isValidPlanTaskStatus(t.status) ? t.status : "pending";
      return {
        id: typeof t.id === "string" && t.id.length > 0 ? t.id : `t${i + 1}`,
        description,
        status,
        assigned_agent_type: validateAgentType(t.assigned_agent_type),
        depends_on: Array.isArray(t.depends_on) ? t.depends_on.filter((s): s is string => typeof s === "string") : undefined,
        notes: typeof t.notes === "string" ? t.notes : undefined,
      };
    });
    setPlan(ctx.sessionId, normalized);
    const sum = summarizePlan(ctx.sessionId);
    return `Plan set: ${sum.total} tasks (${sum.pending} pending, ${sum.in_progress} in_progress, ${sum.completed} completed, ${sum.abandoned} abandoned).`;
  },
};

export const planUpdateTool: ToolSpec<PlanUpdateArgs> = {
  name: "plan_update",
  description: [
    "Update the status of one task in the current plan.",
    "Use this between Agent calls to mark tasks complete, or to mark",
    "tasks 'abandoned' (with a `notes` field) when you've decided not to",
    "pursue them — this is the graceful way to let the turn end if a",
    "task turned out to be unnecessary.",
  ].join("\n"),
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the task to update." },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "abandoned"],
      },
      notes: {
        type: "string",
        description: "Reason / outcome. Required for `abandoned` for clarity.",
      },
    },
    required: ["task_id", "status"],
  },
  needsPermission: false,
  render: (args) => ({
    title: `plan_update ${args.task_id} → ${args.status}`,
    body: args.notes,
  }),
  run: async (args, ctx) => {
    if (!isValidPlanTaskStatus(args.status)) {
      throw new ToolError({
        code: "invalid_args",
        message: `plan_update: invalid status "${String(args.status)}".`,
      });
    }
    if (args.status === "abandoned" && (typeof args.notes !== "string" || args.notes.trim().length === 0)) {
      throw new ToolError({
        code: "invalid_args",
        message: "plan_update: marking a task `abandoned` requires a non-empty `notes` field explaining why.",
      });
    }
    try {
      const t = updatePlanTask(ctx.sessionId, {
        task_id: args.task_id,
        status: args.status,
        notes: args.notes,
      });
      const sum = summarizePlan(ctx.sessionId);
      return `Task ${t.id} → ${t.status}. Plan: ${sum.completed}/${sum.total} done, ${sum.outstanding.length} outstanding.`;
    } catch (e) {
      if (e instanceof PlanTaskNotFoundError) {
        throw new ToolError({
          code: "not_found",
          message: e.message,
          suggestion: "list current plan via plan_set with the surviving tasks, or use the correct task_id",
        });
      }
      throw e;
    }
  },
};
