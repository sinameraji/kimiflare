import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyIntent, shouldSwitchRole } from "./intent-classifier.js";
import type { AgentRole } from "./agent-session.js";

describe("classifyIntent", () => {
  it("classifies exploration as research", () => {
    const result = classifyIntent({ text: "Explore the codebase and find all TODO comments" });
    assert.strictEqual(result.role, "research");
    assert.strictEqual(result.method, "heuristic");
    assert.ok(result.confidence > 0.5);
  });

  it("classifies implementation as coding", () => {
    const result = classifyIntent({ text: "Implement a new logging system for errors" });
    assert.strictEqual(result.role, "coding");
    assert.ok(result.confidence > 0.5);
  });

  it("classifies chat as generalist", () => {
    const result = classifyIntent({ text: "Hello, how are you today?" });
    assert.strictEqual(result.role, "generalist");
  });

  it("defaults to generalist for ambiguous input", () => {
    const result = classifyIntent({ text: "Do something with the code" });
    assert.strictEqual(result.role, "generalist");
    assert.ok(result.confidence < 0.5);
  });

  it("respects custom minConfidence", () => {
    const result = classifyIntent({ text: "Do something with files", minConfidence: 0.9 });
    // No strong keywords; should fall back to generalist due to low confidence
    assert.strictEqual(result.role, "generalist");
    assert.ok(result.confidence < 0.9);
  });

  it("handles mixed signals by picking strongest", () => {
    const result = classifyIntent({ text: "Explore and implement a new feature" });
    // Both research and coding keywords present; should pick one with higher score
    assert.ok(result.role === "research" || result.role === "coding");
    assert.ok(result.confidence > 0);
  });
});

describe("shouldSwitchRole", () => {
  it("returns null when confidence is below threshold", () => {
    const classification = { role: "coding" as AgentRole, confidence: 0.4, method: "heuristic" as const };
    const result = shouldSwitchRole("generalist", classification);
    assert.strictEqual(result, null);
  });

  it("returns null when already on target role", () => {
    const classification = { role: "research" as AgentRole, confidence: 0.9, method: "heuristic" as const };
    const result = shouldSwitchRole("research", classification);
    assert.strictEqual(result, null);
  });

  it("switches when confidence is high", () => {
    const classification = { role: "coding" as AgentRole, confidence: 0.9, method: "heuristic" as const };
    const result = shouldSwitchRole("research", classification);
    assert.strictEqual(result, "coding");
  });

  it("preserves generalist role unless very confident", () => {
    const classification = { role: "coding" as AgentRole, confidence: 0.7, method: "heuristic" as const };
    const result = shouldSwitchRole("generalist", classification);
    assert.strictEqual(result, null); // 0.7 < 0.75 preserveGeneralist threshold
  });

  it("switches from generalist when very confident", () => {
    const classification = { role: "coding" as AgentRole, confidence: 0.8, method: "heuristic" as const };
    const result = shouldSwitchRole("generalist", classification);
    assert.strictEqual(result, "coding");
  });

  it("allows switching away from generalist when preserveGeneralist is false", () => {
    const classification = { role: "coding" as AgentRole, confidence: 0.6, method: "heuristic" as const };
    const result = shouldSwitchRole("generalist", classification, { preserveGeneralist: false });
    assert.strictEqual(result, "coding");
  });
});
