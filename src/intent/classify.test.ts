import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyIntent } from "./classify.js";

describe("classifyIntent", () => {
  it("classifies a keyword-free prompt as light", () => {
    const r = classifyIntent("make the app faster");
    assert.strictEqual(r.tier, "light");
  });

  it("classifies an empty prompt as light", () => {
    const r = classifyIntent("");
    assert.strictEqual(r.tier, "light");
  });

  it("classifies a large multi-topic feature request as heavy", () => {
    const r = classifyIntent(
      "Implement an OAuth2 auth module, add a testing strategy, and migrate the existing auth service",
    );
    assert.strictEqual(r.tier, "heavy");
  });

  it("returns a well-formed IntentResult", () => {
    const r = classifyIntent("refactor the parser");
    assert.ok(typeof r.intent === "string");
    assert.ok(r.rawScore >= 0 && r.rawScore <= 1);
    assert.ok(["light", "medium", "heavy"].includes(r.tier));
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  });

  it("scores a mutating multi-file edit higher than a plain question", () => {
    const edit = classifyIntent("add a new field and update auth.ts and session.ts and config.ts");
    const question = classifyIntent("what does this function do?");
    assert.ok(edit.rawScore > question.rawScore);
  });
});
