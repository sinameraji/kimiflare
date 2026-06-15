import type { MemoryManager } from "../memory/manager.js";
import type { ChatMessage } from "./messages.js";
import type { Mode } from "../mode.js";
import { distillSessionPlan } from "./distill.js";

export const PLAN_MEMORY_TOPIC_KEY = "current_dev_plan";

export interface ResolvePlanForFreshOpts {
  mode: Mode;
  messages: ChatMessage[];
  sessionPlan: string | null;
  memoryManager: MemoryManager | null;
  memoryEnabled: boolean | undefined;
  repoPath: string;
}

/**
 * Resolve the plan text to seed a `/fresh` session.
 *
 * For plan mode the resolution order is:
 *   1. In-session captured plan (fast path).
 *   2. Durable memory lookup by exact topic key.
 *   3. Fallback: distill from message history.
 *   4. null.
 *
 * For non-plan modes this returns null so callers continue to use
 * generateContinuationSummary() for handoff documents.
 */
export function resolvePlanForFresh(opts: ResolvePlanForFreshOpts): string | null {
  const { mode, messages, sessionPlan, memoryManager, memoryEnabled, repoPath } = opts;

  if (mode !== "plan") {
    return null;
  }

  if (sessionPlan) {
    return sessionPlan;
  }

  if (memoryEnabled && memoryManager) {
    const stored = memoryManager.getByTopicKey(repoPath, PLAN_MEMORY_TOPIC_KEY);
    if (stored?.content) {
      return stored.content;
    }
  }

  return distillSessionPlan(messages);
}
