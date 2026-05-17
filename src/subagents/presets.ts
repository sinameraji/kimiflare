/**
 * Subagent type presets — per-type tool allowlists and defaults.
 *
 * Each preset declares what tools its children are allowed to call,
 * along with reasoning/iteration defaults. The caller is expected to
 * apply the parent's mode filter (e.g. `isBlockedInPlanMode`) on top
 * of `toolFilter` — presets never widen mode-imposed restrictions.
 *
 * See `docs/plans/m7-subagent-primitive.md` for the design rationale.
 */
import type { ToolSpec } from "../tools/registry.js";

export type SubagentType = "general" | "explore" | "plan";

export type ReasoningEffort = "low" | "medium" | "high";

export interface SubagentPreset {
  type: SubagentType;
  description: string;
  /**
   * Filter the parent's tool list. This is intersected later with the
   * active mode's allowlist; presets never grant tools the parent's
   * mode would block.
   */
  toolFilter: (allTools: ToolSpec[]) => ToolSpec[];
  defaultReasoningEffort: ReasoningEffort;
  defaultCodeMode: boolean;
  /** Independent iteration budget for the child loop. */
  maxToolIterations: number;
  /** Independent prompt-token budget for the child. */
  maxInputTokens: number;
}

/**
 * Tool names that are always available to a child agent regardless of
 * preset. Memory recall (read-only) and artifact expansion never mutate
 * state and are useful in every flavour of subagent.
 */
const ALWAYS_ALLOWED = new Set<string>(["memory_recall", "expand_artifact"]);

/**
 * Read-only investigation toolset. Used by `explore` and `plan`.
 */
const READ_ONLY_TOOLS = new Set<string>([
  "read",
  "glob",
  "grep",
  "web_fetch",
  "search_web",
  "github_read_pr",
  "github_read_issue",
  "github_read_code",
  // Read-only LSP queries.
  "lsp_hover",
  "lsp_definition",
  "lsp_references",
  "lsp_documentSymbols",
  "lsp_workspaceSymbol",
  "lsp_diagnostics",
  "lsp_implementation",
  "lsp_typeDefinition",
]);

/**
 * Tools that children NEVER get, regardless of preset. The `Agent` and
 * plan tools are gated separately by depth/tier; children at depth ≥ 1
 * cannot orchestrate further children in v1.
 */
const NEVER_ALLOWED_IN_CHILDREN = new Set<string>([
  "Agent",
  "plan_set",
  "plan_update",
]);

function passesNeverAllowed(t: ToolSpec): boolean {
  return !NEVER_ALLOWED_IN_CHILDREN.has(t.name);
}

const PRESETS: Record<SubagentType, SubagentPreset> = {
  general: {
    type: "general",
    description:
      "General-purpose subagent. Has access to most parent tools (read/write/edit/bash subject to mode), suitable for self-contained sub-tasks the parent wants to delegate end-to-end.",
    toolFilter: (allTools) =>
      allTools.filter(
        (t) =>
          passesNeverAllowed(t) &&
          // Child has its own narrow brief; no need to publish tasks
          // back to the parent UI.
          t.name !== "tasks_set",
      ),
    defaultReasoningEffort: "medium",
    defaultCodeMode: false,
    maxToolIterations: 25,
    maxInputTokens: 60_000,
  },
  explore: {
    type: "explore",
    description:
      "Read-only investigation subagent. Cannot mutate code, run shell commands, or open the browser. Use for `find every caller of X`, `summarize how Y works`, `locate Z`. Fast and cheap.",
    toolFilter: (allTools) =>
      allTools.filter(
        (t) =>
          passesNeverAllowed(t) &&
          (ALWAYS_ALLOWED.has(t.name) || READ_ONLY_TOOLS.has(t.name)),
      ),
    defaultReasoningEffort: "medium",
    defaultCodeMode: false,
    maxToolIterations: 20,
    maxInputTokens: 40_000,
  },
  plan: {
    type: "plan",
    description:
      "Architecture/planning subagent. Read-only like `explore`, but tuned for producing implementation plans and design tradeoffs rather than locating things.",
    toolFilter: (allTools) =>
      allTools.filter(
        (t) =>
          passesNeverAllowed(t) &&
          (ALWAYS_ALLOWED.has(t.name) || READ_ONLY_TOOLS.has(t.name)),
      ),
    defaultReasoningEffort: "high",
    defaultCodeMode: false,
    maxToolIterations: 20,
    maxInputTokens: 60_000,
  },
};

export function getPreset(type: SubagentType): SubagentPreset {
  return PRESETS[type];
}

export function listPresets(): SubagentPreset[] {
  return Object.values(PRESETS);
}

export function isValidSubagentType(s: unknown): s is SubagentType {
  return s === "general" || s === "explore" || s === "plan";
}

/**
 * Apply preset filter then intersect with a mode-imposed predicate.
 * The mode predicate returns `true` if the tool should be BLOCKED.
 * Presets never widen mode-imposed restrictions.
 */
export function filterToolsForSubagent(
  type: SubagentType,
  allTools: ToolSpec[],
  isBlockedByMode: (toolName: string) => boolean,
): ToolSpec[] {
  const preset = getPreset(type);
  const presetFiltered = preset.toolFilter(allTools);
  return presetFiltered.filter((t) => !isBlockedByMode(t.name));
}
