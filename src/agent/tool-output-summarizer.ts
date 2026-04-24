import { createHash } from "node:crypto";
import type { ChatMessage } from "./messages.js";

export interface ToolOutputSummary {
  tool_call_id: string;
  name?: string;
  content: string;
  truncated: boolean;
}

const DEFAULT_MAX_CHARS = 800;

/** Normalize text for hashing: lowercase, trim whitespace, collapse spaces. */
function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000); // cap hash input
}

function stableHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Global deduplication cache across the session. */
const outputHashCache = new Map<string, { name?: string; firstSeenId: string; preview: string }>();

export function clearOutputHashCache(): void {
  outputHashCache.clear();
}

/**
 * Summarize a single tool output for inclusion in model context.
 * Caps length, preserves metadata, and deduplicates identical outputs.
 */
export function summarizeToolOutput(
  toolCallId: string,
  name: string | undefined,
  rawContent: string,
  maxChars = DEFAULT_MAX_CHARS,
): ToolOutputSummary {
  const normalized = normalizeForHash(rawContent);
  const hash = stableHash(normalized);
  const cached = outputHashCache.get(hash);

  if (cached && cached.firstSeenId !== toolCallId) {
    // Deduplicate: reference previous identical output
    const ref = `same as previous ${cached.name ?? "tool"} call (result_id=${hash})`;
    return {
      tool_call_id: toolCallId,
      name,
      content: ref,
      truncated: false,
    };
  }

  // Store in cache for future deduplication
  if (!cached) {
    const preview = rawContent.slice(0, 120).replace(/\s+/g, " ");
    outputHashCache.set(hash, { name, firstSeenId: toolCallId, preview });
  }

  // Determine if output is a failure/noise
  const isFailure =
    rawContent.startsWith("Error:") ||
    rawContent.startsWith("error:") ||
    rawContent.includes("exit code") ||
    rawContent.includes("not found") ||
    rawContent.includes("No such file");

  const isNoisy =
    rawContent.length > 0 &&
    (rawContent.split("\n").length > 100 || rawContent.length > maxChars * 2);

  if (isFailure && rawContent.length > 200) {
    // Collapse failures aggressively
    const firstLine = rawContent.split("\n")[0] ?? "";
    return {
      tool_call_id: toolCallId,
      name,
      content: `[${name ?? "tool"} failed] ${firstLine.slice(0, 160)}`,
      truncated: true,
    };
  }

  if (rawContent.length <= maxChars) {
    return {
      tool_call_id: toolCallId,
      name,
      content: rawContent,
      truncated: false,
    };
  }

  // Truncate with indicator
  const truncated = rawContent.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf("\n");
  const clean = lastNewline > maxChars * 0.5 ? truncated.slice(0, lastNewline) : truncated;
  return {
    tool_call_id: toolCallId,
    name,
    content: `${clean}\n... (${rawContent.length - clean.length} more chars truncated)`,
    truncated: true,
  };
}

/**
 * Convert a tool message to its summarized form for model context.
 * Preserves the original in the full message array; this returns a
 * replacement for the API call only.
 */
export function summarizeToolMessage(
  msg: ChatMessage,
  maxChars = DEFAULT_MAX_CHARS,
): ChatMessage {
  if (msg.role !== "tool" || typeof msg.content !== "string") {
    return msg;
  }
  const summary = summarizeToolOutput(msg.tool_call_id ?? "", msg.name, msg.content, maxChars);
  return {
    ...msg,
    content: summary.content,
  };
}

/**
 * Summarize all tool messages in a message array.
 * Non-tool messages are returned unchanged.
 */
export function summarizeToolMessages(
  messages: ChatMessage[],
  maxChars = DEFAULT_MAX_CHARS,
): ChatMessage[] {
  return messages.map((m) => (m.role === "tool" ? summarizeToolMessage(m, maxChars) : m));
}
