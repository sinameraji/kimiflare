import type { ToolSpec } from "../tools/registry.js";

export type Persona = "generalist" | "research" | "coding";

export const GENERALIST_TOOLS = new Set<string>([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "glob",
  "web_fetch",
  "tasks_set",
  "memory_remember",
  "memory_recall",
  "memory_forget",
  "delegate_to_researcher",
  "delegate_to_coder",
  "ask_user",
]);

export const RESEARCH_TOOLS = new Set<string>([
  "read",
  "grep",
  "glob",
  "web_fetch",
  "tasks_set",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_documentSymbols",
  "lsp_workspaceSymbol",
  "lsp_diagnostics",
  "lsp_codeAction",
  "lsp_implementation",
  "lsp_typeDefinition",
]);

export const CODING_TOOLS = new Set<string>([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "glob",
  "tasks_set",
  "memory_remember",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_documentSymbols",
  "lsp_workspaceSymbol",
  "lsp_diagnostics",
  "lsp_codeAction",
  "lsp_implementation",
  "lsp_typeDefinition",
]);

export function toolsForPersona(persona: Persona, allTools: ToolSpec[]): ToolSpec[] {
  const allowed =
    persona === "research" ? RESEARCH_TOOLS : persona === "coding" ? CODING_TOOLS : GENERALIST_TOOLS;
  return allTools.filter((t) => allowed.has(t.name));
}
