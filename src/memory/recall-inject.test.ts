import { describe, it } from "node:test";
import assert from "node:assert";
import type { ChatMessage } from "../agent/messages.js";
import { RECALLED_MEMORY_HEADER, hasRecalledMemory, injectRecalledMemoryOnce } from "./recall-inject.js";

function basePrefix(): ChatMessage[] {
  return [
    { role: "system", content: "static prefix" },
    { role: "system", content: "session prefix (KIMI.md ...)" },
    { role: "user", content: "do the thing" },
  ];
}

describe("injectRecalledMemoryOnce", () => {
  it("injects one block right after the leading system prefix", () => {
    const msgs = basePrefix();
    const injected = injectRecalledMemoryOnce(msgs, "repo recently modified README.md");
    assert.equal(injected, true);
    // Inserted at index 2 (after the two system-prefix messages), pushing the user msg to index 3
    assert.equal(msgs.length, 4);
    assert.equal(msgs[2]!.role, "system");
    assert.ok((msgs[2]!.content as string).startsWith(RECALLED_MEMORY_HEADER));
    assert.ok((msgs[2]!.content as string).includes("repo recently modified README.md"));
    assert.equal(msgs[3]!.role, "user");
  });

  it("is idempotent across turns — never stacks a second block (the cache-bust fix)", () => {
    const msgs = basePrefix();
    assert.equal(injectRecalledMemoryOnce(msgs, "first synthesis"), true);
    // Simulate a later turn re-synthesizing a byte-different paraphrase
    assert.equal(injectRecalledMemoryOnce(msgs, "a differently worded paraphrase"), false);
    assert.equal(injectRecalledMemoryOnce(msgs, "yet another paraphrase"), false);
    const recallBlocks = msgs.filter(
      (m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith(RECALLED_MEMORY_HEADER),
    );
    assert.equal(recallBlocks.length, 1, "exactly one recall block");
    // The block keeps its ORIGINAL content (byte-stable prefix)
    assert.ok((recallBlocks[0]!.content as string).includes("first synthesis"));
  });

  it("keeps the prefix byte-stable: indices 0..2 unchanged on a no-op second call", () => {
    const msgs = basePrefix();
    injectRecalledMemoryOnce(msgs, "first synthesis");
    const snapshot = msgs.slice(0, 3).map((m) => JSON.stringify(m));
    // append more history (as a real turn would) then attempt re-injection
    msgs.push({ role: "assistant", content: "working..." });
    injectRecalledMemoryOnce(msgs, "new paraphrase");
    assert.deepEqual(msgs.slice(0, 3).map((m) => JSON.stringify(m)), snapshot);
  });

  it("no-ops on empty text", () => {
    const msgs = basePrefix();
    assert.equal(injectRecalledMemoryOnce(msgs, ""), false);
    assert.equal(msgs.length, 3);
  });

  it("inserts at the end when there are no system messages", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "hi" }];
    assert.equal(injectRecalledMemoryOnce(msgs, "ctx"), true);
    assert.equal(msgs[1]!.role, "system");
  });
});

describe("hasRecalledMemory", () => {
  it("detects a present block and ignores ordinary system messages", () => {
    assert.equal(hasRecalledMemory(basePrefix()), false);
    const msgs = basePrefix();
    injectRecalledMemoryOnce(msgs, "ctx");
    assert.equal(hasRecalledMemory(msgs), true);
  });
});
