import { describe, it } from "node:test";
import assert from "node:assert";
import { parseSkillFile, parseAgentsMd, PARSER_VERSION } from "./parser.js";

describe("parseSkillFile", () => {
  it("parses a skill with frontmatter and sections", () => {
    const raw = `---
name: testing
description: How to run tests
---

## Unit Tests

Run unit tests with \`npm test\`.

## Integration Tests

Use \`npm run test:integration\`.
`;
    const skill = parseSkillFile("/tmp/testing.md", raw);
    assert.strictEqual(skill.name, "testing");
    assert.strictEqual(skill.description, "How to run tests");
    assert.strictEqual(skill.sections.length, 2);
    assert.strictEqual(skill.sections[0]!.heading, "Unit Tests");
    assert.ok(skill.sections[0]!.body.includes("npm test"));
    assert.strictEqual(skill.sections[1]!.heading, "Integration Tests");
  });

  it("treats content before first ## as a section named after the skill", () => {
    const raw = `---
name: intro
description: Intro
---

This is the intro body.

## Details

More info.
`;
    const skill = parseSkillFile("/tmp/intro.md", raw);
    assert.strictEqual(skill.sections[0]!.heading, "intro");
    assert.ok(skill.sections[0]!.body.includes("This is the intro body."));
  });

  it("creates a single section when no ## headers exist", () => {
    const raw = `---
name: simple
description: A simple skill
---

Just some body text.
`;
    const skill = parseSkillFile("/tmp/simple.md", raw);
    assert.strictEqual(skill.sections.length, 1);
    assert.strictEqual(skill.sections[0]!.heading, "simple");
    assert.ok(skill.sections[0]!.body.includes("Just some body text."));
  });

  it("throws when name is missing", () => {
    const raw = `---
description: no name
---

Body.
`;
    assert.throws(() => parseSkillFile("/tmp/bad.md", raw), /missing required 'name' field/);
  });

  it("computes content hash that changes with parser version", () => {
    const raw = `---
name: hash-test
description: test
---

Body.
`;
    const skill = parseSkillFile("/tmp/hash.md", raw);
    assert.ok(skill.contentHash.length === 64);
    assert.strictEqual(skill.parserVersion, PARSER_VERSION);
  });
});

describe("parseAgentsMd", () => {
  it("creates a virtual skill for each ## section", () => {
    const raw = `# Agent Instructions

## Setup commands

Run \`npm install\` first.

## Code style

Use TypeScript strict mode.
`;
    const skills = parseAgentsMd("/tmp/AGENTS.md", raw);
    assert.strictEqual(skills.length, 2);
    assert.strictEqual(skills[0]!.name, "Setup commands");
    assert.strictEqual(skills[0]!.description, "Run `npm install` first.");
    assert.strictEqual(skills[0]!.sections.length, 1);
    assert.strictEqual(skills[1]!.name, "Code style");
    assert.strictEqual(skills[1]!.description, "Use TypeScript strict mode.");
  });

  it("falls back to heading for description when body starts with code block", () => {
    const raw = `## Testing

\`\`\`bash
npm test
\`\`\`

Run all tests.
`;
    const skills = parseAgentsMd("/tmp/AGENTS.md", raw);
    assert.strictEqual(skills[0]!.description, "Testing");
  });

  it("falls back to heading for description when body starts with a list", () => {
    const raw = `## Deployment

- Staging
- Production
`;
    const skills = parseAgentsMd("/tmp/AGENTS.md", raw);
    assert.strictEqual(skills[0]!.description, "Deployment");
  });

  it("returns empty array when no ## sections", () => {
    const raw = `Just some text without headers.`;
    const skills = parseAgentsMd("/tmp/AGENTS.md", raw);
    assert.strictEqual(skills.length, 0);
  });
});
