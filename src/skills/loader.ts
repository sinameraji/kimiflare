import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import matter from "gray-matter";
import type { Skill, SkillManifest } from "./types.js";

const DEFAULTS: Required<Pick<SkillManifest, "scope" | "priority" | "enabled" | "match">> = {
  scope: "global",
  priority: 0,
  enabled: true,
  match: [],
};

function normalizeManifest(raw: Record<string, unknown>, filePath: string): SkillManifest {
  const name = typeof raw.name === "string" ? raw.name : "";
  const description = typeof raw.description === "string" ? raw.description : "";
  const match = Array.isArray(raw.match)
    ? raw.match.filter((m): m is string => typeof m === "string")
    : DEFAULTS.match;
  const scope = raw.scope === "project" ? "project" : DEFAULTS.scope;
  const priority = typeof raw.priority === "number" ? raw.priority : DEFAULTS.priority;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled;

  if (!name) {
    throw new Error(`Skill file missing required 'name' field: ${filePath}`);
  }

  return { name, description, match, scope, priority, enabled };
}

export async function loadSkillFile(filePath: string): Promise<Skill> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = matter(raw);
  const manifest = normalizeManifest(parsed.data as Record<string, unknown>, filePath);

  const body = parsed.content.trim();
  const estimatedTokens = Math.ceil(body.length / 4);

  return {
    name: manifest.name,
    description: manifest.description,
    match: manifest.match ?? DEFAULTS.match,
    scope: manifest.scope ?? DEFAULTS.scope,
    priority: manifest.priority ?? DEFAULTS.priority,
    enabled: manifest.enabled ?? DEFAULTS.enabled,
    body,
    filePath,
    estimatedTokens,
  };
}

/**
 * Load skills from flat .md files in a directory (kimiflare native format).
 * Used for .kimiflare/skills/ until format migration (U3).
 */
export async function loadSkillsFromDir(dirPath: string): Promise<Skill[]> {
  try {
    const entries = await readdir(dirPath);
    const files: string[] = [];

    for (const entry of entries) {
      const full = join(dirPath, entry);
      const s = await stat(full);
      if (s.isFile() && extname(entry) === ".md") {
        files.push(full);
      }
    }

    const skills = await Promise.all(files.map(loadSkillFile));
    // Sort by priority ascending (lower first, can be overridden by higher later)
    skills.sort((a, b) => a.priority - b.priority);
    return skills;
  } catch {
    return [];
  }
}

/**
 * Load skills from SKILL.md-inside-subdir format (Agent Skills standard).
 * Used for .agents/skills/ directories.
 * Reads frontmatter and body, no routing fields.
 */
export function loadSkillFromSkillMd(skillMdPath: string): Skill | null {
  try {
    if (!existsSync(skillMdPath)) return null;
    const raw = readFileSync(skillMdPath, "utf-8");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const name = typeof data.name === "string" ? data.name : "";
    const description = typeof data.description === "string" ? data.description : "";
    if (!name) return null;
    const body = parsed.content.trim();
    return {
      name,
      description,
      match: [] as string[],
      scope: "project" as const,
      priority: 0,
      enabled: typeof data.enabled === "boolean" ? data.enabled : true,
      body,
      filePath: skillMdPath,
      estimatedTokens: Math.ceil(body.length / 4),
    };
  } catch {
    return null;
  }
}
