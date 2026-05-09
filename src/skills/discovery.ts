import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findGitRepoRoot } from "../agent/system-prompt.js";

/** Known skill source directories. Returns normalized absolute paths. */
export interface SkillSource {
  /** Absolute path to the .agents/skills/ or .kimiflare/skills/ directory */
  dir: string;
  /** Human-readable tag for display */
  label: string;
  /** Priority group — lower numbers override higher */
  priority: number;
}

/**
 * Enumerate all .agents/skills/ directories across all scopes, in priority order
 * (highest priority first).
 *
 * Priority:
 *   1. cwd/.agents/skills/        (project, compat)
 *   2. ancestor .agents/skills/    (closest → git root)
 *   3. ~/.agents/skills/           (global)
 */
export function enumerateAgentsSkillDirs(cwd: string): SkillSource[] {
  const sources: SkillSource[] = [];

  // 1. Project-level: cwd/.agents/skills/
  sources.push({
    dir: resolve(cwd, ".agents", "skills"),
    label: ".agents (project)",
    priority: 1,
  });

  // 2. Ancestor .agents/skills/ directories (cwd → git root)
  const gitRoot = findGitRepoRoot(cwd);
  const walkEnd = gitRoot ?? resolve("/");
  let dir = resolve(cwd);
  const ancestorDirs: string[] = [];
  while (true) {
    const agentDir = resolve(dir, ".agents", "skills");
    if (agentDir !== resolve(cwd, ".agents", "skills")) {
      ancestorDirs.push(agentDir);
    }
    const parent = dirname(dir);
    if (dir === walkEnd) break;
    if (parent === dir) break;
    dir = parent;
  }
  // Reverse so closest parent comes first (higher priority)
  ancestorDirs.reverse();
  for (const ad of ancestorDirs) {
    sources.push({
      dir: ad,
      label: `.agents (ancestor) — ${ad}`,
      priority: 2,
    });
  }

  // 3. Global: ~/.agents/skills/
  sources.push({
    dir: join(homedir(), ".agents", "skills"),
    label: ".agents (global)",
    priority: 3,
  });

  return sources;
}

/**
 * Enumerate all skill source directories across ALL locations.
 * Priority order (highest first):
 *   1. cwd/.kimiflare/skills/
 *   2. cwd/.agents/skills/
 *   3. ancestor .agents/skills/ (closest → git root)
 *   4. ~/.agents/skills/ + ~/.config/kimiflare/skills/ (same level)
 */
export function enumerateAllSkillDirs(cwd: string): SkillSource[] {
  const sources: SkillSource[] = [];

  // 1. Project-level: cwd/.kimiflare/skills/
  sources.push({
    dir: resolve(cwd, ".kimiflare", "skills"),
    label: ".kimiflare (project)",
    priority: 1,
  });

  // 2-4. All .agents/ locations
  sources.push(...enumerateAgentsSkillDirs(cwd).map((s) => ({
    ...s,
    priority: s.priority + 1, // .agents/ is one level below .kimiflare/
  })));

  // 4 (continuation). ~/.config/kimiflare/skills/ at same level as ~/.agents/skills/
  sources.push({
    dir: join(homedir(), ".config", "kimiflare", "skills"),
    label: ".config/kimiflare (global)",
    priority: 4,
  });

  return sources;
}

/** Scan a single skill directory for SKILL.md subdirectories.
 *  Returns absolute paths to each SKILL.md found. */
export function scanSkillDir(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillMdPath = join(dir, entry.name, "SKILL.md");
      if (existsSync(skillMdPath)) {
        try {
          const s = statSync(skillMdPath);
          if (s.isFile()) results.push(skillMdPath);
        } catch {
          // skip unreadable
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}
