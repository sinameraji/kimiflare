import { describe, it } from "node:test";
import assert from "node:assert";
import { selectSkills } from "./router.js";
import type { Skill } from "./types.js";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "test-skill",
    description: "A test skill",
    match: [],
    scope: "global",
    priority: 0,
    enabled: true,
    body: "body content here",
    filePath: "/tmp/test.md",
    estimatedTokens: 100,
    ...overrides,
  };
}

describe("selectSkills", () => {
  it("returns empty when no skills match", () => {
    const skills = [makeSkill({ match: ["react"], name: "react" })];
    const result = selectSkills(skills, {
      cwd: "/tmp",
      prompt: "hello world",
      memorySnippets: [],
      tier: "light",
      maxSkillTokens: 2000,
    });
    assert.strictEqual(result.selectedSkills.length, 0);
    assert.strictEqual(result.droppedSkills.length, 0);
  });

  it("selects skills that match prompt keywords", () => {
    const skills = [makeSkill({ match: ["react"], name: "react" })];
    const result = selectSkills(skills, {
      cwd: "/tmp",
      prompt: "how do I use react",
      memorySnippets: [],
      tier: "light",
      maxSkillTokens: 2000,
    });
    assert.strictEqual(result.selectedSkills.length, 1);
    assert.strictEqual(result.selectedSkills[0]!.name, "react");
  });

  it("respects tier budget and drops oversized skills", () => {
    const skills = [
      makeSkill({ name: "small", match: [], estimatedTokens: 500 }),
      makeSkill({ name: "large", match: [], estimatedTokens: 3000 }),
    ];
    const result = selectSkills(skills, {
      cwd: "/tmp",
      prompt: "hello",
      memorySnippets: [],
      tier: "light",
      maxSkillTokens: 2000,
    });
    assert.strictEqual(result.selectedSkills.length, 1);
    assert.strictEqual(result.selectedSkills[0]!.name, "small");
    assert.strictEqual(result.droppedSkills.length, 1);
    assert.strictEqual(result.droppedSkills[0]!.name, "large");
  });

  it("respects maxSkillTokens ceiling below tier budget", () => {
    const skills = [makeSkill({ name: "med", match: [], estimatedTokens: 5000 })];
    const result = selectSkills(skills, {
      cwd: "/tmp",
      prompt: "hello",
      memorySnippets: [],
      tier: "heavy",
      maxSkillTokens: 2000,
    });
    assert.strictEqual(result.selectedSkills.length, 0);
    assert.strictEqual(result.droppedSkills.length, 1);
  });

  it("detects memory conflicts by name overlap", () => {
    const skills = [makeSkill({ name: "react-patterns", match: [] })];
    const result = selectSkills(skills, {
      cwd: "/tmp",
      prompt: "hello",
      memorySnippets: ["react-patterns should not be used in this project"],
      tier: "light",
      maxSkillTokens: 2000,
    });
    assert.strictEqual(result.memoryConflicts.length, 1);
    assert.strictEqual(result.memoryConflicts[0]!.skillName, "react-patterns");
  });

  it("ignores disabled skills", () => {
    const skills = [makeSkill({ name: "off", enabled: false, match: [] })];
    const result = selectSkills(skills, {
      cwd: "/tmp",
      prompt: "hello",
      memorySnippets: [],
      tier: "light",
      maxSkillTokens: 2000,
    });
    assert.strictEqual(result.selectedSkills.length, 0);
  });
});
