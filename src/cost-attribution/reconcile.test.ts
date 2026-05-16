import { describe, it } from "node:test";
import assert from "node:assert";
import { aggregateByFeature } from "./reconcile.js";

describe("aggregateByFeature", () => {
  it("groups logs by metadata.feature and sums cost", () => {
    const out = aggregateByFeature([
      { cost: 0.01, metadata: { feature: "chat" } },
      { cost: 0.02, metadata: { feature: "chat" } },
      { cost: 0.005, metadata: { feature: "embedding" } },
      { cost: 0.001, metadata: null },
    ]);
    const chat = out.find((e) => e.feature === "chat");
    const embedding = out.find((e) => e.feature === "embedding");
    const unknown = out.find((e) => e.feature === "unknown");
    assert.ok(chat);
    assert.strictEqual(chat!.cost, 0.03);
    assert.strictEqual(chat!.requests, 2);
    assert.ok(embedding);
    assert.strictEqual(embedding!.requests, 1);
    assert.ok(unknown);
    assert.strictEqual(unknown!.requests, 1);
  });

  it("parses metadata when stored as a JSON string", () => {
    const out = aggregateByFeature([
      { cost: 0.05, metadata: JSON.stringify({ feature: "tool" }) },
    ]);
    assert.strictEqual(out[0]!.feature, "tool");
  });
});
