import type { ToolSpec } from "./registry.js";
import { validateTasks, type Task } from "../tasks-state.js";

interface TasksSetArgs {
  tasks: Task[];
}

export const tasksSetTool: ToolSpec<TasksSetArgs> = {
  name: "tasks_set",
  description: [
    "Set the visible task list shown to the user during this turn.",
    "Call this when the user has given you a multi-step job, or whenever progress changes:",
    "at the start (all tasks pending, with exactly one in_progress), and after each step completes",
    "(flip that task to completed and the next to in_progress).",
    "Pass the ENTIRE task list each call — this replaces the panel.",
    "Keep tasks short (one imperative clause). Only one should be in_progress at a time.",
    "For quick single-step requests, don't use this tool at all.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "The full, ordered list of tasks. Pass every call.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Stable short id (e.g. '1', '2')." },
            title: { type: "string", description: "Short imperative task title." },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "Only one task should be 'in_progress' at a time.",
            },
          },
          required: ["id", "title", "status"],
        },
      },
    },
    required: ["tasks"],
  },
  needsPermission: false,
  render: (args) => ({
    title: `tasks (${args.tasks.length} items)`,
    body: args.tasks
      .map((t) => `${t.status === "completed" ? "✓" : t.status === "in_progress" ? "▸" : "·"} ${t.title}`)
      .join("\n"),
  }),
  run: async (args, ctx) => {
    let tasks: Task[];
    try {
      tasks = validateTasks(args.tasks);
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
    ctx.onTasks?.(tasks);
    const summary = `${tasks.length} tasks set — ${tasks.filter((t) => t.status === "completed").length} done, ${tasks.filter((t) => t.status === "in_progress").length} active, ${tasks.filter((t) => t.status === "pending").length} pending`;
    return summary;
  },
};
