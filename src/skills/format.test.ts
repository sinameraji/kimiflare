import { describe, it } from "node:test";
import assert from "node:assert";
import { packSections } from "./format.js";
import type { SectionResult } from "./types.js";

function makeSection(similarity: number, bodyLength: number): SectionResult {
  return {
    id: 1,
    heading: "Heading",
    body: "x".repeat(bodyLength),
    name: "skill",
    description: "desc",
    filePath: "/tmp/s.md",
    similarity,
  };
}

describe("packSections", () => {
  it("returns empty when no sections", () => {
    const result = packSections([], 1000);
    assert.strictEqual(result.context, "");
    assert.strictEqual(result.count, 0);
  });

  it("filters out sections below similarity floor", () => {
    const sections = [
      makeSection(0.9, 100),
      makeSection(0.29, 100),
    ];
    const result = packSections(sections, 1000);
    assert.strictEqual(result.count, 1);
    assert.ok(result.context.includes("skill — Heading"));
  });

  it("stops when budget is exhausted", () => {
    const sections = [
      makeSection(0.9, 400), // ~100 tokens + overhead
      makeSection(0.8, 400),
      makeSection(0.7, 400),
    ];
    const result = packSections(sections, 150); // tight budget
    assert.ok(result.count < 3);
    assert.ok(result.tokens <= 150);
  });

  it("includes all sections when budget is generous", () => {
    const sections = [
      makeSection(0.9, 100),
      makeSection(0.8, 100),
      makeSection(0.7, 100),
    ];
    const result = packSections(sections, 10000);
    assert.strictEqual(result.count, 3);
  });
});
