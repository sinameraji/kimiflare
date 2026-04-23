import { describe, it } from "node:test";
import assert from "node:assert";
import { stableStringify } from "./messages.js";

describe("stableStringify", () => {
  it("produces identical strings for objects with different key insertion orders", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    assert.strictEqual(stableStringify(a), stableStringify(b));
  });

  it("handles nested objects", () => {
    const a = { outer: { z: 1, a: 2 } };
    const b = { outer: { a: 2, z: 1 } };
    assert.strictEqual(stableStringify(a), stableStringify(b));
  });

  it("handles arrays consistently", () => {
    const a = [{ z: 1 }, { a: 2 }];
    const b = [{ z: 1 }, { a: 2 }];
    assert.strictEqual(stableStringify(a), stableStringify(b));
  });

  it("differs when values differ", () => {
    const a = { x: 1 };
    const b = { x: 2 };
    assert.notStrictEqual(stableStringify(a), stableStringify(b));
  });

  it("works with a replacer", () => {
    const obj = { a: "hello", b: 42 };
    const result = stableStringify(obj, (_k, v) => (typeof v === "string" ? v.toUpperCase() : v));
    assert.ok(result.includes("HELLO"));
  });

  it("works with indentation", () => {
    const obj = { a: 1 };
    const result = stableStringify(obj, undefined, 2);
    assert.ok(result.includes("\n"));
  });
});
