import { loadSkillFromSkillMd, loadSkillsFromDir } from "./loader.js";
import { selectSkills } from "./router.js";
import type { Skill, SkillRoutingResult } from "./types.js";
import { enumerateAllSkillDirs, enumerateAgentsSkillDirs, scanSkillDir } from "./discovery.js";
import type { SkillSource } from "./discovery.js";

export type { Skill, SkillRoutingResult, SkillManifest, SkillScope, SkillConflict } from "./types.js";
export type { SkillSource } from "./discovery.js";
export {
  loadSkillsFromDir,
  loadSkillFromSkillMd,
  selectSkills,
  enumerateAllSkillDirs,
  enumerateAgentsSkillDirs,
  scanSkillDir,
};

/** Convenience: load + route in one call */
export async function routeSkills(
  skillDir: string,
  opts: Parameters<typeof selectSkills>[1],
): Promise<SkillRoutingResult> {
  const skills = await loadSkillsFromDir(skillDir);
  return selectSkills(skills, opts);
}
