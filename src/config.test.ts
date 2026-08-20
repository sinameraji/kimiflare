import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateModelId } from "./agent/client.js";
import { getModelOrInfer, inferProvider } from "./models/registry.js";
import { loadConfig } from "./config.js";

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

describe("loadConfig: custom OpenAI-compatible endpoint", () => {
  // loadConfig reads env + the config file; isolate both so a developer's
  // real ~/.config/kimiflare/config.json can't leak into assertions.
  const ENV_KEYS = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CF_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CF_API_TOKEN",
    "KIMI_MODEL",
    "KIMIFLARE_CLOUD",
    "KIMIFLARE_BASE_URL",
    "KIMIFLARE_API_KEY",
    "XDG_CONFIG_HOME",
  ] as const;
  const saved: Record<string, string | undefined> = {};
  let configHome: string;

  before(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    configHome = await mkdtemp(join(tmpdir(), "kimiflare-config-test-"));
    process.env.XDG_CONFIG_HOME = configHome;
  });

  after(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(configHome, { recursive: true, force: true });
  });

  async function writeConfigFile(contents: Record<string, unknown>): Promise<void> {
    const dir = join(configHome, "kimiflare");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.json"), JSON.stringify(contents), "utf8");
  }

  async function removeConfigFile(): Promise<void> {
    await rm(join(configHome, "kimiflare", "config.json"), { force: true });
  }

  it("resolves with ONLY KIMIFLARE_BASE_URL + KIMIFLARE_API_KEY set (no Cloudflare credentials anywhere)", async () => {
    await removeConfigFile();
    process.env.KIMIFLARE_BASE_URL = "https://aig.example.com/v1";
    process.env.KIMIFLARE_API_KEY = "broker-key";
    try {
      const cfg = await loadConfig();
      assert.ok(cfg, "expected a usable config without Cloudflare credentials");
      assert.strictEqual(cfg!.baseUrl, "https://aig.example.com/v1");
      assert.strictEqual(cfg!.apiKey, "broker-key");
      assert.strictEqual(cfg!.accountId, "");
      assert.strictEqual(cfg!.apiToken, "");
    } finally {
      delete process.env.KIMIFLARE_BASE_URL;
      delete process.env.KIMIFLARE_API_KEY;
    }
  });

  it("still returns null with no credentials and no custom endpoint", async () => {
    await removeConfigFile();
    assert.strictEqual(await loadConfig(), null);
  });

  it("resolves a persisted baseUrl/apiKey without Cloudflare credentials", async () => {
    await writeConfigFile({ baseUrl: "https://cfg.example.com/v1", apiKey: "cfg-key", model: "my-alias" });
    const cfg = await loadConfig();
    assert.ok(cfg);
    assert.strictEqual(cfg!.baseUrl, "https://cfg.example.com/v1");
    assert.strictEqual(cfg!.apiKey, "cfg-key");
    assert.strictEqual(cfg!.model, "my-alias");
  });

  it("env vars win over persisted baseUrl/apiKey", async () => {
    await writeConfigFile({ baseUrl: "https://cfg.example.com/v1", apiKey: "cfg-key" });
    process.env.KIMIFLARE_BASE_URL = "https://env.example.com/v1";
    process.env.KIMIFLARE_API_KEY = "env-key";
    try {
      const cfg = await loadConfig();
      assert.ok(cfg);
      assert.strictEqual(cfg!.baseUrl, "https://env.example.com/v1");
      assert.strictEqual(cfg!.apiKey, "env-key");
    } finally {
      delete process.env.KIMIFLARE_BASE_URL;
      delete process.env.KIMIFLARE_API_KEY;
    }
  });

  it("carries baseUrl/apiKey alongside env Cloudflare credentials (custom endpoint wins at request time)", async () => {
    await removeConfigFile();
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_API_TOKEN = "cf-token";
    process.env.KIMIFLARE_BASE_URL = "https://aig.example.com/v1";
    process.env.KIMIFLARE_API_KEY = "broker-key";
    try {
      const cfg = await loadConfig();
      assert.ok(cfg);
      assert.strictEqual(cfg!.accountId, "acct");
      assert.strictEqual(cfg!.apiToken, "cf-token");
      assert.strictEqual(cfg!.baseUrl, "https://aig.example.com/v1");
      assert.strictEqual(cfg!.apiKey, "broker-key");
    } finally {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.KIMIFLARE_BASE_URL;
      delete process.env.KIMIFLARE_API_KEY;
    }
  });

  it("carries baseUrl/apiKey alongside persisted Cloudflare credentials", async () => {
    await writeConfigFile({
      accountId: "acct",
      apiToken: "cf-token",
      baseUrl: "https://cfg.example.com/v1",
      apiKey: "cfg-key",
    });
    const cfg = await loadConfig();
    assert.ok(cfg);
    assert.strictEqual(cfg!.accountId, "acct");
    assert.strictEqual(cfg!.baseUrl, "https://cfg.example.com/v1");
    assert.strictEqual(cfg!.apiKey, "cfg-key");
  });
});
