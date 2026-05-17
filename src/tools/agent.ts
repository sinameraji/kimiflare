/**
 * `Agent` tool — model-invoked entry point to spawn a subagent.
 *
 * The orchestration lives in `src/agent/subagent.ts`. This file is the
 * thin contract: validate inputs, delegate to the runner the loop has
 * injected via `ctx.runSubagent`, and shape the response for the parent.
 *
 * Tier-gated: this tool is only registered for the parent's turn when
 * the intent classification says `medium` (explore-only) or `heavy`
 * (all preset types). Tier gating happens at the call-site that builds
 * the tools array — the tool itself does not re-check tier.
 */
import type { ToolSpec } from "./registry.js";
import { ToolError } from "./tool-error.js";
import { isValidSubagentType, listPresets } from "../subagents/presets.js";

interface AgentArgs {
  description: string;
  prompt: string;
  subagent_type: string;
  task_id?: string;
}

const PRESET_LINES = listPresets()
  .map((p) => `  - ${p.type}: ${p.description}`)
  .join("\n");

export const agentTool: ToolSpec<AgentArgs> = {
  name: "Agent",
  description: [
    "Dispatch a subagent to perform a focused sub-task with isolated context.",
    "Use this on heavy tasks that decompose naturally (e.g. independent",
    "investigations, parallel research, isolated implementation steps).",
    "The child has its own fresh message history and its own (filtered)",
    "tool list; you receive only the child's final summary. Sibling",
    "subagents do not see each other's work — if you need to compose",
    "results, include earlier child summaries in the next child's prompt.",
    "",
    "Available subagent types:",
    PRESET_LINES,
    "",
    "Caps that apply:",
    "  - Max 8 children per turn, 25 per session.",
    "  - Children cannot themselves spawn children (depth cap = 2).",
    "  - A child can never have looser mode than the parent.",
    "",
    "Provide a one-line `description` (shown in the UI) and a focused,",
    "self-contained `prompt` for the child. Optionally tag with `task_id`",
    "if this child satisfies an entry in your plan.",
  ].join("\n"),
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Short (3-7 word) label rendered in the UI for this subagent invocation.",
      },
      prompt: {
        type: "string",
        description:
          "The full task brief for the child. Self-contained: the child does not see your conversation history.",
      },
      subagent_type: {
        type: "string",
        enum: ["general", "explore", "plan"],
        description:
          "Which preset to dispatch. `explore` is read-only and fastest; `plan` is read-only tuned for design tradeoffs; `general` can mutate code/run shell (subject to mode).",
      },
      task_id: {
        type: "string",
        description: "Optional plan task ID this subagent satisfies. Helps with telemetry and memory extraction.",
      },
    },
    required: ["description", "prompt", "subagent_type"],
  },
  needsPermission: false,
  render: (args) => {
    const type = isValidSubagentType(args.subagent_type) ? args.subagent_type : "?";
    return {
      title: `Agent(${type})`,
      body: args.description ? `→ ${args.description}` : undefined,
    };
  },
  run: async (args, ctx) => {
    if (!ctx.runSubagent) {
      throw new ToolError({
        code: "not_found",
        message:
          "Subagent runner unavailable in this context. This usually means tier-gating disabled subagents for this turn.",
      });
    }
    if (typeof args.description !== "string" || args.description.trim().length === 0) {
      throw new ToolError({
        code: "invalid_args",
        message: "Agent requires a non-empty `description`.",
      });
    }
    if (!isValidSubagentType(args.subagent_type)) {
      throw new ToolError({
        code: "invalid_args",
        message: `Unknown subagent_type "${String(args.subagent_type)}". Valid: general | explore | plan.`,
      });
    }

    const result = await ctx.runSubagent({
      description: args.description,
      prompt: args.prompt,
      subagent_type: args.subagent_type,
      task_id: args.task_id,
    });

    // Frame the response so the parent model has clear context that
    // this output came from a child (not its own tool execution).
    const header = `[Agent(${args.subagent_type}) — ${args.description} — ${result.toolCallCount} tool calls, ${result.durationMs}ms]`;
    return `${header}\n\n${result.summary}`;
  },
};
