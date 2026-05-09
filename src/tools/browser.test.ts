// @rust-exception rationale: Test for JS/TS browser fetch tool — validates platform-native HTTP fetching behavior.
import { describe, it } from "node:test";
import assert from "node:assert";
import { browserFetchTool } from "./browser.js";
import type { ToolOutput } from "./registry.js";

describe("browser_fetch", () => {
  it("handles missing or broken Playwright gracefully", async () => {
    // In this test environment, Playwright the npm package may be present as a
    // devDependency, but browser binaries are not installed. The tool catches
    // the dynamic import failure (package not installed) but lets
    // chromium.launch() errors propagate (binaries missing). Neither path
    // should silently swallow the problem — the user must see a clear signal.
    try {
      const result = (await browserFetchTool.run(
        { url: "https://example.com" },
        { cwd: "/tmp" },
      )) as ToolOutput;
      // If we reach here, the import failed and the tool returned gracefully.
      assert.ok(
        result.content.includes("Playwright is not installed"),
        "Expected graceful 'Playwright is not installed' message",
      );
    } catch (err) {
      // Import succeeded but chromium.launch() failed (missing binaries).
      // Assert the error message is user-actionable.
      const msg = err instanceof Error ? err.message : String(err);
      assert.ok(
        msg.includes("Executable doesn't exist") ||
          msg.includes("npx playwright install"),
        `Expected actionable Playwright error, got: ${msg.slice(0, 200)}`,
      );
    }
  });
});
