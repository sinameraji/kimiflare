import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSdkConfig } from "./config.js";

describe("resolveSdkConfig: custom endpoint credentials", () => {
  // Isolate env + config file so a developer's real Cloudflare login can't
  // satisfy the credential check for us.
  const ENV_KEYS = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CF_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CF_API_TOKEN",
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
    configHome = await mkdtemp(join(tmpdir(), "kimiflare-sdk-config-test-"));
    process.env.XDG_CONFIG_HOME = configHome;
  });

  after(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(configHome, { recursive: true, force: true });
  });

  it("throws without Cloudflare credentials and without a custom endpoint", async () => {
    await assert.rejects(() => resolveSdkConfig({}), /missing credentials/);
  });

  it("accepts a custom endpoint passed via config instead of Cloudflare credentials", async () => {
    const cfg = await resolveSdkConfig({
      config: { baseUrl: "https://aig.example.com/v1", apiKey: "broker-key" },
    });
    assert.strictEqual(cfg.baseUrl, "https://aig.example.com/v1");
    assert.strictEqual(cfg.apiKey, "broker-key");
    assert.strictEqual(cfg.accountId, "");
    assert.strictEqual(cfg.apiToken, "");
  });

  it("accepts KIMIFLARE_BASE_URL + KIMIFLARE_API_KEY from the environment alone", async () => {
    process.env.KIMIFLARE_BASE_URL = "https://env.example.com/v1";
    process.env.KIMIFLARE_API_KEY = "env-key";
    try {
      const cfg = await resolveSdkConfig({});
      assert.strictEqual(cfg.baseUrl, "https://env.example.com/v1");
      assert.strictEqual(cfg.apiKey, "env-key");
    } finally {
      delete process.env.KIMIFLARE_BASE_URL;
      delete process.env.KIMIFLARE_API_KEY;
    }
  });
});
