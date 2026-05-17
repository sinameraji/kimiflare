import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with string values", () => {
    const raw = `---
name: react
description: Guidelines for React code
---

# React

Use functional components.
`;
    const result = parseFrontmatter(raw);
    assert.equal(result.data.name, "react");
    assert.equal(result.data.description, "Guidelines for React code");
    assert.equal(result.content, "# React\n\nUse functional components.\n");
  });

  it("returns whole input as content when no frontmatter fence", () => {
    const raw = "just body\nno fence";
    const result = parseFrontmatter(raw);
    assert.deepEqual(result.data, {});
    assert.equal(result.content, "just body\nno fence");
  });

  it("returns empty data and content for empty input", () => {
    const result = parseFrontmatter("");
    assert.deepEqual(result.data, {});
    assert.equal(result.content, "");
  });

  it("parses empty frontmatter", () => {
    const raw = "---\n---\nbody here\n";
    const result = parseFrontmatter(raw);
    assert.deepEqual(result.data, {});
    assert.equal(result.content, "body here\n");
  });

  it("parses boolean values", () => {
    const raw = `---
enabled: true
disabled: false
---
`;
    const result = parseFrontmatter(raw);
    assert.equal(result.data.enabled, true);
    assert.equal(result.data.disabled, false);
  });

  it("parses number values", () => {
    const raw = `---
priority: 10
ratio: 3.14
negative: -5
---
`;
    const result = parseFrontmatter(raw);
    assert.equal(result.data.priority, 10);
    assert.equal(result.data.ratio, 3.14);
    assert.equal(result.data.negative, -5);
  });

  it("parses inline string arrays", () => {
    const raw = `---
match: ["**/*.tsx", "**/*.jsx"]
---
`;
    const result = parseFrontmatter(raw);
    assert.deepEqual(result.data.match, ["**/*.tsx", "**/*.jsx"]);
  });

  it("parses block string arrays", () => {
    const raw = `---
match:
  - "**/*.tsx"
  - "**/*.jsx"
---
`;
    const result = parseFrontmatter(raw);
    assert.deepEqual(result.data.match, ["**/*.tsx", "**/*.jsx"]);
  });

  it("parses unquoted string values", () => {
    const raw = `---
name: simple
---
`;
    const result = parseFrontmatter(raw);
    assert.equal(result.data.name, "simple");
  });

  it("strips matched double-quote pairs", () => {
    const raw = `---
description: "hello world"
---
`;
    const result = parseFrontmatter(raw);
    assert.equal(result.data.description, "hello world");
  });

  it("strips matched single-quote pairs", () => {
    const raw = `---
description: 'hello world'
---
`;
    const result = parseFrontmatter(raw);
    assert.equal(result.data.description, "hello world");
  });

  it("handles CRLF line endings", () => {
    const raw = "---\r\nname: test\r\n---\r\nbody\r\n";
    const result = parseFrontmatter(raw);
    assert.equal(result.data.name, "test");
    assert.equal(result.content, "body\r\n");
  });

  it("preserves content newlines exactly", () => {
    const raw = `---
name: test
---

First line.

Second line.
`;
    const result = parseFrontmatter(raw);
    // gray-matter strips one leading newline after the closing fence
    assert.equal(result.content, "First line.\n\nSecond line.\n");
  });

  it("throws on unsupported nested object", () => {
    const raw = `---
config:
  key: value
---
`;
    assert.throws(() => parseFrontmatter(raw), /Unsupported/);
  });

  it("throws on unsupported number array", () => {
    const raw = `---
nums: [1, 2, 3]
---
`;
    assert.throws(() => parseFrontmatter(raw), /only strings are allowed in arrays/);
  });

  it("throws on unsupported boolean array", () => {
    const raw = `---
flags: [true, false]
---
`;
    assert.throws(() => parseFrontmatter(raw), /only strings are allowed in arrays/);
  });

  it("throws on unclosed frontmatter", () => {
    const raw = `---
name: test
`;
    assert.throws(() => parseFrontmatter(raw), /not closed/);
  });

  it("throws on empty value", () => {
    const raw = `---
name:
---
`;
    assert.throws(() => parseFrontmatter(raw), /Unsupported empty value/);
  });

  it("ignores comments in frontmatter", () => {
    const raw = `---
# This is a comment
name: test
---
`;
    const result = parseFrontmatter(raw);
    assert.equal(result.data.name, "test");
    assert.deepEqual(Object.keys(result.data), ["name"]);
  });

  it("parses mixed types correctly", () => {
    const raw = `---
name: react
description: Guidelines for React code
enabled: true
priority: 10
match:
  - "**/*.tsx"
  - "**/*.jsx"
---
`;
    const result = parseFrontmatter(raw);
    assert.equal(result.data.name, "react");
    assert.equal(result.data.description, "Guidelines for React code");
    assert.equal(result.data.enabled, true);
    assert.equal(result.data.priority, 10);
    assert.deepEqual(result.data.match, ["**/*.tsx", "**/*.jsx"]);
  });
});
