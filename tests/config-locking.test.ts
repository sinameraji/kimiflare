import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "../src/config.js";

describe("saveConfig locking", () => {
	it("serializes concurrent writes so JSON stays valid", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "kf-lock-test-"));
		Object.defineProperty(process.env, "XDG_CONFIG_HOME", {
			value: tmp,
			configurable: true,
			writable: true,
			enumerable: true,
		});
		try {
			// Seed an empty config so lockfile has something to lock
			mkdirSync(join(tmp, "kimiflare"), { recursive: true });
			writeFileSync(join(tmp, "kimiflare", "config.json"), "{}", "utf8");

			const configs = Array.from({ length: 3 }, (_, i) => ({
				accountId: `acct-${i}`,
				apiToken: `token-${i}`,
				model: "test",
			}));

			const results = await Promise.allSettled(configs.map((cfg) => saveConfig(cfg)));
			const succeeded = results.filter((r) => r.status === "fulfilled").length;
			assert.ok(succeeded >= 1, `expected at least one save to succeed, got ${succeeded}`);

			const raw = readFileSync(join(tmp, "kimiflare", "config.json"), "utf8");
			const parsed = JSON.parse(raw);
			assert.ok(parsed.accountId.startsWith("acct-"));
		} finally {
			delete (process.env as Record<string, string | undefined>).XDG_CONFIG_HOME;
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
