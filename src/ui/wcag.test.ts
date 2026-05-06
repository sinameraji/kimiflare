import { describe, it } from "node:test";
import assert from "node:assert";
import { contrastRatio, checkContrast } from "./wcag.js";

describe("contrastRatio", () => {
  it("returns null for invalid hex", () => {
    assert.strictEqual(contrastRatio("not-a-color", "#000000"), null);
    assert.strictEqual(contrastRatio("#000000", "bad"), null);
  });

  it("computes black on white as 21:1", () => {
    const ratio = contrastRatio("#000000", "#ffffff");
    assert.ok(ratio !== null);
    assert.ok(Math.abs(ratio - 21) < 0.1, `expected ~21, got ${ratio}`);
  });

  it("computes white on white as 1:1", () => {
    const ratio = contrastRatio("#ffffff", "#ffffff");
    assert.ok(ratio !== null);
    assert.ok(Math.abs(ratio - 1) < 0.01, `expected ~1, got ${ratio}`);
  });

  it("flags low contrast", () => {
    const issue = checkContrast("#777777", "#ffffff", 4.5);
    assert.ok(issue !== null);
    assert.ok(issue.ratio < 4.5);
  });

  it("passes high contrast", () => {
    const issue = checkContrast("#000000", "#ffffff", 4.5);
    assert.strictEqual(issue, null);
  });
});
