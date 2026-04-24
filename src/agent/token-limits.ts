import type { ChatMessage, ToolDef } from "./messages.js";

export interface SafetyLimits {
  maxInputTokensPerRequest: number;
  warningThreshold: number;
  maxLlmCallsPerUserAction: number;
  maxRetriesPerLlmCall: number;
  maxCompletionTokens: number;
  maxToolIterations: number;
  maxRecentMessages: number;
  maxToolOutputChars: number;
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxInputTokensPerRequest: 30_000,
  warningThreshold: 15_000,
  maxLlmCallsPerUserAction: 10,
  maxRetriesPerLlmCall: 2,
  maxCompletionTokens: 4096,
  maxToolIterations: 10,
  maxRecentMessages: 4,
  maxToolOutputChars: 800,
};

export function loadSafetyLimits(): SafetyLimits {
  return {
    maxInputTokensPerRequest: parseIntEnv("KIMIFLARE_MAX_INPUT_TOKENS", DEFAULT_SAFETY_LIMITS.maxInputTokensPerRequest),
    warningThreshold: parseIntEnv("KIMIFLARE_WARNING_TOKENS", DEFAULT_SAFETY_LIMITS.warningThreshold),
    maxLlmCallsPerUserAction: parseIntEnv("KIMIFLARE_MAX_LLM_CALLS", DEFAULT_SAFETY_LIMITS.maxLlmCallsPerUserAction),
    maxRetriesPerLlmCall: parseIntEnv("KIMIFLARE_MAX_RETRIES", DEFAULT_SAFETY_LIMITS.maxRetriesPerLlmCall),
    maxCompletionTokens: parseIntEnv("KIMIFLARE_MAX_COMPLETION_TOKENS", DEFAULT_SAFETY_LIMITS.maxCompletionTokens),
    maxToolIterations: parseIntEnv("KIMIFLARE_MAX_TOOL_ITERATIONS", DEFAULT_SAFETY_LIMITS.maxToolIterations),
    maxRecentMessages: parseIntEnv("KIMIFLARE_MAX_RECENT_MESSAGES", DEFAULT_SAFETY_LIMITS.maxRecentMessages),
    maxToolOutputChars: parseIntEnv("KIMIFLARE_MAX_TOOL_OUTPUT_CHARS", DEFAULT_SAFETY_LIMITS.maxToolOutputChars),
  };
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Rough token estimate: ~4 chars per token for English/code. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(m: ChatMessage): number {
  let chars = 0;
  if (typeof m.content === "string") {
    chars = m.content.length;
  } else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part.type === "text") chars += part.text.length;
      else if (part.type === "image_url") chars += 1000; // image placeholder
    }
  }
  if (m.reasoning_content) chars += m.reasoning_content.length;
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      chars += tc.function.name.length;
      chars += tc.function.arguments.length;
    }
  }
  // overhead per message
  return Math.ceil(chars / 4) + 4;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export function estimateToolDefsTokens(tools: ToolDef[]): number {
  return estimateTokens(JSON.stringify(tools));
}

export interface TokenBreakdown {
  total: number;
  fromSystem: number;
  fromSession: number;
  fromTools: number;
  fromHistory: number;
  fromUserInput: number;
  messageCount: number;
  toolOutputCount: number;
}

export function breakdownTokens(
  systemMessages: ChatMessage[],
  sessionMessages: ChatMessage[],
  toolDefs: ToolDef[],
  historyMessages: ChatMessage[],
  userMessage: ChatMessage | null,
): TokenBreakdown {
  const fromSystem = estimateMessagesTokens(systemMessages);
  const fromSession = estimateMessagesTokens(sessionMessages);
  const fromTools = estimateToolDefsTokens(toolDefs);
  const fromHistory = estimateMessagesTokens(historyMessages);
  const fromUserInput = userMessage ? estimateMessageTokens(userMessage) : 0;
  return {
    total: fromSystem + fromSession + fromTools + fromHistory + fromUserInput,
    fromSystem,
    fromSession,
    fromTools,
    fromHistory,
    fromUserInput,
    messageCount: systemMessages.length + sessionMessages.length + historyMessages.length + (userMessage ? 1 : 0),
    toolOutputCount: historyMessages.filter((m) => m.role === "tool").length,
  };
}

export interface CompactResult {
  messages: ChatMessage[];
  removedCount: number;
}

/**
 * Compact older history by removing or summarizing tool outputs.
 * This is a fallback when the prompt is still too large.
 */
export function compactHistoryForSafety(messages: ChatMessage[], targetTokens: number): CompactResult {
  // First pass: strip old tool outputs to minimal form
  let compacted = messages.map((m) => {
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > 200) {
      const lines = m.content.split("\n");
      const firstLine = lines[0] ?? "";
      const truncated = lines.length > 3 || m.content.length > 200;
      return {
        ...m,
        content: `[${m.name ?? "tool"} result${truncated ? " (truncated)" : ""}] ${firstLine.slice(0, 120)}`,
      };
    }
    return m;
  });

  // Second pass: if still too large, drop oldest non-system messages
  let removedCount = 0;
  while (estimateMessagesTokens(compacted) > targetTokens && compacted.length > 2) {
    // Find oldest non-system, non-user message to drop
    const dropIndex = compacted.findIndex((m, i) => i > 0 && m.role !== "system" && m.role !== "user");
    if (dropIndex === -1) break;
    compacted.splice(dropIndex, 1);
    removedCount++;
  }

  return { messages: compacted, removedCount };
}
