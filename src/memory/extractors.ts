/**
 * Deterministic extractors that auto-populate memory from tool results.
 * No LLM calls — pure regex / JSON.parse.
 */

import type { MemoryCategory } from "./schema.js";

export interface Extractor {
  /** Unique identifier for this extractor */
  id: string;
  /** Check if this extractor applies to a given tool call */
  match: (toolName: string, filePath: string | undefined) => boolean;
  /** Extract memory content from the tool result. Returns null if nothing to extract. */
  extract: (
    content: string,
    filePath: string | undefined,
  ) => {
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
    extract: (_content, file) => {
      if (!file) return null;
      const safeKey = file.replace(/[^a-zA-Z0-9]/g, "_");
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
