import type { ChatMessage, ToolDef } from "./messages.js";
import type { SafetyLimits } from "./token-limits.js";
import {
  estimateMessagesTokens,
  compactHistoryForSafety,
  breakdownTokens,
  type TokenBreakdown,
} from "./token-limits.js";
import { summarizeToolMessages } from "./tool-output-summarizer.js";

export interface BuildContextOpts {
  /** Full conversation history (mutable; new messages are pushed here). */
  allMessages: ChatMessage[];
  /** Static system prompt messages (first in context). */
  systemMessages: ChatMessage[];
  /** Session/project-specific prompt messages (second in context). */
  sessionMessages: ChatMessage[];
  /** Tool definitions for the model. */
  toolDefs: ToolDef[];
  /** Safety limits to enforce. */
  limits: SafetyLimits;
  /** Current user message (the newest user input). */
  currentUserMessage?: ChatMessage | null;
}

export interface BuiltContext {
  messages: ChatMessage[];
  breakdown: TokenBreakdown;
  wasCompacted: boolean;
  removedCount: number;
  exceedsLimit: boolean;
}

/**
 * Build a bounded context for an LLM request.
 *
 * Order is deterministic and cache-stable:
 *   1. static system prompt
 *   2. session/project prompt
 *   3. compact recent history (last N conversational turns)
 *   4. current user message
 *
 * Tool outputs in history are summarized/deduplicated.
 * If the result still exceeds maxInputTokensPerRequest, older history
 * is compacted further. If it still exceeds, exceedsLimit is true.
 */
export function buildContext(opts: BuildContextOpts): BuiltContext {
  const { allMessages, systemMessages, sessionMessages, toolDefs, limits, currentUserMessage } = opts;

  // Identify the prefix (system messages) so we don't duplicate them
  const prefixLength = systemMessages.length + sessionMessages.length;

  // The rest is history
  let history = allMessages.slice(prefixLength);

  // Summarize tool outputs in history
  history = summarizeToolMessages(history, limits.maxToolOutputChars);

  // Keep only the last N conversational messages (user/assistant/tool turns)
  // We count turns, not individual messages, to preserve coherence.
  const recentHistory = keepLastTurns(history, limits.maxRecentMessages);

  // Assemble the context
  const contextMessages: ChatMessage[] = [
    ...systemMessages,
    ...sessionMessages,
    ...recentHistory,
  ];

  if (currentUserMessage) {
    contextMessages.push(currentUserMessage);
  }

  let breakdown = breakdownTokens(
    systemMessages,
    sessionMessages,
    toolDefs,
    recentHistory,
    currentUserMessage ?? null,
  );

  let wasCompacted = false;
  let removedCount = 0;

  // Safety check: if over limit, compact older history
  if (breakdown.total > limits.maxInputTokensPerRequest) {
    const target = limits.maxInputTokensPerRequest;
    const compacted = compactHistoryForSafety(recentHistory, target - breakdown.fromSystem - breakdown.fromSession - breakdown.fromTools - breakdown.fromUserInput);
    if (compacted.removedCount > 0) {
      wasCompacted = true;
      removedCount = compacted.removedCount;
      const newContext: ChatMessage[] = [
        ...systemMessages,
        ...sessionMessages,
        ...compacted.messages,
      ];
      if (currentUserMessage) {
        newContext.push(currentUserMessage);
      }
      breakdown = breakdownTokens(
        systemMessages,
        sessionMessages,
        toolDefs,
        compacted.messages,
        currentUserMessage ?? null,
      );
      return {
        messages: newContext,
        breakdown,
        wasCompacted,
        removedCount,
        exceedsLimit: breakdown.total > limits.maxInputTokensPerRequest,
      };
    }
  }

  return {
    messages: contextMessages,
    breakdown,
    wasCompacted,
    removedCount,
    exceedsLimit: breakdown.total > limits.maxInputTokensPerRequest,
  };
}

/**
 * Keep the last N conversational turns.
 * A "turn" starts with a user message and includes the assistant response
 * and any tool results that follow it.
 */
function keepLastTurns(messages: ChatMessage[], maxTurns: number): ChatMessage[] {
  if (maxTurns <= 0) return [];

  // Find turn boundaries (each user message starts a new turn)
  const turnStarts: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "user") {
      turnStarts.push(i);
    }
  }

  if (turnStarts.length <= maxTurns) {
    return messages;
  }

  const startIndex = turnStarts[turnStarts.length - maxTurns] ?? 0;
  return messages.slice(startIndex);
}

/**
 * Rebuild the full message array after a turn completes.
 * This ensures the original full messages are preserved locally
 * while only the bounded context was sent to the API.
 */
export function mergeTurnIntoHistory(
  allMessages: ChatMessage[],
  assistantMsg: ChatMessage,
  toolResults: ChatMessage[],
): void {
  allMessages.push(assistantMsg);
  for (const tr of toolResults) {
    allMessages.push(tr);
  }
}
