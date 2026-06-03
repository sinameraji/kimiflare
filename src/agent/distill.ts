import type { ChatMessage } from "./messages.js";

/**
 * Extract the last substantive assistant message from a conversation.
 * Returns clean plan text, or null if no suitable message found.
 */
export function distillSessionPlan(messages: ChatMessage[]): string | null {
  // Scan in reverse for the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;

    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
    }

    text = text.trim();
    // Require at least some substance (not just "ok" or "done")
    if (text.length > 20) {
      return text;
    }
  }
  return null;
}
