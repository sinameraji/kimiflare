import { runKimi } from "./client.js";
import { toOpenAIToolDefs, type ToolSpec } from "../tools/registry.js";
import type { ToolExecutor, PermissionAsker, ToolResult } from "../tools/executor.js";
import { sanitizeString } from "./messages.js";
import type { ChatMessage, ToolCall, Usage } from "./messages.js";
import type { Task } from "../tasks-state.js";

export interface AgentCallbacks {
  onAssistantStart?: () => void;
  onReasoningDelta?: (text: string) => void;
  onTextDelta?: (text: string) => void;
  onToolCallStart?: (index: number, id: string, name: string) => void;
  onToolCallArgs?: (index: number, delta: string) => void;
  onToolCallFinalized?: (call: ToolCall) => void;
  onUsage?: (usage: Usage) => void;
  onAssistantFinal?: (msg: ChatMessage) => void;
  onToolResult?: (result: ToolResult) => void;
  onTasks?: (tasks: Task[]) => void;
  askPermission: PermissionAsker;
}

export interface AgentTurnOpts {
  accountId: string;
  apiToken: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  executor: ToolExecutor;
  cwd: string;
  signal: AbortSignal;
  callbacks: AgentCallbacks;
  maxToolIterations?: number;
  temperature?: number;
  maxCompletionTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  coauthor?: { name: string; email: string };
}

export async function runAgentTurn(opts: AgentTurnOpts): Promise<void> {
  const max = opts.maxToolIterations ?? 50;
  const toolDefs = toOpenAIToolDefs(opts.tools);

  for (let iter = 0; iter < max; iter++) {
    const toolCalls: ToolCall[] = [];
    let content = "";
    let reasoning = "";
    opts.callbacks.onAssistantStart?.();

    const events = runKimi({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      messages: opts.messages,
      tools: toolDefs,
      signal: opts.signal,
      temperature: opts.temperature,
      maxCompletionTokens: opts.maxCompletionTokens,
      reasoningEffort: opts.reasoningEffort,
    });

    for await (const ev of events) {
      switch (ev.type) {
        case "reasoning":
          reasoning += ev.delta;
          opts.callbacks.onReasoningDelta?.(ev.delta);
          break;
        case "text":
          content += ev.delta;
          opts.callbacks.onTextDelta?.(ev.delta);
          break;
        case "tool_call_start":
          opts.callbacks.onToolCallStart?.(ev.index, ev.id, ev.name);
          break;
        case "tool_call_args":
          opts.callbacks.onToolCallArgs?.(ev.index, ev.argsDelta);
          break;
        case "tool_call_complete": {
          const safeArgs = validateToolArguments(ev.arguments);
          const call: ToolCall = {
            id: ev.id,
            type: "function",
            function: { name: ev.name, arguments: safeArgs },
          };
          toolCalls.push(call);
          opts.callbacks.onToolCallFinalized?.(call);
          break;
        }
        case "usage":
          opts.callbacks.onUsage?.(ev.usage);
          break;
        case "done":
          break;
      }
    }

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
    opts.messages.push(assistantMsg);
    opts.callbacks.onAssistantFinal?.(assistantMsg);

    if (toolCalls.length === 0) return;

    for (const tc of toolCalls) {
      if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
      const result = await opts.executor.run(
        { id: tc.id, name: tc.function.name, arguments: tc.function.arguments },
        opts.callbacks.askPermission,
        { cwd: opts.cwd, signal: opts.signal, onTasks: opts.callbacks.onTasks, coauthor: opts.coauthor },
      );
      opts.messages.push({
        role: "tool",
        tool_call_id: result.tool_call_id,
        content: sanitizeString(result.content),
        name: result.name,
      });
      opts.callbacks.onToolResult?.(result);
    }
  }

  throw new Error(`kimiflare: tool iteration limit reached (${opts.maxToolIterations ?? 50})`);
}

function validateToolArguments(raw: string): string {
  if (!raw || !raw.trim()) return "{}";
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return "{}";
  }
}
