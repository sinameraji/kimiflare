/**
 * Tier-based orchestration tool gating.
 *
 * Subagent and plan orchestration tools are NOT in `ALL_TOOLS` because
 * their availability depends on the per-turn intent classification:
 *
 *   - light  → no orchestration. Light prompts are short and shouldn't
 *              pay the cost floor of a subagent dispatch.
 *   - medium → `Agent(explore, …)` only. No plan tools. Single-shot
 *              investigation children are valuable on medium tasks
 *              (keep parent context lean) but full orchestration is
 *              overkill.
 *   - heavy  → full surface: `Agent` (any type) + `plan_set` +
 *              `plan_update`. The model can decompose and dispatch.
 *
 * The runtime checks in `subagent.ts` and `plan-state.ts` apply
 * regardless — this gating is a tool-listing optimization plus a
 * model-clarity benefit (it doesn't see tools it can't use).
 */
import type { ToolSpec } from "../tools/registry.js";
import { makeAgentTool } from "../tools/agent.js";
import { planSetTool, planUpdateTool } from "../tools/plan.js";

export type IntentTier = "light" | "medium" | "heavy";

export function getOrchestrationTools(tier: IntentTier | undefined): ToolSpec[] {
  switch (tier) {
    case "heavy":
      return [makeAgentTool(["general", "explore", "plan"]), planSetTool, planUpdateTool];
    case "medium":
      return [makeAgentTool(["explore"])];
    case "light":
    default:
      return [];
  }
}
