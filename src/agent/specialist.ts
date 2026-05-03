import { runAgentTurn } from "./loop.js";
import type { AgentTurnOpts, TurnResult } from "./loop.js";
import type { Persona } from "./persona.js";
import { toolsForPersona } from "./persona.js";
import type { ChatMessage } from "./messages.js";
import { buildSystemPrompt } from "./system-prompt.js";

export interface SpecialistOpts extends Omit<AgentTurnOpts, "messages" | "tools" | "maxToolIterations"> {
  persona: Persona;
  task: string;
  files?: string[];
  constraints?: string;
  sources?: string[];
  depth?: "quick" | "thorough";
  maxIterations?: number;
  allTools: AgentTurnOpts["tools"];
}

export interface SpecialistResult {
  summary: string;
  artifacts: { type: string; content: string }[];
  status: "complete" | "blocked" | "partial";
  blocker?: string;
  toolCallsMade: number;
}

export async function runSpecialistTurn(opts: SpecialistOpts): Promise<SpecialistResult> {
  const { persona, task, files, constraints, sources, depth, maxIterations, allTools, ...agentOpts } = opts;

  const tools = toolsForPersona(persona, allTools);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        cwd: agentOpts.cwd,
        tools,
        model: agentOpts.model,
        role: persona,
      }),
    },
    {
      role: "user",
      content: buildTaskPrompt({ persona, task, files, constraints, sources, depth }),
    },
  ];

  let toolCallsMade = 0;
  const originalOnToolCallFinalized = agentOpts.callbacks?.onToolCallFinalized;
  const callbacks = {
    ...agentOpts.callbacks,
    onToolCallFinalized: (call: import("./messages.js").ToolCall) => {
      toolCallsMade++;
      originalOnToolCallFinalized?.(call);
    },
  };

  const result = await runAgentTurn({
    ...agentOpts,
    messages,
    tools,
    maxToolIterations: maxIterations ?? (persona === "research" ? 20 : 30),
    callbacks,
    sessionId: undefined, // specialists don't share the generalist's session affinity
  });

  // Extract the final assistant message as the summary
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  const summary = typeof lastAssistant?.content === "string" ? lastAssistant.content : "No response from specialist.";

  // Determine status based on whether the turn was paused (budget exhausted)
  const status: SpecialistResult["status"] = result.paused ? "partial" : "complete";

  return {
    summary,
    artifacts: [], // TODO: extract diffs/files from tool results in future iteration
    status,
    blocker: result.paused ? `Hit tool call limit after ${toolCallsMade} calls. Need more budget to finish.` : undefined,
    toolCallsMade,
  };
}

function buildTaskPrompt(ctx: {
  persona: Persona;
  task: string;
  files?: string[];
  constraints?: string;
  sources?: string[];
  depth?: "quick" | "thorough";
}): string {
  const parts: string[] = [ctx.task];
  if (ctx.files && ctx.files.length > 0) {
    parts.push(`\n\nRelevant files:\n${ctx.files.map((f) => `- ${f}`).join("\n")}`);
  }
  if (ctx.constraints) {
    parts.push(`\n\nConstraints: ${ctx.constraints}`);
  }
  if (ctx.sources && ctx.sources.length > 0) {
    parts.push(`\n\nPrioritize these sources:\n${ctx.sources.map((s) => `- ${s}`).join("\n")}`);
  }
  if (ctx.depth) {
    parts.push(`\n\nDepth: ${ctx.depth}`);
  }
  return parts.join("");
}
