import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import type { Skill } from "./types.js";
import { loadSkillFromSkillMd, loadSkillsFromDir } from "./loader.js";
import { enumerateAllSkillDirs, enumerateAgentsSkillDirs, scanSkillDir } from "./discovery.js";
import type { SkillSource } from "./discovery.js";

export interface SkillWithSource extends Skill {
  sourceLabel: string;
  sourceDir: string;
}

export interface SkillDirInfo {
  projectDir: string;
  globalDir: string;
}

export function getSkillDirs(cwd: string): SkillDirInfo {
  return {
    projectDir: join(cwd, ".kimiflare", "skills"),
    globalDir: join(process.env.HOME ?? "", ".config", "kimiflare", "skills"),
  };
}

/**
 * List ALL skills from ALL locations, merged with dedup by name
 * (higher priority wins). Returns a flat array with source metadata.
 */
export async function listAllSkills(cwd: string): Promise<{
  all: SkillWithSource[];
  warnings: string[];
}> {
  const sources = enumerateAllSkillDirs(cwd);
  const seen = new Map<string, SkillWithSource>();
  const warnings: string[] = [];

  for (const source of sources) {
    // .kimiflare/skills/ uses flat .md format (for now)
    // .agents/skills/ uses SKILL.md-inside-subdir format
    const isKimiflareNative = source.dir.includes(".kimiflare");

    if (isKimiflareNative) {
      const skills = await loadSkillsFromDir(source.dir).catch(() => [] as Skill[]);
      for (const skill of skills) {
        if (seen.has(skill.name)) {
          warnings.push(`"${skill.name}" shadowed by higher-priority source`);
        } else {
          seen.set(skill.name, { ...skill, sourceLabel: source.label, sourceDir: source.dir });
        }
      }
    } else {
      // .agents/ format: SKILL.md inside subdirs
      const skillMdPaths = scanSkillDir(source.dir);
      for (const path of skillMdPaths) {
        const skill = loadSkillFromSkillMd(path);
        if (!skill) continue;
        if (seen.has(skill.name)) {
          warnings.push(`"${skill.name}" in ${source.label} shadowed by higher-priority source`);
        } else {
          seen.set(skill.name, { ...skill, sourceLabel: source.label, sourceDir: source.dir });
        }
      }
    }
  }

  return { all: Array.from(seen.values()), warnings };
}

/** Legacy signature for backward compat — only .kimiflare/skills/ project + global. */
export async function listLegacySkills(cwd: string): Promise<{
  project: Skill[];
  global: Skill[];
}> {
  const dirs = getSkillDirs(cwd);
  const [project, global] = await Promise.all([
    loadSkillsFromDir(dirs.projectDir).catch(() => [] as Skill[]),
    loadSkillsFromDir(dirs.globalDir).catch(() => [] as Skill[]),
  ]);
  return { project, global };
}

export interface CreateSkillOptions {
  name: string;
  description?: string;
  /** Target location: "kimiflare" (.kimiflare/skills/), "agents" (.agents/skills/), or "global" (~/.config/kimiflare/skills/) */
  location?: "kimiflare" | "agents" | "global";
  /** Legacy scope field — kept for backward compat */
  scope?: "project" | "global";
  cwd: string;
}

export async function createSkill(opts: CreateSkillOptions): Promise<{ filepath: string }> {
  const loc = opts.location ?? (opts.scope === "global" ? "global" : "kimiflare");
  let dir: string;
  switch (loc) {
    case "kimiflare":
      dir = join(opts.cwd, ".kimiflare", "skills");
      break;
    case "agents":
      dir = join(opts.cwd, ".agents", "skills");
      break;
    case "global":
      dir = join(process.env.HOME ?? "", ".config", "kimiflare", "skills");
      break;
  }
  const skillDir = join(dir, opts.name);
  const filepath = join(skillDir, "SKILL.md");

  const description = opts.description || "";

  const frontmatter: Record<string, unknown> = {
    name: opts.name,
    enabled: true,
  };
  if (opts.description) frontmatter.description = opts.description;

  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const content = `---\n${yaml}\n---\n\n# ${opts.name}\n\nAdd your instructions here.\n`;

  await mkdir(skillDir, { recursive: true });
  await writeFile(filepath, content, "utf8");

  return { filepath };
}

export async function deleteSkill(name: string, cwd: string): Promise<{ filepath: string }> {
  const all = await listAllSkills(cwd);
  const skill = all.all.find((s) => s.name === name);
  if (!skill) throw new Error(`skill "${name}" not found`);
  await unlink(skill.filePath);
  return { filepath: skill.filePath };
}

export async function setSkillEnabled(
  name: string,
  enabled: boolean,
  cwd: string,
): Promise<{ filepath: string }> {
  const all = await listAllSkills(cwd);
  const skill = all.all.find((s) => s.name === name);
  if (!skill) throw new Error(`skill "${name}" not found`);

  const raw = await readFile(skill.filePath, "utf-8");
  const parsed = matter(raw);
  parsed.data.enabled = enabled;

  const yaml = Object.entries(parsed.data)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map((item) => `  - ${item}`).join("\n")}`;
      return `${k}: ${v}`;
    })
    .join("\n");

  const content = `---\n${yaml}\n---\n${parsed.content}`;
  await writeFile(skill.filePath, content, "utf8");

  return { filepath: skill.filePath };
}

export async function findSkillFile(name: string, cwd: string): Promise<string | null> {
  const all = await listAllSkills(cwd);
  const skill = all.all.find((s) => s.name === name);
  return skill?.filePath ?? null;
}
