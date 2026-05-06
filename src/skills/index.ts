import { loadSkillsFromDir } from "./loader.js";
import { selectSkills } from "./router.js";
import type { Skill, SkillRoutingResult } from "./types.js";

export type { Skill, SkillRoutingResult, SkillManifest, SkillScope, SkillConflict } from "./types.js";
export { loadSkillsFromDir, selectSkills };

/** Convenience: load + route in one call */
export async function routeSkills(
  skillDir: string,
  opts: Parameters<typeof selectSkills>[1],
): Promise<SkillRoutingResult> {
  const skills = await loadSkillsFromDir(skillDir);
  return selectSkills(skills, opts);
}
