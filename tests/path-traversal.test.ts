import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSafePath } from "../src/path-utils.js";

describe("resolveSafePath", () => {
	const cwd = mkdtempSync(join(tmpdir(), "kf-traversal-"));

	it("allows paths inside cwd", () => {
		assert.strictEqual(resolveSafePath("./src/app.tsx", cwd), join(cwd, "src/app.tsx"));
		assert.strictEqual(resolveSafePath("src/app.tsx", cwd), join(cwd, "src/app.tsx"));
	});

	it("blocks traversal via ..", () => {
		assert.throws(() => resolveSafePath("../outside.txt", cwd), /Path traversal blocked/);
	});

	it("blocks absolute paths outside cwd", () => {
		assert.throws(() => resolveSafePath("/etc/passwd", cwd), /Path traversal blocked/);
	});

	it("blocks deeply nested traversal", () => {
		assert.throws(() => resolveSafePath("src/../../../etc/passwd", cwd), /Path traversal blocked/);
	});

	it("allows the cwd itself", () => {
		assert.strictEqual(resolveSafePath(".", cwd), cwd);
	});

	it("blocks symlinks that escape cwd", () => {
		const link = join(cwd, "evil-link");
		symlinkSync("/etc", link);
		assert.throws(() => resolveSafePath("evil-link/passwd", cwd), /Path traversal blocked/);
		rmSync(link);
	});
});
