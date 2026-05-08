import { describe, it } from "node:test";
import assert from "node:assert";
import { safeSave } from "../src/config-utils.js";
import type { ChatEvent } from "../src/ui/chat.js";

describe("safeSave", () => {
	it("surfaces rejection as error event and logs to stderr", async () => {
		const events: ChatEvent[] = [];
		const originalConsoleError = console.error;
		const logged: string[] = [];
		console.error = (...args: unknown[]) => logged.push(args.join(" "));

		const rejected = Promise.reject(new Error("EACCES"));
		safeSave("saveConfig", rejected, (e) => events.push(e));

		// Wait a tick for the microtask to complete
		await new Promise((resolve) => setTimeout(resolve, 10));

		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].kind, "error");
		assert.ok((events[0] as Extract<ChatEvent, { kind: "error" }>).text.includes("EACCES"));
		assert.ok(logged.some((l) => l.includes("EACCES")));

		console.error = originalConsoleError;
	});

	it("does not push event on success", async () => {
		const events: ChatEvent[] = [];
		const resolved = Promise.resolve();
		safeSave("saveConfig", resolved, (e) => events.push(e));

		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.strictEqual(events.length, 0);
	});
});
