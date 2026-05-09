import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { readdir, stat } from "node:fs/promises";
import matter from "gray-matter";
import type { Skill } from "./types.js";

export async function loadSkillFile(filePath: string): Promise<Skill> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name : "";
  const description = typeof data.description === "string" ? data.description : "";
  const enabled = typeof data.enabled === "boolean" ? data.enabled : true;

  if (!name) {
    throw new Error(`Skill file missing required 'name' field: ${filePath}`);
  }

  const body = parsed.content.trim();
  return { name, description, enabled, body, filePath };
}

/**
 * Load skills from flat .md files in a directory.
 * Used for legacy .kimiflare/skills/ and ~/.config/kimiflare/skills/ until migration.
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

    return await Promise.all(files.map(loadSkillFile));
  } catch {
    return [];
  }
}

/**
 * Load a skill from an Agent Skills standard SKILL.md file.
 * Used for .agents/skills/ directories.
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
    const enabled = typeof data.enabled === "boolean" ? data.enabled : true;
    const body = parsed.content.trim();
    return { name, description, enabled, body, filePath: skillMdPath };
  } catch {
    return null;
  }
}
