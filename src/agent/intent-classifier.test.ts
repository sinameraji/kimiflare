import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyIntent, shouldSwitchRole } from "./intent-classifier.js";
import type { AgentRole } from "./agent-session.js";

describe("classifyIntent", () => {
  it("classifies exploration as plan", () => {
    const result = classifyIntent({ text: "Explore the codebase and find all TODO comments" });
    assert.strictEqual(result.role, "plan");
    assert.strictEqual(result.method, "heuristic");
    assert.ok(result.confidence > 0.5);
  });

  it("classifies implementation as build", () => {
    const result = classifyIntent({ text: "Implement a new logging system for errors" });
    assert.strictEqual(result.role, "build");
    assert.ok(result.confidence > 0.5);
  });

  it("classifies chat as general", () => {
    const result = classifyIntent({ text: "Hello, how are you today?" });
    assert.strictEqual(result.role, "general");
  });

  it("defaults to general for ambiguous input", () => {
    const result = classifyIntent({ text: "Do something with the code" });
    assert.strictEqual(result.role, "general");
    assert.ok(result.confidence < 0.5);
  });

  it("respects custom minConfidence", () => {
    const result = classifyIntent({ text: "Do something with files", minConfidence: 0.9 });
    // No strong keywords; should fall back to general due to low confidence
    assert.strictEqual(result.role, "general");
    assert.ok(result.confidence < 0.9);
  });

  it("handles mixed signals by picking strongest", () => {
    const result = classifyIntent({ text: "Explore and implement a new feature" });
    // Both plan and build keywords present; should pick one with higher score
    assert.ok(result.role === "plan" || result.role === "build");
    assert.ok(result.confidence > 0);
  });
});

describe("shouldSwitchRole", () => {
  it("returns null when confidence is below threshold", () => {
    const classification = { role: "build" as AgentRole, confidence: 0.4, method: "heuristic" as const };
    const result = shouldSwitchRole("general", classification);
    assert.strictEqual(result, null);
  });

  it("returns null when already on target role", () => {
    const classification = { role: "plan" as AgentRole, confidence: 0.9, method: "heuristic" as const };
    const result = shouldSwitchRole("plan", classification);
    assert.strictEqual(result, null);
  });

  it("switches when confidence is high", () => {
    const classification = { role: "build" as AgentRole, confidence: 0.9, method: "heuristic" as const };
    const result = shouldSwitchRole("plan", classification);
    assert.strictEqual(result, "build");
  });

  it("preserves general role unless very confident", () => {
    const classification = { role: "build" as AgentRole, confidence: 0.7, method: "heuristic" as const };
    const result = shouldSwitchRole("general", classification);
    assert.strictEqual(result, null); // 0.7 < 0.75 preserveGeneral threshold
  });

  it("switches from general when very confident", () => {
    const classification = { role: "build" as AgentRole, confidence: 0.8, method: "heuristic" as const };
    const result = shouldSwitchRole("general", classification);
    assert.strictEqual(result, "build");
  });

  it("allows switching away from general when preserveGeneral is false", () => {
    const classification = { role: "build" as AgentRole, confidence: 0.6, method: "heuristic" as const };
    const result = shouldSwitchRole("general", classification, { preserveGeneral: false });
    assert.strictEqual(result, "build");
  });
});
