import { describe, it } from "node:test";
import assert from "node:assert";
import { extractFirstUserText } from "./use-session-manager.js";
import type { ChatMessage } from "../agent/messages.js";

describe("extractFirstUserText", () => {
  it("returns 'session' for empty messages", () => {
    assert.strictEqual(extractFirstUserText([]), "session");
  });

  it("returns 'session' when there is no user message", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "you are kimi" },
      { role: "assistant", content: "hi" },
    ];
    assert.strictEqual(extractFirstUserText(msgs), "session");
  });

  it("returns string content directly", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "fix the bug in auth.ts" },
    ];
    assert.strictEqual(extractFirstUserText(msgs), "fix the bug in auth.ts");
  });

  it("extracts the first text part from an array-shaped user message", () => {
    const msgs: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", image_url: { url: "data:..." } } as never,
          { type: "text", text: "describe this screenshot" },
        ],
      },
    ];
    assert.strictEqual(extractFirstUserText(msgs), "describe this screenshot");
  });

  it("falls back to 'session' when array content has no text part", () => {
    const msgs: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "image", image_url: { url: "data:..." } } as never],
      },
    ];
    assert.strictEqual(extractFirstUserText(msgs), "session");
  });

  it("falls back to 'session' when string content is empty", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "" }];
    assert.strictEqual(extractFirstUserText(msgs), "session");
  });

  it("uses only the first user message, ignoring later ones", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
    ];
    assert.strictEqual(extractFirstUserText(msgs), "first");
  });
});
