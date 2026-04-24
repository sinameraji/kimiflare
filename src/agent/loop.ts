import { runKimi } from "./client.js";
import { toOpenAIToolDefs, type ToolSpec } from "../tools/registry.js";
import type { ToolExecutor, PermissionAsker, ToolResult } from "../tools/executor.js";
import { sanitizeString, stripOldImages } from "./messages.js";
import type { ChatMessage, ToolCall, Usage } from "./messages.js";
import type { Task } from "../tasks-state.js";
import { logTurnDebug, logTurnTokenMetrics, buildTurnTokenMetrics } from "../cost-debug.js";
import { stripHistoricalReasoning } from "./strip-reasoning.js";
import {
  loadSafetyLimits,
  type SafetyLimits,
  type TokenBreakdown,
} from "./token-limits.js";
import { buildContext, mergeTurnIntoHistory } from "./context-builder.js";
import { clearOutputHashCache } from "./tool-output-summarizer.js";

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
  sessionId?: string;
  /** Drop image_url parts from user messages older than this many turns. */
  keepLastImageTurns?: number;
  /** Static system prompt messages (first in context). */
  systemMessages?: ChatMessage[];
  /** Session/project-specific prompt messages (second in context). */
  sessionMessages?: ChatMessage[];
}

export async function runAgentTurn(opts: AgentTurnOpts): Promise<void> {
  const limits = loadSafetyLimits();
  const max = opts.maxToolIterations ?? limits.maxToolIterations;
  const toolDefs = toOpenAIToolDefs(opts.tools);
  let turn = 0;
  let lastUsage: Usage | null = null;

  // Extract prefix messages if provided, otherwise infer from opts.messages
  const systemMessages = opts.systemMessages ?? extractSystemMessages(opts.messages);
  const sessionMessages = opts.sessionMessages ?? [];

  for (let iter = 0; iter < max; iter++) {
    turn++;
    const previousMessages = opts.messages.slice();
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    let content = "";
    let reasoning = "";
    opts.callbacks.onAssistantStart?.();

    const stripReasoning = process.env.KIMIFLARE_STRIP_REASONING === "1";
    const shadowStrip = process.env.KIMIFLARE_SHADOW_STRIP === "1";
    const keepLastRaw = process.env.KIMIFLARE_REASONING_KEEP_LAST;
    const keepLast = keepLastRaw ? parseInt(keepLastRaw, 10) : 1;

    let apiMessages = opts.messages;
    let shadowStripMetrics:
      | { originalApproxTokens: number; strippedApproxTokens: number; savingsPct: number }
      | undefined;

    if (stripReasoning || shadowStrip) {
      const stripped = stripHistoricalReasoning(opts.messages, {
        keepLast: Number.isNaN(keepLast) ? 1 : keepLast,
      });
      if (shadowStrip) {
        const originalSections = analyzePromptSections(opts.messages);
        const strippedSections = analyzePromptSections(stripped);
        const originalApproxTokens = originalSections.reduce(
          (sum, s) => sum + s.approxTokens,
          0,
        );
        const strippedApproxTokens = strippedSections.reduce(
          (sum, s) => sum + s.approxTokens,
          0,
        );
        shadowStripMetrics = {
          originalApproxTokens,
          strippedApproxTokens,
          savingsPct:
            originalApproxTokens > 0
              ? Math.round(
                  ((originalApproxTokens - strippedApproxTokens) / originalApproxTokens) * 100,
                )
              : 0,
        };
      }
      if (stripReasoning) {
        apiMessages = stripped;
      }
    }

    if (opts.keepLastImageTurns !== undefined) {
      apiMessages = stripOldImages(apiMessages, opts.keepLastImageTurns);
    }

    // Build bounded context instead of sending full history
    const currentUserMessage = findCurrentUserMessage(apiMessages);
    const context = buildContext({
      allMessages: apiMessages,
      systemMessages,
      sessionMessages,
      toolDefs,
      limits,
      currentUserMessage,
    });

    // Log per-turn token metrics
    if (opts.sessionId) {
      void logTurnTokenMetrics(
        buildTurnTokenMetrics(
          opts.sessionId,
          turn,
          context.breakdown,
          opts.maxCompletionTokens ?? limits.maxCompletionTokens,
          context.wasCompacted,
          context.removedCount,
          context.exceedsLimit,
        ),
      );
    }

    if (context.exceedsLimit) {
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: `I cannot continue: the conversation context exceeds the safety limit of ${limits.maxInputTokensPerRequest} tokens. Try running /compact or /clear to reduce context size.`,
      };
      opts.messages.push(assistantMsg);
      opts.callbacks.onAssistantFinal?.(assistantMsg);
      return;
    }

    const events = runKimi({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      messages: context.messages,
      tools: toolDefs,
      signal: opts.signal,
      temperature: opts.temperature,
      maxCompletionTokens: opts.maxCompletionTokens ?? limits.maxCompletionTokens,
      reasoningEffort: opts.reasoningEffort,
      sessionId: opts.sessionId,
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
          lastUsage = ev.usage;
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

    if (toolCalls.length === 0) {
      if (opts.sessionId && lastUsage) {
        void logTurnDebug({
          sessionId: opts.sessionId,
          turn,
          messages: opts.messages,
          previousMessages,
          toolResults,
          usage: lastUsage,
          shadowStrip: shadowStripMetrics,
        });
      }
      return;
    }

    for (const tc of toolCalls) {
      if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
      const result = await opts.executor.run(
        { id: tc.id, name: tc.function.name, arguments: tc.function.arguments },
        opts.callbacks.askPermission,
        { cwd: opts.cwd, signal: opts.signal, onTasks: opts.callbacks.onTasks, coauthor: opts.coauthor },
      );
      toolResults.push(result);
      opts.messages.push({
        role: "tool",
        tool_call_id: result.tool_call_id,
        content: sanitizeString(result.content),
        name: result.name,
      });
      opts.callbacks.onToolResult?.(result);
    }

    if (opts.sessionId && lastUsage) {
      void logTurnDebug({
        sessionId: opts.sessionId,
        turn,
        messages: opts.messages,
        previousMessages,
        toolResults,
        usage: lastUsage,
        shadowStrip: shadowStripMetrics,
      });
    }
  }

  // Graceful stop when limit is hit
  const remaining = toolCallsFromMessages(opts.messages);
  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: `I reached the tool iteration limit (${max}). There ${remaining === 1 ? "is" : "are"} ${remaining} pending tool call${remaining === 1 ? "" : "s"} that could not be executed. Run /compact or /clear to reset context, or rephrase your request.`,
  };
  opts.messages.push(assistantMsg);
  opts.callbacks.onAssistantFinal?.(assistantMsg);
}

function extractSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  const end = messages.findIndex((m) => m.role !== "system");
  return end === -1 ? messages.slice() : messages.slice(0, end);
}

function findCurrentUserMessage(messages: ChatMessage[]): ChatMessage | null {
  // Find the last user message that is not part of the prefix
  const prefixEnd = messages.findIndex((m) => m.role !== "system");
  const history = prefixEnd === -1 ? [] : messages.slice(prefixEnd);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.role === "user") {
      return history[i]!;
    }
  }
  return null;
}

function toolCallsFromMessages(messages: ChatMessage[]): number {
  let count = 0;
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls) {
      count += m.tool_calls.length;
    }
  }
  return count;
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

// Re-export for compatibility
function analyzePromptSections(messages: ChatMessage[]): { role: string; chars: number; approxTokens: number }[] {
  return messages.map((m) => {
    let chars = 0;
    if (typeof m.content === "string") {
      chars = m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === "text") chars += p.text.length;
      }
    }
    if (m.reasoning_content) chars += m.reasoning_content.length;
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        chars += tc.function.name.length + tc.function.arguments.length;
      }
    }
    return { role: m.role, chars, approxTokens: Math.ceil(chars / 4) };
  });
}
