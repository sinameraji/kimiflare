import type { SectionResult, SemanticSkillRoutingResult } from "./types.js";

const MIN_SIMILARITY = 0.3;

const TIER_BUDGETS: Record<"light" | "medium" | "heavy", number> = {
  light: 2000,
  medium: 8000,
  heavy: 24000,
};

function estimateTokens(text: string): number {
  // Simple heuristic: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function formatSection(section: SectionResult): string {
  return `### ${section.name} — ${section.heading}\n${section.body}\n\n`;
}

/**
 * Greedy pack sections into the token budget.
 * Stops when similarity drops below MIN_SIMILARITY or budget is exhausted.
 */
export function packSections(
  sections: SectionResult[],
  budget: number
): { context: string; tokens: number; count: number } {
  let context = "";
  let used = 0;
  let count = 0;

  for (const section of sections) {
    if (section.similarity < MIN_SIMILARITY) break;

    const text = formatSection(section);
    const tokens = estimateTokens(text);

    if (used + tokens > budget) break;

    context += text;
    used += tokens;
    count++;
  }

  return { context, tokens: used, count };
}

/**
 * Select skills for a given prompt using semantic search and greedy packing.
 */
export function buildSkillContext(
  sections: SectionResult[],
  tier: "light" | "medium" | "heavy",
  maxSkillTokens?: number
): SemanticSkillRoutingResult {
  const tierBudget = TIER_BUDGETS[tier];
  const effectiveBudget = Math.min(tierBudget, maxSkillTokens ?? tierBudget);

  const packed = packSections(sections, effectiveBudget);
  const budgetUsed = effectiveBudget > 0 ? Math.round((packed.tokens / effectiveBudget) * 100) : 0;

  return {
    skillContext: packed.context,
    sectionCount: packed.count,
    totalTokens: packed.tokens,
    budgetUsed,
  };
}
