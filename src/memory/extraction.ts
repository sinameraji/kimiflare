import { runKimi } from "../agent/client.js";
import type { AiGatewayOptions } from "../agent/client.js";
import type { ChatMessage } from "../agent/messages.js";
import type { MemoryCategory, MemoryInput } from "./schema.js";

export interface ExtractMemoriesOpts {
  accountId: string;
  apiToken: string;
  model: string;
  messages: ChatMessage[];
  sessionId: string;
  repoPath: string;
  signal?: AbortSignal;
  gateway?: AiGatewayOptions;
}

const EXTRACTION_SYSTEM = `You are a memory extraction engine. Given a segment of a coding assistant conversation, extract structured memories that would be useful to recall in future sessions.

For each memory, produce a JSON object with:
- "content": a concise, self-contained sentence (max 200 chars)
- "category": one of "fact", "event", "instruction", "task", "preference"
- "importance": 1-5 (5 = critical, 1 = trivial)
- "related_files": array of relevant file paths mentioned (optional)

Categories:
- "fact": objective truths about the codebase (e.g., "Project uses tsup for bundling")
- "event": things that happened (e.g., "Migrated from jest to vitest on 2024-01-15")
- "instruction": explicit directives from the user (e.g., "Always use .js extensions in imports")
- "task": ongoing or completed work items (e.g., "Refactor auth module — in progress")
- "preference": user style preferences (e.g., "User prefers single quotes")

Rules:
- Extract only information that would be useful across sessions.
- Do not extract ephemeral or obvious information.
- Keep content factual and specific.
- Return a JSON array of memory objects. Return [] if nothing memorable.`;

interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  importance: number;
  related_files?: string[];
}

function isValidCategory(c: unknown): c is MemoryCategory {
  return c === "fact" || c === "event" || c === "instruction" || c === "task" || c === "preference";
}

function validateExtracted(item: unknown): ExtractedMemory | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const content = typeof rec.content === "string" ? rec.content.trim() : "";
  if (!content || content.length > 500) return null;
  const category = isValidCategory(rec.category) ? rec.category : "fact";
  const importance = typeof rec.importance === "number" ? Math.max(1, Math.min(5, Math.round(rec.importance))) : 3;
  const related_files = Array.isArray(rec.related_files)
    ? rec.related_files.filter((f): f is string => typeof f === "string")
    : undefined;
  return { content, category, importance, related_files };
}

function turnsToTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const contentStr =
        typeof m.content === "string"
          ? m.content
          : m.content?.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ") ?? "";
      if (m.role === "tool") {
        const snippet = contentStr.slice(0, 300);
        return `[tool ${m.name ?? ""}] ${snippet}`;
      }
      if (m.role === "assistant") {
        const calls = m.tool_calls ? ` (tools: ${m.tool_calls.map((c) => c.function.name).join(", ")})` : "";
        return `[assistant]${calls} ${contentStr}`;
      }
      return `[${m.role}] ${contentStr}`;
    })
    .join("\n");
}

export async function extractMemories(opts: ExtractMemoriesOpts): Promise<MemoryInput[]> {
  const transcript = turnsToTranscript(opts.messages);
  if (transcript.length < 100) return [];

  const events = runKimi({
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    model: opts.model,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM },
      { role: "user", content: `Extract memories from this conversation segment:\n\n${transcript}` },
    ],
    signal: opts.signal,
    temperature: 0.1,
    reasoningEffort: "low",
    gateway: opts.gateway,
  });

  let raw = "";
  for await (const ev of events) {
    if (ev.type === "text") raw += ev.delta;
  }

  raw = raw.trim();
  if (!raw) return [];

  // Extract JSON array from markdown code block if present
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    raw = codeBlockMatch[1]!.trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try to find array in the text
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        parsed = JSON.parse(arrayMatch[0]!);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const memories: MemoryInput[] = [];
  for (const item of parsed) {
    const validated = validateExtracted(item);
    if (validated) {
      memories.push({
        content: validated.content,
        category: validated.category,
        sourceSessionId: opts.sessionId,
        repoPath: opts.repoPath,
        importance: validated.importance,
        relatedFiles: validated.related_files,
      });
    }
  }

  return memories;
}
