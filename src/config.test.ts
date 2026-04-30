import { describe, it } from "node:test";
import assert from "node:assert";
import { validateModelId } from "./agent/client.js";

describe("validateModelId", () => {
  it("accepts valid Cloudflare model IDs", () => {
    assert.doesNotThrow(() => validateModelId("@cf/moonshotai/kimi-k2.6"));
    assert.doesNotThrow(() => validateModelId("@cf/meta/llama-4-scout-17b-16e-instruct"));
    assert.doesNotThrow(() => validateModelId("@cf/baai/bge-base-en-v1.5"));
  });

  it("rejects invalid model IDs", () => {
    assert.throws(() => validateModelId("bogus"));
    assert.throws(() => validateModelId("cf/model"));
    assert.throws(() => validateModelId(""));
  });
});
