import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { scanSkillDir } from "./discovery.js";
import { loadSkillFromSkillMd } from "./loader.js";

/** Create a temp dir, return path and cleanup function. */
function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kimi-skills-test-"));
  return {
    dir,
    cleanup: () => { try { rmSync(dir, { recursive: true }); } catch { /* best effort */ } },
  };
}

function write(relPath: string, content: string, baseDir: string): string {
  const full = join(baseDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

/** Standard SKILL.md content with frontmatter. */
function skillMd(name: string, description = "A skill", body = "# Instructions"): string {
  return `---
name: ${name}
description: ${description}
---

${body}
`;
}

describe("scanSkillDir", () => {
  it("returns empty for non-existent directory", () => {
    const result = scanSkillDir("/tmp/nonexistent-skill-dir-xyz-12345");
    assert.strictEqual(result.length, 0);
  });

  it("returns empty for empty directory", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const result = scanSkillDir(dir);
      assert.strictEqual(result.length, 0);
    } finally { cleanup(); }
  });

  it("finds a single SKILL.md in a subdirectory", () => {
    const { dir, cleanup } = makeTemp();
    try {
      write("my-skill/SKILL.md", skillMd("my-skill"), dir);
      const result = scanSkillDir(dir);
      assert.strictEqual(result.length, 1);
      assert.ok(result[0]!.endsWith("my-skill/SKILL.md"));
    } finally { cleanup(); }
  });

  it("finds multiple SKILL.md files across multiple subdirectories", () => {
    const { dir, cleanup } = makeTemp();
    try {
      write("skill-a/SKILL.md", skillMd("skill-a"), dir);
      write("skill-b/SKILL.md", skillMd("skill-b"), dir);
      write("skill-c/SKILL.md", skillMd("skill-c"), dir);
      const result = scanSkillDir(dir);
      assert.strictEqual(result.length, 3);
    } finally { cleanup(); }
  });

  it("ignores subdirectories without SKILL.md", () => {
    const { dir, cleanup } = makeTemp();
    try {
      write("skill-a/SKILL.md", skillMd("skill-a"), dir);
      mkdirSync(join(dir, "empty-dir"), { recursive: true });
      mkdirSync(join(dir, "just-files"), { recursive: true });
      writeFileSync(join(dir, "just-files", "README.md"), "no skill here");
      const result = scanSkillDir(dir);
      assert.strictEqual(result.length, 1);
    } finally { cleanup(); }
  });

  it("ignores hidden directories (dot-prefixed)", () => {
    const { dir, cleanup } = makeTemp();
    try {
      write("visible/SKILL.md", skillMd("visible"), dir);
      write(".hidden/SKILL.md", skillMd("hidden"), dir);
      const result = scanSkillDir(dir);
      assert.strictEqual(result.length, 1);
      assert.ok(result[0]!.includes("visible"));
    } finally { cleanup(); }
  });

  it("ignores bare .md files at root level", () => {
    const { dir, cleanup } = makeTemp();
    try {
      write("skill-a/SKILL.md", skillMd("skill-a"), dir);
      writeFileSync(join(dir, "bare-skill.md"), skillMd("bare-skill"), "utf8");
      const result = scanSkillDir(dir);
      assert.strictEqual(result.length, 1);
      assert.ok(result[0]!.includes("skill-a"));
    } finally { cleanup(); }
  });
});

describe("loadSkillFromSkillMd", () => {
  it("loads a valid SKILL.md with name and description", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const path = write("test/SKILL.md", skillMd("test-skill", "does things"), dir);
      const skill = loadSkillFromSkillMd(path);
      assert.ok(skill !== null);
      assert.strictEqual(skill!.name, "test-skill");
      assert.strictEqual(skill!.description, "does things");
      assert.ok(skill!.body.includes("# Instructions"));
    } finally { cleanup(); }
  });

  it("returns null for file missing name in frontmatter", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const path = write("no-name/SKILL.md", "---\ndescription: no name\n---\n\nbody", dir);
      const skill = loadSkillFromSkillMd(path);
      assert.strictEqual(skill, null);
    } finally { cleanup(); }
  });

  it("returns null for non-existent file", () => {
    const skill = loadSkillFromSkillMd("/tmp/nonexistent-path-xyz-12345/SKILL.md");
    assert.strictEqual(skill, null);
  });

  it("respects enabled: false in frontmatter", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const path = write("disabled/SKILL.md", `---
name: disabled-skill
description: A disabled skill
enabled: false
---

body
`, dir);
      const skill = loadSkillFromSkillMd(path);
      assert.ok(skill !== null);
      assert.strictEqual(skill!.enabled, false);
    } finally { cleanup(); }
  });

  it("defaults enabled to true", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const path = write("enabled/SKILL.md", skillMd("enabled-skill"), dir);
      const skill = loadSkillFromSkillMd(path);
      assert.ok(skill !== null);
      assert.strictEqual(skill!.enabled, true);
    } finally { cleanup(); }
  });

  it("strips frontmatter from body", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const path = write("test/SKILL.md", `---
name: test
description: test
---

Actual instructions here.
`, dir);
      const skill = loadSkillFromSkillMd(path);
      assert.ok(skill !== null);
      assert.strictEqual(skill!.body, "Actual instructions here.");
      assert.ok(!skill!.body.includes("name:"));
    } finally { cleanup(); }
  });
});
