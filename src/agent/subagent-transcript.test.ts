import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolExecutor } from "../tools/executor.js";

describe("ToolExecutor.storeArtifact (M7.1 subagent transcript home)", () => {
  it("returns a stable artifact ID that expand_artifact can retrieve", async () => {
    const exec = new ToolExecutor([]);
    const id = exec.storeArtifact("the full child transcript blob");
    assert.match(id, /^art_\d+$/);

    // expand_artifact is auto-registered on the executor — invoke it
    // through .run() to confirm the round-trip works.
    const expand = exec.list().find((t) => t.name === "expand_artifact")!;
    assert.ok(expand, "expand_artifact must be present on every executor");

    const result = await exec.run(
      { id: "tc1", name: "expand_artifact", arguments: JSON.stringify({ artifact_id: id }) },
      async () => ({ decision: "allow", scope: "once" }),
      { cwd: "/tmp" },
    );
    assert.equal(result.ok, true);
    assert.match(result.content, /the full child transcript blob/);
  });

  it("returns distinct IDs for successive stores", () => {
    const exec = new ToolExecutor([]);
    const a = exec.storeArtifact("first");
    const b = exec.storeArtifact("second");
    assert.notEqual(a, b);
  });
});
