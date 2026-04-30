import type { AgentRole } from "./agent-session.js";

export interface ClassifyResult {
  role: AgentRole;
  confidence: number; // 0-1
  method: "heuristic" | "llm";
}

// Keyword-based intent signals
const PLAN_KEYWORDS = [
  "explore", "research", "investigate", "understand", "analyze",
  "find", "search", "look", "check", "review", "audit",
  "what", "how does", "explain", "describe", "document",
  "architecture", "design", "structure", "pattern",
  "compare", "evaluate", "assess", "survey",
];

const BUILD_KEYWORDS = [
  "implement", "fix", "add", "write", "create", "build",
  "edit", "modify", "update", "change", "refactor",
  "remove", "delete", "rename", "move", "extract",
  "test", "debug", "optimize", "improve", "enhance",
  "migrate", "upgrade", "downgrade", "patch",
];

const GENERAL_KEYWORDS = [
  "hello", "hi", "help", "thanks", "thank you",
  "what is", "who", "when", "where", "why",
  "general", "chat", "talk", "question",
];

function countMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((count, kw) => {
    // Match whole words or start of text
    const regex = new RegExp(`(?:^|\\s)${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$|[.,;:!?])`, "g");
    const matches = lower.match(regex);
    return count + (matches ? matches.length : 0);
  }, 0);
}

function heuristicClassify(text: string): ClassifyResult {
  const planScore = countMatches(text, PLAN_KEYWORDS);
  const buildScore = countMatches(text, BUILD_KEYWORDS);
  const generalScore = countMatches(text, GENERAL_KEYWORDS);

  const total = planScore + buildScore + generalScore;

  if (total === 0) {
    // No strong signals — default to general for safety
    return { role: "general", confidence: 0.3, method: "heuristic" };
  }

  const maxScore = Math.max(planScore, buildScore, generalScore);

  if (maxScore === 0) {
    return { role: "general", confidence: 0.3, method: "heuristic" };
  }

  // Tie-breaking: prefer build > plan > general when scores are equal
  if (buildScore === maxScore) {
    return { role: "build", confidence: buildScore / total, method: "heuristic" };
  }

  if (planScore === maxScore) {
    return { role: "plan", confidence: planScore / total, method: "heuristic" };
  }

  return { role: "general", confidence: generalScore / total, method: "heuristic" };
}

export interface ClassifyOpts {
  text: string;
  /** Minimum confidence for heuristic classification. Below this, falls back to general. */
  minConfidence?: number;
}

/**
 * Classify user intent into an agent role.
 *
 * Uses lightweight heuristic keyword matching. Returns immediately — no LLM call.
 * Confidence threshold: if heuristic confidence < 0.5, returns general as safe default.
 */
export function classifyIntent(opts: ClassifyOpts): ClassifyResult {
  const minConfidence = opts.minConfidence ?? 0.5;
  const result = heuristicClassify(opts.text);

  if (result.confidence < minConfidence) {
    return { role: "general", confidence: result.confidence, method: "heuristic" };
  }

  return result;
}

/**
 * Determine if a role switch is warranted based on classification result.
 * Returns the target role, or null if no switch needed.
 */
export function shouldSwitchRole(
  currentRole: AgentRole,
  classification: ClassifyResult,
  opts?: {
    /** Only switch if confidence exceeds this threshold */
    switchThreshold?: number;
    /** Never auto-switch away from general (user is just chatting) */
    preserveGeneral?: boolean;
  },
): AgentRole | null {
  const threshold = opts?.switchThreshold ?? 0.6;
  const preserveGeneral = opts?.preserveGeneral ?? true;

  if (classification.confidence < threshold) {
    return null;
  }

  if (currentRole === classification.role) {
    return null;
  }

  if (preserveGeneral && currentRole === "general") {
    // General is the "safe" state; only switch if very confident
    if (classification.confidence < 0.75) {
      return null;
    }
  }

  return classification.role;
}
