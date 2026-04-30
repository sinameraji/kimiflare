import type { AgentRole } from "./agent-session.js";

export interface ClassifyResult {
  role: AgentRole;
  confidence: number; // 0-1
  method: "heuristic" | "llm";
}

// Keyword-based intent signals
const RESEARCH_KEYWORDS = [
  "explore", "research", "investigate", "understand", "analyze",
  "find", "search", "look", "check", "review", "audit",
  "what", "how does", "explain", "describe", "document",
  "architecture", "design", "structure", "pattern",
  "compare", "evaluate", "assess", "survey",
];

const CODING_KEYWORDS = [
  "implement", "fix", "add", "write", "create", "build",
  "edit", "modify", "update", "change", "refactor",
  "remove", "delete", "rename", "move", "extract",
  "test", "debug", "optimize", "improve", "enhance",
  "migrate", "upgrade", "downgrade", "patch",
];

const GENERALIST_KEYWORDS = [
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
  const researchScore = countMatches(text, RESEARCH_KEYWORDS);
  const codingScore = countMatches(text, CODING_KEYWORDS);
  const generalistScore = countMatches(text, GENERALIST_KEYWORDS);

  const total = researchScore + codingScore + generalistScore;

  if (total === 0) {
    // No strong signals — default to generalist for safety
    return { role: "generalist", confidence: 0.3, method: "heuristic" };
  }

  const maxScore = Math.max(researchScore, codingScore, generalistScore);

  if (maxScore === 0) {
    return { role: "generalist", confidence: 0.3, method: "heuristic" };
  }

  // Tie-breaking: prefer coding > research > generalist when scores are equal
  if (codingScore === maxScore) {
    return { role: "coding", confidence: codingScore / total, method: "heuristic" };
  }

  if (researchScore === maxScore) {
    return { role: "research", confidence: researchScore / total, method: "heuristic" };
  }

  return { role: "generalist", confidence: generalistScore / total, method: "heuristic" };
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
    return { role: "generalist", confidence: result.confidence, method: "heuristic" };
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
    /** Never auto-switch away from generalist (user is just chatting) */
    preserveGeneralist?: boolean;
  },
): AgentRole | null {
  const threshold = opts?.switchThreshold ?? 0.6;
  const preserveGeneralist = opts?.preserveGeneralist ?? true;

  if (classification.confidence < threshold) {
    return null;
  }

  if (currentRole === classification.role) {
    return null;
  }

  if (preserveGeneralist && currentRole === "generalist") {
    // Generalist is the "safe" state; only switch if very confident
    if (classification.confidence < 0.75) {
      return null;
    }
  }

  return classification.role;
}
