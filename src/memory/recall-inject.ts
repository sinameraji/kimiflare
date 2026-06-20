import type { ChatMessage } from "../agent/messages.js";

/**
 * Cache-safe injection of recalled-memory context into a conversation.
 *
 * Background: session-start memory recall used to be spliced into the message
 * array on *every* `runAgentTurn` invocation via `findLastIndex(system)+1`,
 * each time re-synthesizing a byte-different paraphrase of the same memories.
 * Across a long session this stacked ~20 near-duplicate system blocks at the
 * front of the array, shifting every later message and collapsing the provider
 * prompt-prefix cache to ~10% (history re-billed fresh every turn).
 *
 * The original design (commit 82623b2) was a *one-shot* session-start recall.
 * These helpers restore that: inject a single block, marked with a stable
 * header so the injection is idempotent across turns. One stable block at a
 * fixed position keeps the cacheable prefix byte-identical turn-over-turn while
 * still giving the model its recalled project context on every call.
 *
 * Dynamic, query-specific recall remains available on demand via the
 * `memory_recall` tool (appended at the tail → also cache-safe).
 */

/** Stable header marking the single recalled-memory context block. */
export const RECALLED_MEMORY_HEADER = "[recalled project memory]";

/** True if a recalled-memory block is already present in the message array. */
export function hasRecalledMemory(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.startsWith(RECALLED_MEMORY_HEADER),
  );
}

/**
 * Inject a recalled-memory context block EXACTLY ONCE, immediately after the
 * leading system prefix. No-op (returns false) when a block is already present
 * or the text is empty — this keeps the cacheable message prefix byte-stable
 * across turns. Mutates `messages` in place.
 */
export function injectRecalledMemoryOnce(messages: ChatMessage[], text: string): boolean {
  if (!text || hasRecalledMemory(messages)) return false;
  const lastSystemIdx = messages.findLastIndex((m) => m.role === "system");
  const insertIdx = lastSystemIdx >= 0 ? lastSystemIdx + 1 : messages.length;
  messages.splice(insertIdx, 0, {
    role: "system",
    content: `${RECALLED_MEMORY_HEADER}\n${text}`,
  });
  return true;
}
