import { minimatch } from "minimatch";
import type { Skill, SkillRoutingResult, SkillConflict } from "./types.js";

export interface RouterOptions {
  /** Current working directory */
  cwd: string;
  /** User's raw prompt */
  prompt: string;
  /** Retrieved memory snippets */
  memorySnippets: string[];
  /** Budget tier: light = 2k, medium = 8k, heavy = 24k */
  tier: "light" | "medium" | "heavy";
  /** Hard ceiling for this turn */
  maxSkillTokens: number;
}

const TIER_BUDGETS: Record<RouterOptions["tier"], number> = {
  light: 2000,
  medium: 8000,
  heavy: 24000,
};

function matchSkill(skill: Skill, prompt: string, cwd: string): boolean {
  if (!skill.enabled) return false;
  if (skill.match.length === 0) return true; // no filters = always active

  for (const pattern of skill.match) {
    // If pattern looks like a file glob, match against cwd
    if (pattern.includes("/") || pattern.includes("*")) {
      if (minimatch(cwd, pattern) || minimatch(cwd, `**/${pattern}`)) {
        return true;
      }
    }
    // Otherwise treat as keyword
    if (prompt.toLowerCase().includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function findConflicts(skill: Skill, memorySnippets: string[]): SkillConflict[] {
  const conflicts: SkillConflict[] = [];
  for (const mem of memorySnippets) {
    // Simple heuristic: if memory contains the skill name or vice versa, flag it
    const memLower = mem.toLowerCase();
    const skillLower = skill.name.toLowerCase();
    if (memLower.includes(skillLower) || skillLower.includes(memLower)) {
      conflicts.push({
        skillName: skill.name,
        memoryContent: mem.slice(0, 200),
        memoryId: "", // populated by caller if available
      });
    }
  }
  return conflicts;
}

export function selectSkills(
  skills: Skill[],
  options: RouterOptions,
): SkillRoutingResult {
  const tierBudget = TIER_BUDGETS[options.tier];
  const effectiveBudget = Math.min(tierBudget, options.maxSkillTokens);

  const matched = skills.filter((s) => matchSkill(s, options.prompt, options.cwd));

  const selected: Skill[] = [];
  const dropped: Skill[] = [];
  const allConflicts: SkillConflict[] = [];
  let runningTotal = 0;

  for (const skill of matched) {
    const conflicts = findConflicts(skill, options.memorySnippets);
    allConflicts.push(...conflicts);

    if (runningTotal + skill.estimatedTokens <= effectiveBudget) {
      selected.push(skill);
      runningTotal += skill.estimatedTokens;
    } else {
      dropped.push(skill);
    }
  }

  const budgetUsed = effectiveBudget > 0 ? Math.round((runningTotal / effectiveBudget) * 100) : 0;

  return {
    selectedSkills: selected,
    droppedSkills: dropped,
    totalSkillTokens: runningTotal,
    budgetUsed,
    memoryConflicts: allConflicts,
  };
}
