import { describe, it } from "node:test";
import assert from "node:assert";
import { fuzzyMatch, fuzzyFilter } from "./fuzzy.js";

describe("fuzzyMatch", () => {
  it("matches empty query with score 0", () => {
    assert.deepStrictEqual(fuzzyMatch("", "anything"), { matches: true, score: 0 });
  });

  it("rejects when query longer than text", () => {
    assert.strictEqual(fuzzyMatch("abcdef", "abc").matches, false);
  });

  it("matches when chars appear in order", () => {
    assert.strictEqual(fuzzyMatch("mdl", "model").matches, true);
  });

  it("rejects when chars are out of order", () => {
    assert.strictEqual(fuzzyMatch("ldm", "model").matches, false);
  });

  it("scores exact prefix better than gappy match", () => {
    const exact = fuzzyMatch("mod", "model");
    const gappy = fuzzyMatch("mod", "memory off direct");
    assert.ok(exact.matches && gappy.matches);
    assert.ok(exact.score < gappy.score, `exact(${exact.score}) should beat gappy(${gappy.score})`);
  });

  it("rewards word-boundary matches", () => {
    const boundary = fuzzyMatch("c", "cost");
    const mid = fuzzyMatch("o", "cost");
    assert.ok(boundary.score < mid.score);
  });

  it("is case-insensitive", () => {
    assert.strictEqual(fuzzyMatch("MoD", "model").matches, true);
  });

  // Letters and digits are not swapped to match — keep matching simple.
  it("does NOT swap letters/digits to match", () => {
    assert.strictEqual(fuzzyMatch("2k", "k2").matches, false);
  });
});

describe("fuzzyFilter", () => {
  const items = ["model", "mode", "memory", "help", "compact"];
  const id = (s: string) => s;

  it("returns all items unchanged for empty query", () => {
    assert.deepStrictEqual(fuzzyFilter(items, "", id), items);
    assert.deepStrictEqual(fuzzyFilter(items, "   ", id), items);
  });

  it("filters out non-matching items", () => {
    const out = fuzzyFilter(items, "mod", id);
    assert.ok(out.includes("model"));
    assert.ok(out.includes("mode"));
    assert.ok(!out.includes("help"));
  });

  it("ranks tighter matches above gappier ones", () => {
    const out = fuzzyFilter(items, "mo", id);
    // model/mode (consecutive at boundary) should both rank above memory (gap)
    const idxModel = out.indexOf("model");
    const idxMode = out.indexOf("mode");
    const idxMemory = out.indexOf("memory");
    assert.ok(idxModel < idxMemory);
    assert.ok(idxMode < idxMemory);
  });

  it("requires all space-separated tokens to match", () => {
    const out = fuzzyFilter(items, "mo ry", id);
    assert.deepStrictEqual(out, ["memory"]);
  });
});
