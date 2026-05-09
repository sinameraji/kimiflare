export interface Skill {
  /** Machine-friendly identifier from frontmatter */
  name: string;
  /** Human-readable summary */
  description: string;
  /** Whether the skill is enabled */
  enabled: boolean;
  /** The markdown body */
  body: string;
  /** Absolute path to the skill file */
  filePath: string;
}
