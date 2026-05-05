/**
 * Deterministic extractors that auto-populate memory from tool results.
 * Most are pure regex / JSON.parse. The edit_event extractor can optionally
 * use a lightweight LLM for high-signal synthesis when context is available.
 */

import { runKimi } from "../agent/client.js";
import type { ChatMessage } from "../agent/messages.js";
import type { MemoryCategory } from "./schema.js";

export interface ExtractorContext {
  /** Arguments passed to the tool (e.g. old_string, new_string, path). */
  toolArgs?: Record<string, unknown>;
  /** The assistant message that triggered this tool call. */
  assistantMessage?: string;
  /** LLM opts for synthesis (accountId, apiToken, model, gateway). */
  llmOpts?: {
    accountId: string;
    apiToken: string;
    model: string;
    gateway?: { id: string; cacheTtl?: number; skipCache?: boolean; collectLogPayload?: boolean; metadata?: Record<string, string | number | boolean> };
    signal?: AbortSignal;
  };
}

export interface Extractor {
  /** Unique identifier for this extractor */
  id: string;
  /** Check if this extractor applies to a given tool call */
  match: (toolName: string, filePath: string | undefined) => boolean;
  /** Extract memory content from the tool result. Returns null if nothing to extract. */
  extract: (
    content: string,
    filePath: string | undefined,
    ctx?: ExtractorContext,
  ) => Promise<{
    content: string;
    category: MemoryCategory;
    importance: number;
    topicKey: string;
    relatedFiles?: string[];
  } | null> | {
    content: string;
    category: MemoryCategory;
    importance: number;
    topicKey: string;
    relatedFiles?: string[];
  } | null;
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

const EDIT_SYNTHESIS_SYSTEM = `You summarize a SINGLE code edit for a memory system. Write ONE concise sentence (max 20 words) describing exactly what changed in the file and why.

Rules:
- Use ONLY the Before/After diff below. IGNORE any conversation history or unrelated context.
- Focus on the specific file change, not the broader task.
- Mention the file name if it clarifies the change.

Examples:
- Created test-memory.md with a single line marking it as a memory test.
- Fixed race condition in loop.ts by adding AbortSignal guard before recursive calls.
- Refactored auth middleware to use JWT tokens instead of session cookies.
- Added vitest dependency and removed jest from package.json.

Respond with only the summary sentence. No quotes, no preamble.`;

async function synthesizeEditEvent(
  file: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  assistantMessage: string | undefined,
  llmOpts: ExtractorContext["llmOpts"],
): Promise<string | null> {
  if (!llmOpts) return null;

  const oldString = typeof toolArgs.old_string === "string" ? toolArgs.old_string : "";
  const newString = typeof toolArgs.new_string === "string" ? toolArgs.new_string : "";
  const fullContent = typeof toolArgs.content === "string" ? toolArgs.content : "";

  // For write tools, the "new" content is the full file content
  const isWrite = toolName === "write";
  const before = isWrite ? "(new file)" : truncate(oldString, 600);
  const after = isWrite ? truncate(fullContent, 600) : truncate(newString, 600);
  // Only use the tail of the assistant message — the most recent intent is usually at the end.
  const intent = assistantMessage ? assistantMessage.slice(-300).trim() : "";

  const messages: ChatMessage[] = [
    { role: "system", content: EDIT_SYNTHESIS_SYSTEM },
    {
      role: "user",
      content: `File: ${file}\nTool: ${toolName}\n\nBefore:\n${before}\n\nAfter:\n${after}${intent ? `\n\nContext (do not quote verbatim): ${intent}` : ""}\n\nSummary:`,
    },
  ];

  try {
    const events = runKimi({
      accountId: llmOpts.accountId,
      apiToken: llmOpts.apiToken,
      model: llmOpts.model,
      messages,
      temperature: 0.1,
      maxCompletionTokens: 64,
      gateway: llmOpts.gateway,
      signal: llmOpts.signal,
    });

    let text = "";
    for await (const ev of events) {
      if (ev.type === "text") text += ev.delta;
    }

    const summary = text.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, " ");
    if (summary.length < 10 || summary.length > 200) return null;
    return summary;
  } catch {
    return null;
  }
}

export const EXTRACTORS: Extractor[] = [
  {
    id: "package_json",
    match: (tool, file) => tool === "read" && /package\.json$/.test(file || ""),
    extract: (content, file) => {
      const pkg = safeJsonParse<Record<string, unknown>>(content);
      if (!pkg) return null;
      const deps = Object.keys((pkg.dependencies as Record<string, unknown>) || {}).slice(0, 10);
      const devDeps = Object.keys((pkg.devDependencies as Record<string, unknown>) || {}).slice(0, 5);
      const scripts = Object.keys((pkg.scripts as Record<string, unknown>) || {}).slice(0, 5);
      return {
        content: `Project dependencies: ${deps.join(", ") || "none"}. Dev dependencies: ${devDeps.join(", ") || "none"}. Scripts: ${scripts.join(", ") || "none"}. Type: ${(pkg.type as string) || "commonjs"}.`,
        category: "fact",
        importance: 4,
        topicKey: "project_dependencies",
        relatedFiles: file ? [file] : undefined,
      };
    },
  },
  {
    id: "tsconfig",
    match: (tool, file) => tool === "read" && /tsconfig.*\.json$/.test(file || ""),
    extract: (content, file) => {
      const ts = safeJsonParse<Record<string, unknown>>(content);
      if (!ts) return null;
      const opts = (ts.compilerOptions as Record<string, unknown>) || {};
      return {
        content: `TypeScript config: target=${(opts.target as string) || "default"}, module=${(opts.module as string) || "default"}, strict=${opts.strict || false}, jsx=${(opts.jsx as string) || "none"}.`,
        category: "fact",
        importance: 4,
        topicKey: "project_tsconfig",
        relatedFiles: file ? [file] : undefined,
      };
    },
  },
  {
    id: "entry_point",
    match: (tool, file) => tool === "read" && /src\/(index|main)\.(ts|tsx|js|jsx)$/.test(file || ""),
    extract: (content, file) => {
      const exports = content.match(/export\s+(?:default\s+)?(?:function|class|const|interface|type)\s+(\w+)/g);
      const exportNames = exports
        ? exports.map((e) => e.split(/\s+/).pop()).filter((n): n is string => !!n).slice(0, 5)
        : [];
      return {
        content: `Entry point ${file} exports: ${exportNames.join(", ") || "default export or side effects"}.`,
        category: "fact",
        importance: 3,
        topicKey: "project_entry_point",
        relatedFiles: file ? [file] : undefined,
      };
    },
  },
  {
    id: "edit_event",
    match: (tool, file) => (tool === "edit" || tool === "write") && !!file,
    extract: async (_content, file, ctx) => {
      if (!file) return null;
      const safeKey = file.replace(/[^a-zA-Z0-9]/g, "_");

      // Try LLM synthesis when we have context
      if (ctx?.llmOpts && (ctx.toolArgs || ctx.assistantMessage)) {
        const summary = await synthesizeEditEvent(
          file,
          ctx.toolArgs?._toolName as string || "edit",
          ctx.toolArgs || {},
          ctx.assistantMessage,
          ctx.llmOpts,
        );
        if (summary) {
          return {
            content: summary,
            category: "event",
            importance: 3,
            topicKey: `event_edit_${safeKey}`,
            relatedFiles: [file],
          };
        }
      }

      // Fallback to deterministic low-signal memory
      return {
        content: `File modified: ${file}.`,
        category: "event",
        importance: 2,
        topicKey: `event_edit_${safeKey}`,
        relatedFiles: [file],
      };
    },
  },
];
