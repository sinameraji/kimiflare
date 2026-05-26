import { describe, it } from "node:test";
import assert from "node:assert";
import { validateModelId } from "./agent/client.js";
import { getModelOrInfer, inferProvider } from "./models/registry.js";

describe("validateModelId", () => {
  it("accepts valid Cloudflare Workers AI model IDs", () => {
    assert.doesNotThrow(() => validateModelId("@cf/moonshotai/kimi-k2.6"));
    assert.doesNotThrow(() => validateModelId("@cf/meta/llama-4-scout-17b-16e-instruct"));
    assert.doesNotThrow(() => validateModelId("@cf/baai/bge-base-en-v1.5"));
  });

  it("accepts provider-prefixed model IDs for Gateway Universal Endpoint", () => {
    assert.doesNotThrow(() => validateModelId("anthropic/claude-sonnet-4-6"));
    assert.doesNotThrow(() => validateModelId("openai/gpt-5"));
    assert.doesNotThrow(() => validateModelId("google-ai-studio/gemini-2.5-pro"));
    assert.doesNotThrow(() => validateModelId("groq/llama-3.3-70b-versatile"));
  });

  it("rejects malformed model IDs", () => {
    assert.throws(() => validateModelId("bogus"));
    assert.throws(() => validateModelId(""));
    assert.throws(() => validateModelId("anthropic//"));
    assert.throws(() => validateModelId("has spaces/in-it"));
    assert.throws(() => validateModelId("../etc/passwd"));
  });
});

describe("model registry", () => {
  it("infers provider from id prefix", () => {
    assert.equal(inferProvider("@cf/moonshotai/kimi-k2.6"), "workers-ai");
    assert.equal(inferProvider("anthropic/claude-sonnet-4-6"), "anthropic");
    assert.equal(inferProvider("openai/gpt-5"), "openai");
    assert.equal(inferProvider("google-ai-studio/gemini-2.5-pro"), "google");
    assert.equal(inferProvider("unknown/whatever"), "openai-compatible");
  });

  it("returns a known entry for seeded models", () => {
    const m = getModelOrInfer("@cf/moonshotai/kimi-k2.6");
    assert.equal(m.provider, "workers-ai");
    assert.equal(m.contextWindow, 262_144);
    assert.equal(m.pricing.inputPerMtok, 0.95);
  });

  it("infers a conservative entry for unknown models", () => {
    const m = getModelOrInfer("anthropic/claude-future-model");
    assert.equal(m.provider, "anthropic");
    assert.equal(m.billingMode, "byok");
    assert.equal(m.pricing.inputPerMtok, 0); // zero rather than wrong
  });
});
