import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert";
import { resolveCustomEndpoint, customChatCompletionsUrl } from "./custom-endpoint.js";

const ENV_KEYS = ["KIMIFLARE_BASE_URL", "KIMIFLARE_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe("resolveCustomEndpoint", () => {
  beforeEach(clearEnv);
  after(restoreEnv);

  it("returns null when neither env nor config carries a base URL", () => {
    assert.strictEqual(resolveCustomEndpoint(), null);
    assert.strictEqual(resolveCustomEndpoint({}), null);
    assert.strictEqual(resolveCustomEndpoint(null), null);
  });

  it("an API key alone does not activate custom routing", () => {
    process.env.KIMIFLARE_API_KEY = "sk-broker";
    assert.strictEqual(resolveCustomEndpoint(), null);
    assert.strictEqual(resolveCustomEndpoint({ apiKey: "sk-config" }), null);
  });

  it("resolves from env vars", () => {
    process.env.KIMIFLARE_BASE_URL = "https://aig.example.com/v1";
    process.env.KIMIFLARE_API_KEY = "sk-broker";
    assert.deepStrictEqual(resolveCustomEndpoint(), {
      baseUrl: "https://aig.example.com/v1",
      apiKey: "sk-broker",
    });
  });

  it("resolves from config fields when env is unset", () => {
    assert.deepStrictEqual(
      resolveCustomEndpoint({ baseUrl: "https://cfg.example.com/v1", apiKey: "sk-config" }),
      { baseUrl: "https://cfg.example.com/v1", apiKey: "sk-config" },
    );
  });

  it("env wins over config, field by field", () => {
    process.env.KIMIFLARE_BASE_URL = "https://env.example.com/v1";
    process.env.KIMIFLARE_API_KEY = "sk-env";
    assert.deepStrictEqual(
      resolveCustomEndpoint({ baseUrl: "https://cfg.example.com/v1", apiKey: "sk-config" }),
      { baseUrl: "https://env.example.com/v1", apiKey: "sk-env" },
    );
    // Mixed: base URL from env, key from config.
    delete process.env.KIMIFLARE_API_KEY;
    assert.deepStrictEqual(
      resolveCustomEndpoint({ apiKey: "sk-config" }),
      { baseUrl: "https://env.example.com/v1", apiKey: "sk-config" },
    );
  });

  it("treats blank values as unset", () => {
    process.env.KIMIFLARE_BASE_URL = "   ";
    assert.strictEqual(resolveCustomEndpoint(), null);
    process.env.KIMIFLARE_BASE_URL = "https://aig.example.com/v1";
    process.env.KIMIFLARE_API_KEY = "";
    assert.deepStrictEqual(resolveCustomEndpoint(), { baseUrl: "https://aig.example.com/v1" });
  });
});

describe("customChatCompletionsUrl", () => {
  it("appends /chat/completions to a bare base", () => {
    assert.strictEqual(
      customChatCompletionsUrl("https://aig.example.com/v1"),
      "https://aig.example.com/v1/chat/completions",
    );
  });

  it("trims trailing slashes before appending", () => {
    assert.strictEqual(
      customChatCompletionsUrl("https://aig.example.com/v1///"),
      "https://aig.example.com/v1/chat/completions",
    );
  });

  it("leaves a base that already ends in /chat/completions alone", () => {
    assert.strictEqual(
      customChatCompletionsUrl("https://aig.example.com/v1/chat/completions"),
      "https://aig.example.com/v1/chat/completions",
    );
    assert.strictEqual(
      customChatCompletionsUrl("https://aig.example.com/v1/chat/completions/"),
      "https://aig.example.com/v1/chat/completions",
    );
  });
});
