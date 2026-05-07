import { describe, it } from "node:test";
import assert from "node:assert";
import { browserFetchTool } from "./browser.js";
import type { ToolOutput } from "./registry.js";

describe("browser_fetch", () => {
  it("gracefully reports when Playwright is not installed", async () => {
    // Playwright is not installed in the test environment, so this should
    // return a helpful error message.
    const result = (await browserFetchTool.run({ url: "https://example.com" }, { cwd: "/tmp" })) as ToolOutput;
    assert.ok(result.content.includes("Playwright is not installed"));
    assert.ok(result.content.includes("npm install"));
  });
});
