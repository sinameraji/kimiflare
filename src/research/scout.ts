/**
 * Scout — Bounded discovery phase for research transactions.
 *
 * Cheap, deterministic file discovery that produces an initial task list.
 * Max 3 tool calls + 1 LLM call. If exceeded, falls back to empty result.
 */

import { runKimi } from "../agent/client.js";
import type { AiGatewayOptions, GatewayMeta } from "../agent/client.js";
import { toOpenAIToolDefs } from "../tools/registry.js";
import { globTool } from "../tools/glob.js";
import { grepTool } from "../tools/grep.js";
import { readTool } from "../tools/read.js";
import { ToolExecutor } from "../tools/executor.js";
import type { PermissionAsker, ToolResult } from "../tools/executor.js";
import { sanitizeString } from "../agent/messages.js";
import type { ChatMessage, ToolCall, Usage } from "../agent/messages.js";
import type { ScoutResult, ResearchTask } from "./types.js";

const SCOUT_TOOLS = [globTool, grepTool, readTool];
const SCOUT_SYSTEM_PROMPT =
  `You are a research scout. Your job is to quickly understand what files and areas of a codebase are relevant to a user's query, and produce a focused list of research tasks.

Rules:
- Use glob, grep, and read tools to discover relevant files.
- Read only file HEADS (first 30 lines) to understand structure — do not read full files.
- Produce 1-3 research tasks. Each task must be a QUESTION, not a file list.
- Include scope hints (suggestedFiles, includePaths) but do not mandate them.
- Suggest falsification questions: "What would prove this wrong?"
- Recommend worker count: 1 or 2.
- Be concise. Scout budget is tiny.`;

export interface ScoutOpts {
  query: string;
  cwd: string;
  signal: AbortSignal;
  accountId: string;
  apiToken: string;
  model: string;
  gateway?: AiGatewayOptions;
  reasoningEffort?: "low" | "medium" | "high";
  sessionId?: string;
}

export interface ScoutOutput {
  result: ScoutResult;
  usage: Usage;
  gatewayMeta?: GatewayMeta;
}

export async function runScout(opts: ScoutOpts): Promise<ScoutOutput> {
  const toolDefs = toOpenAIToolDefs(SCOUT_TOOLS);
  const executor = new ToolExecutor(SCOUT_TOOLS);
  const autoAllow: PermissionAsker = async () => "allow";

  const messages: ChatMessage[] = [
    { role: "system", content: SCOUT_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Query: ${opts.query}\n\n` +
        `Discover relevant files and produce a research plan. ` +
        `Use at most 3 tool calls. Read only file heads (first 30 lines).`,
    },
  ];

  let totalUsage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let gatewayMeta: GatewayMeta | undefined;
  const maxToolCalls = 3;
  let toolCallsMade = 0;

  for (let iter = 0; iter < 2; iter++) {
    if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

    const toolCalls: ToolCall[] = [];
    let content = "";
    let reasoning = "";

    const events = runKimi({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      messages,
      tools: toolDefs,
      signal: opts.signal,
      reasoningEffort: opts.reasoningEffort ?? "low",
      sessionId: opts.sessionId,
      gateway: opts.gateway,
    });

    for await (const ev of events) {
      switch (ev.type) {
        case "gateway_meta":
          gatewayMeta = ev.meta;
          break;
        case "reasoning":
          reasoning += ev.delta;
          break;
        case "text":
          content += ev.delta;
          break;
        case "tool_call_complete": {
          const safeArgs = ev.arguments.trim() ? ev.arguments : "{}";
          toolCalls.push({
            id: ev.id,
            type: "function",
            function: { name: ev.name, arguments: safeArgs },
          });
          break;
        }
        case "usage":
          totalUsage = ev.usage;
          break;
        case "done":
          break;
      }
    }

    if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: content ? sanitizeString(content) : null,
      ...(reasoning ? { reasoning_content: sanitizeString(reasoning) } : {}),
      ...(toolCalls.length
        ? {
            tool_calls: toolCalls.map((tc) => ({
              ...tc,
              function: {
                name: tc.function.name,
                arguments: sanitizeString(tc.function.arguments),
              },
            })),
          }
        : {}),
    };
    messages.push(assistantMsg);

    if (toolCalls.length === 0) {
      // Scout produced final answer — parse it
      const result = parseScoutOutput(content);
      return { result, usage: totalUsage, gatewayMeta };
    }

    for (const tc of toolCalls) {
      if (toolCallsMade >= maxToolCalls) {
        // Budget exhausted — force conclusion
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "[Scout tool budget exhausted. Produce final plan now.]",
          name: tc.function.name,
        });
        continue;
      }
      toolCallsMade++;

      const result = await executor.run(
        { id: tc.id, name: tc.function.name, arguments: tc.function.arguments },
        autoAllow,
        { cwd: opts.cwd, signal: opts.signal },
      );
      messages.push({
        role: "tool",
        tool_call_id: result.tool_call_id,
        content: sanitizeString(result.content),
        name: result.name,
      });
    }
  }

  // Fallback: if we hit iteration limit, parse whatever we have
  const lastAssistant = messages.findLast((m) => m.role === "assistant");
  const text = typeof lastAssistant?.content === "string" ? lastAssistant.content : "";
  const result = parseScoutOutput(text);
  return { result, usage: totalUsage, gatewayMeta };
}

function parseScoutOutput(text: string): ScoutResult {
  // Try to extract structured data from the LLM output.
  // We look for JSON blocks first, then fall back to heuristic parsing.
  const jsonBlock = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlock) {
    try {
      const parsed = JSON.parse(jsonBlock[1]!);
      return normalizeScoutResult(parsed);
    } catch {
      // fall through
    }
  }

  // Heuristic: look for task-like sections
  const tasks: ResearchTask[] = [];
  const taskMatches = text.matchAll(/(?:^|\n)\s*(?:task|question)\s*[:\-]?\s*(.+?)(?=\n(?:task|question|falsification|workers)\s*[:\-]?|$)/gi);
  let idx = 0;
  for (const m of taskMatches) {
    const question = m[1]!.trim();
    if (question.length < 5) continue;
    tasks.push(createDefaultTask(`scout-task-${idx++}`, question));
  }

  // If no tasks found, create a single fallback task
  if (tasks.length === 0) {
    tasks.push(createDefaultTask("scout-task-0", text.slice(0, 200)));
  }

  const falsification = text.match(/falsification[^:]*:\s*(.+?)(?=\n|$)/i);
  const workerMatch = text.match(/worker\s*count\s*[:\-]?\s*(\d)/i);

  return {
    estimatedRelevantFiles: 10,
    likelyAreas: ["src/"],
    proposedTasks: tasks,
    dependencyHints: [],
    falsificationQuestions: falsification ? [falsification[1]!.trim()] : [],
    recommendedWorkerCount: workerMatch && workerMatch[1] === "2" ? 2 : 1,
  };
}

function normalizeScoutResult(parsed: unknown): ScoutResult {
  const p = parsed as Record<string, unknown>;
  const tasks: ResearchTask[] = Array.isArray(p.tasks)
    ? p.tasks.map((t: unknown, i: number) => normalizeTask(t, i))
    : [];

  return {
    estimatedRelevantFiles: typeof p.estimatedRelevantFiles === "number" ? p.estimatedRelevantFiles : 10,
    likelyAreas: Array.isArray(p.likelyAreas) ? p.likelyAreas.filter((a): a is string => typeof a === "string") : ["src/"],
    proposedTasks: tasks.length > 0 ? tasks : [createDefaultTask("scout-task-0", "Explore the codebase")],
    dependencyHints: Array.isArray(p.dependencyHints) ? p.dependencyHints : [],
    falsificationQuestions: Array.isArray(p.falsificationQuestions)
      ? p.falsificationQuestions.filter((q): q is string => typeof q === "string")
      : [],
    recommendedWorkerCount: p.recommendedWorkerCount === 2 ? 2 : 1,
  };
}

function normalizeTask(t: unknown, index: number): ResearchTask {
  const obj = t as Record<string, unknown>;
  return createDefaultTask(
    typeof obj.id === "string" ? obj.id : `scout-task-${index}`,
    typeof obj.question === "string" ? obj.question : typeof obj.description === "string" ? obj.description : "Explore",
    typeof obj.description === "string" ? obj.description : undefined,
    typeof obj.priority === "number" && obj.priority >= 1 && obj.priority <= 5 ? (obj.priority as 1 | 2 | 3 | 4 | 5) : 3,
    Array.isArray(obj.suggestedFiles) ? obj.suggestedFiles.filter((f): f is string => typeof f === "string") : undefined,
  );
}

function createDefaultTask(
  id: string,
  question: string,
  description?: string,
  priority: 1 | 2 | 3 | 4 | 5 = 3,
  suggestedFiles?: string[],
): ResearchTask {
  return {
    id,
    question,
    description: description ?? question,
    priority,
    scope: { suggestedFiles, maxFiles: 10 },
    dependencyIds: [],
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
}
