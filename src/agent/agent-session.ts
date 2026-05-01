import type { ChatMessage } from "./messages.js";
import type { ToolSpec } from "../tools/registry.js";
import { ALL_TOOLS } from "../tools/executor.js";
import { ArtifactStore } from "./session-state.js";

export type AgentRole = string;

/** Built-in agent roles. */
export const BUILTIN_ROLES = ["research", "coding", "generalist"] as const;

export interface AgentSession {
  role: AgentRole;
  messages: ChatMessage[];
  recentToolCalls: string[];
  /** Per-agent artifact store for compiled context. */
  artifactStore: ArtifactStore;
}

/** Sorted tool names per role for cache-stable prompt prefixes. */
const RESEARCH_TOOL_NAMES: readonly string[] = [
  "glob",
  "grep",
  "lsp_codeAction",
  "lsp_definition",
  "lsp_diagnostics",
  "lsp_documentSymbols",
  "lsp_hover",
  "lsp_implementation",
  "lsp_references",
  "lsp_rename",
  "lsp_typeDefinition",
  "lsp_workspaceSymbol",
  "hand_off",
  "memory_recall",
  "read",
  "tasks_set",
  "web_fetch",
].sort((a, b) => a.localeCompare(b));

const CODING_TOOL_NAMES: readonly string[] = [
  "bash",
  "edit",
  "hand_off",
  "lsp_codeAction",
  "lsp_definition",
  "lsp_diagnostics",
  "lsp_documentSymbols",
  "lsp_hover",
  "lsp_implementation",
  "lsp_references",
  "lsp_rename",
  "lsp_typeDefinition",
  "lsp_workspaceSymbol",
  "memory_recall",
  "memory_remember",
  "read",
  "write",
].sort((a, b) => a.localeCompare(b));

const GENERALIST_TOOL_NAMES: readonly string[] = [
  "hand_off",
  "memory_forget",
  "memory_recall",
  "memory_remember",
  "tasks_set",
  "web_fetch",
].sort((a, b) => a.localeCompare(b));

const ALL_TOOLS_MAP = new Map(ALL_TOOLS.map((t) => [t.name, t]));

function resolveTools(names: readonly string[]): ToolSpec[] {
  const out: ToolSpec[] = [];
  for (const name of names) {
    const tool = ALL_TOOLS_MAP.get(name);
    if (tool) out.push(tool);
  }
  return out;
}

export function getAgentTools(role: AgentRole, customAgents?: { name: string; tools: string[] }[]): ToolSpec[] {
  // Check for custom agent first
  if (customAgents) {
    const custom = customAgents.find((a) => a.name === role);
    if (custom) {
      return resolveTools(custom.tools.sort((a, b) => a.localeCompare(b)));
    }
  }
  switch (role) {
    case "research":
      return resolveTools(RESEARCH_TOOL_NAMES);
    case "coding":
      return resolveTools(CODING_TOOL_NAMES);
    case "generalist":
      return resolveTools(GENERALIST_TOOL_NAMES);
    default:
      return resolveTools(GENERALIST_TOOL_NAMES);
  }
}

export function createAgentSession(role: AgentRole): AgentSession {
  return {
    role,
    messages: [],
    recentToolCalls: [],
    artifactStore: new ArtifactStore(),
  };
}
