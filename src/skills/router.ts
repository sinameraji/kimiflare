import type Database from "better-sqlite3";
import type { AiGatewayOptions } from "../agent/client.js";
import type { SemanticSkillRoutingResult, SectionResult } from "./types.js";
import { searchSections } from "./search.js";
import { buildSkillContext } from "./format.js";

export interface RouterOptions {
  /** User's raw prompt */
  prompt: string;
  /** Budget tier: light = 2k, medium = 8k, heavy = 24k */
  tier: "light" | "medium" | "heavy";
  /** Hard ceiling for this turn */
  maxSkillTokens?: number;
}

export interface RouterDeps {
  db: Database.Database;
  accountId: string;
  apiToken: string;
  embeddingModel?: string;
  gateway?: AiGatewayOptions;
  cloudMode?: boolean;
  cloudToken?: string;
  cloudDeviceId?: string;
}

/**
 * Select relevant skill sections using semantic search and pack them
 * into the token budget.
 */
export async function selectSkills(
  opts: RouterOptions,
  deps: RouterDeps
): Promise<SemanticSkillRoutingResult> {
  const sections = await searchSections(opts.prompt, deps.db, {
    accountId: deps.accountId,
    apiToken: deps.apiToken,
    model: deps.embeddingModel,
    gateway: deps.gateway,
    cloudMode: deps.cloudMode,
    cloudToken: deps.cloudToken,
    cloudDeviceId: deps.cloudDeviceId,
  });

  return buildSkillContext(sections, opts.tier, opts.maxSkillTokens);
}

/**
 * Synchronous version for testing packing logic without embeddings.
 */
export function selectSkillsFromSections(
  sections: SectionResult[],
  opts: Pick<RouterOptions, "tier" | "maxSkillTokens">
): SemanticSkillRoutingResult {
  return buildSkillContext(sections, opts.tier, opts.maxSkillTokens);
}
