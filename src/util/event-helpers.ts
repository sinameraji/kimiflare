import {
  buildSystemPrompt,
  buildSystemMessages,
} from "../agent/system-prompt.js";
import type { ChatMessage } from "../agent/messages.js";
import type { Mode } from "../mode.js";
import type { ToolSpec } from "../tools/registry.js";
import type { ChatEvent } from "../ui/chat.js";

export const CONTEXT_LIMIT = 262_000;
export const AUTO_COMPACT_SUGGEST_PCT = 0.8;
export const MAX_EVENTS = 500;

let nextKey = 1;
export const mkKey = () => `evt_${nextKey++}`;

export function capEvents(prev: ChatEvent[]): ChatEvent[] {
  if (prev.length <= MAX_EVENTS) return prev;
  return prev.slice(prev.length - MAX_EVENTS);
}

/** Visually compact events by collapsing old turns into a placeholder.
 *  Keeps the last `keepLastTurns` user messages and everything after them. */
export function compactEventsVisual(
  prev: ChatEvent[],
  keepLastTurns: number,
): ChatEvent[] {
  let seen = 0;
  let cutoff = -1;
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i]!.kind === "user") {
      seen++;
      if (seen === keepLastTurns + 1) {
        cutoff = i;
        break;
      }
    }
  }
  if (cutoff <= 0) return prev;
  const kept = prev.slice(cutoff);
  return [
    {
      kind: "info",
      key: mkKey(),
      text: `··· ${cutoff} earlier messages compacted ···`,
    },
    ...kept,
  ];
}

export function makePrefixMessages(
  cacheStable: boolean,
  model: string,
  mode: Mode,
  tools: ToolSpec[],
): ChatMessage[] {
  if (cacheStable) {
    return buildSystemMessages({ cwd: process.cwd(), tools, model, mode });
  }
  return [
    {
      role: "system",
      content: buildSystemPrompt({ cwd: process.cwd(), tools, model, mode }),
    },
  ];
}
