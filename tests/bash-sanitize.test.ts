import { describe, it } from "node:test";
import assert from "node:assert";
import { stripAnsi, sanitizeBinaryOutput, sanitizeOutput } from "../src/ui/sanitize-output.js";

describe("sanitizeOutput", () => {
	it("stripAnsi removes color codes", () => {
		assert.strictEqual(stripAnsi("\u001b[31mred\u001b[0m"), "red");
		assert.strictEqual(stripAnsi("\u001b[1;32mbold green\u001b[22m"), "bold green");
	});

	it("sanitizeBinaryOutput removes control chars", () => {
		assert.strictEqual(sanitizeBinaryOutput("hello\x00world\x07"), "helloworld");
		assert.strictEqual(sanitizeBinaryOutput("line1\nline2\t"), "line1\nline2\t");
	});

	it("sanitizeOutput does both", () => {
		const raw = "\u001b[31mhello\x07\u001b[0m";
		assert.strictEqual(sanitizeOutput(raw), "hello");
	});

	it("passes clean text untouched", () => {
		assert.strictEqual(sanitizeOutput("plain text"), "plain text");
	});
});
