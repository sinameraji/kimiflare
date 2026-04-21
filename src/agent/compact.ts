import { runKimi } from "./client.js";
import type { ChatMessage } from "./messages.js";

export interface CompactOpts {
  accountId: string;
  apiToken: string;
  model: string;
  messages: ChatMessage[];
  keepLastTurns?: number;
  signal?: AbortSignal;
}

export interface CompactResult {
  summary: string;
  newMessages: ChatMessage[];
  replacedCount: number;
}

const SUMMARY_SYSTEM = `You are summarizing a terminal coding session so it can fit back into a short context window. Produce a dense summary that captures:
- The user's goal(s) and what they've asked for.
- Files read or modified, with paths.
- Tools run (bash commands, edits) and the outcome of each.
- Decisions made and open questions.
- Any constraints or preferences the user has stated.

Do not include speculation. Do not include chat-style pleasantries. Use short bullet form. Aim for ~400-800 tokens.`;

function indexOfNthUserFromEnd(messages: ChatMessage[], n: number): number {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      seen++;
      if (seen === n) return i;
    }
  }
  return -1;
}

export async function compactMessages(opts: CompactOpts): Promise<CompactResult> {
  const keep = opts.keepLastTurns ?? 4;
  const messages = opts.messages;

  const systemMsg = messages.find((m) => m.role === "system");
  if (!systemMsg) throw new Error("compact: no system message found");

  const cutoffUserIdx = indexOfNthUserFromEnd(messages, keep);
  const firstKeepIdx = cutoffUserIdx >= 0 ? cutoffUserIdx : messages.length;
  const toSummarize = messages.slice(1, firstKeepIdx);
  const toKeep = messages.slice(firstKeepIdx);

  if (toSummarize.length === 0) {
    return { summary: "", newMessages: messages, replacedCount: 0 };
  }

  const transcript = toSummarize
    .map((m) => {
      if (m.role === "tool") {
        const snippet = (m.content ?? "").slice(0, 500);
        return `[tool ${m.name ?? ""}] ${snippet}`;
      }
      if (m.role === "assistant") {
        const calls = m.tool_calls
          ? ` (tool_calls: ${m.tool_calls.map((c) => c.function.name).join(", ")})`
          : "";
        return `[assistant]${calls} ${m.content ?? ""}`;
      }
      return `[${m.role}] ${m.content ?? ""}`;
    })
    .join("\n");

  let summary = "";
  const events = runKimi({
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    model: opts.model,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM },
      { role: "user", content: `Summarize this session so it can be replaced by your summary:\n\n${transcript}` },
    ],
    signal: opts.signal,
    temperature: 0.1,
    reasoningEffort: "low",
  });
  for await (const ev of events) {
    if (ev.type === "text") summary += ev.delta;
  }

  const summaryMsg: ChatMessage = {
    role: "user",
    content: `[compacted summary of earlier turns]\n${summary.trim()}`,
  };

  return {
    summary: summary.trim(),
    newMessages: [systemMsg, summaryMsg, ...toKeep],
    replacedCount: toSummarize.length,
  };
}
