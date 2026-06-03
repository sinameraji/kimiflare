import { describe, it } from "node:test";
import assert from "node:assert";
import { distillSessionPlan } from "./distill.js";
import type { ChatMessage } from "./messages.js";

describe("distillSessionPlan", () => {
  it("returns null when there are no assistant messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ];
    assert.strictEqual(distillSessionPlan(messages), null);
  });

  it("returns null when the assistant message is too short", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "ok" },
    ];
    assert.strictEqual(distillSessionPlan(messages), null);
  });

  it("returns the text of a valid plan message", () => {
    const plan = "Here is the plan:\n1. First do this\n2. Then do that";
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Plan this out" },
      { role: "assistant", content: plan },
    ];
    assert.strictEqual(distillSessionPlan(messages), plan);
  });

  it("returns concatenated text from content parts array", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Plan this out" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Part one of the plan." },
          { type: "text", text: "Part two of the plan." },
        ],
      },
    ];
    const result = distillSessionPlan(messages);
    assert.strictEqual(result, "Part one of the plan.\nPart two of the plan.");
  });

  it("skips non-text content parts", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Plan this out" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Here is the plan with an image:" },
          { type: "image_url", image_url: { url: "http://example.com/img.png" } },
          { type: "text", text: "Continue with more planning details here." },
        ],
      },
    ];
    const result = distillSessionPlan(messages);
    assert.strictEqual(
      result,
      "Here is the plan with an image:\nContinue with more planning details here.",
    );
  });

  it("returns the most recent substantive assistant message", () => {
    const oldPlan = "Old plan that is long enough to qualify";
    const newPlan = "New plan that is also long enough to qualify here";
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "First request" },
      { role: "assistant", content: oldPlan },
      { role: "user", content: "Second request" },
      { role: "assistant", content: newPlan },
    ];
    assert.strictEqual(distillSessionPlan(messages), newPlan);
  });

  it("ignores short assistant messages and finds a longer one earlier", () => {
    const plan = "This is a substantial plan with enough content to be useful";
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: plan },
      { role: "user", content: "Thanks" },
      { role: "assistant", content: "ok" },
    ];
    assert.strictEqual(distillSessionPlan(messages), plan);
  });

  it("returns null for empty messages array", () => {
    assert.strictEqual(distillSessionPlan([]), null);
  });
});
