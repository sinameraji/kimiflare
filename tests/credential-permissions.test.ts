import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "../src/config.js";

describe("saveConfig permissions", () => {
	it("writes config with 0o600 and parent dir with 0o700", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "kf-cred-test-"));
		Object.defineProperty(process.env, "XDG_CONFIG_HOME", {
			value: tmp,
			configurable: true,
			writable: true,
		});
		try {
			await saveConfig({
				accountId: "test",
				apiToken: "test",
				model: "test",
			});

			const dirStat = statSync(join(tmp, "kimiflare"));
			const fileStat = statSync(join(tmp, "kimiflare", "config.json"));

			assert.strictEqual(
				dirStat.mode & 0o777,
				0o700,
				`expected dir mode 0o700, got 0o${(dirStat.mode & 0o777).toString(8)}`,
			);
			assert.strictEqual(
				fileStat.mode & 0o777,
				0o600,
				`expected file mode 0o600, got 0o${(fileStat.mode & 0o777).toString(8)}`,
			);
		} finally {
			delete (process.env as Record<string, string | undefined>).XDG_CONFIG_HOME;
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
