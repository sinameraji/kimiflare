/**
 * Research Transaction — Public API
 *
 * Entry point for the budgeted research transaction system.
 */

export { runResearchTransaction } from "./controller.js";
export type { ControllerOpts, ControllerCallbacks } from "./controller.js";
export type {
  ResearchTransactionOpts,
  ResearchResult,
  ResearchPlan,
  ResearchTask,
  ResearchBudget,
  Finding,
  FileLease,
  ConvergenceState,
  ScoutResult,
  TerminalState,
  Confidence,
} from "./types.js";
