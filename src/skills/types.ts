export type SkillScope = "global" | "project";

export interface SkillManifest {
  name: string;
  description: string;
  match?: string[];
  scope?: SkillScope;
  priority?: number;
  enabled?: boolean;
}

export interface Skill {
  /** Machine-friendly identifier from frontmatter */
  name: string;
  /** Human-readable summary */
  description: string;
  /** File globs that trigger auto-activation */
  match: string[];
  /** "global" or "project" */
  scope: SkillScope;
  /** Higher = later in prompt (can override lower) */
  priority: number;
  /** Whether the skill is enabled */
  enabled: boolean;
  /** The markdown body (injected into system prompt) */
  body: string;
  /** Absolute path to the skill file */
  filePath: string;
  /** Estimated tokens (chars / 4) */
  estimatedTokens: number;
}

export interface SkillConflict {
  skillName: string;
  memoryContent: string;
  memoryId: string;
}

export interface SkillRoutingResult {
  /** Skills injected into this turn */
  selectedSkills: Skill[];
  /** Skills that matched but didn't fit the budget */
  droppedSkills: Skill[];
  /** Total tokens consumed by selected skills */
  totalSkillTokens: number;
  /** Percentage of tier budget used (0-100) */
  budgetUsed: number;
  /** Skills that contradict retrieved memory */
  memoryConflicts: SkillConflict[];
}
