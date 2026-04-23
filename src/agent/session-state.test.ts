import { describe, it } from "node:test";
import assert from "node:assert";
import {
  emptySessionState,
  ArtifactStore,
  formatRecalledArtifacts,
  serializeSessionState,
  buildSessionStateMessage,
} from "./session-state.js";

describe("emptySessionState", () => {
  it("returns a state with empty arrays and no task", () => {
    const s = emptySessionState();
    assert.strictEqual(s.task, "");
    assert.deepStrictEqual(s.user_constraints, []);
    assert.deepStrictEqual(s.files_touched, []);
    assert.deepStrictEqual(s.artifact_index, {});
  });

  it("accepts an initial task", () => {
    const s = emptySessionState("fix bug");
    assert.strictEqual(s.task, "fix bug");
  });
});

describe("ArtifactStore", () => {
  it("stores and retrieves artifacts", () => {
    const store = new ArtifactStore();
    const a = {
      id: "a1",
      type: "read_slice" as const,
      summary: "read src/index.ts",
      raw: "content",
      source: "read",
      ts: new Date().toISOString(),
    };
    store.add(a);
    assert.strictEqual(store.get("a1")?.id, "a1");
    assert.strictEqual(store.size(), 1);
  });

  it("evicts oldest when maxArtifacts is reached", () => {
    const store = new ArtifactStore({ maxArtifacts: 2, maxTotalChars: 10_000 });
    store.add({ id: "a1", type: "bash_log", summary: "s1", raw: "x", source: "bash", ts: "2024-01-01T00:00:00Z" });
    store.add({ id: "a2", type: "bash_log", summary: "s2", raw: "x", source: "bash", ts: "2024-01-02T00:00:00Z" });
    store.add({ id: "a3", type: "bash_log", summary: "s3", raw: "x", source: "bash", ts: "2024-01-03T00:00:00Z" });
    assert.strictEqual(store.size(), 2);
    assert.strictEqual(store.get("a1"), undefined);
    assert.ok(store.get("a2"));
    assert.ok(store.get("a3"));
  });

  it("evicts when total chars exceed maxTotalChars", () => {
    const store = new ArtifactStore({ maxArtifacts: 10, maxTotalChars: 10 });
    store.add({ id: "a1", type: "bash_log", summary: "s1", raw: "12345", source: "bash", ts: "2024-01-01T00:00:00Z" });
    store.add({ id: "a2", type: "bash_log", summary: "s2", raw: "1234567890", source: "bash", ts: "2024-01-02T00:00:00Z" });
    // a1 should be evicted because a2 alone exceeds maxTotalChars
    assert.strictEqual(store.get("a1"), undefined);
    assert.ok(store.get("a2"));
  });

  it("recall returns only existing artifacts", () => {
    const store = new ArtifactStore();
    store.add({ id: "a1", type: "read_slice", summary: "s", raw: "r", source: "read", ts: "2024-01-01T00:00:00Z" });
    const recalled = store.recall(["a1", "missing"]);
    assert.strictEqual(recalled.length, 1);
    assert.strictEqual(recalled[0]!.id, "a1");
  });
});

describe("formatRecalledArtifacts", () => {
  it("returns empty string for empty array", () => {
    assert.strictEqual(formatRecalledArtifacts([]), "");
  });

  it("formats artifacts with headers", () => {
    const recalled = [
      {
        id: "a1",
        artifact: {
          id: "a1",
          type: "read_slice" as const,
          summary: "read file",
          raw: "hello",
          source: "read",
          ts: "2024-01-01T00:00:00Z",
        },
      },
    ];
    const text = formatRecalledArtifacts(recalled);
    assert.ok(text.includes("[recalled artifacts]"));
    assert.ok(text.includes("artifact:a1"));
    assert.ok(text.includes("hello"));
  });
});

describe("serializeSessionState", () => {
  it("includes task and non-empty fields only", () => {
    const s = emptySessionState("fix bug");
    s.files_touched = ["src/a.ts"];
    s.confirmed_findings = ["found issue"];
    const text = serializeSessionState(s);
    assert.ok(text.includes("task: fix bug"));
    assert.ok(text.includes("files_touched: src/a.ts"));
    assert.ok(text.includes("found issue"));
    assert.ok(!text.includes("constraints:"));
  });

  it("includes artifact index when present", () => {
    const s = emptySessionState();
    s.artifact_index["a1"] = { type: "read_slice", summary: "read x", source: "read", path: "x.ts" };
    const text = serializeSessionState(s);
    assert.ok(text.includes("artifact_index:"));
    assert.ok(text.includes("a1:"));
  });
});

describe("buildSessionStateMessage", () => {
  it("produces a system message", () => {
    const msg = buildSessionStateMessage(emptySessionState("t"));
    assert.strictEqual(msg.role, "system");
    assert.ok(typeof msg.content === "string");
    assert.ok(msg.content.includes("compiled session state"));
  });
});
