import { describe, it } from "node:test";
import assert from "node:assert";
import { searchWebTool } from "./web-search.js";
import type { ToolOutput } from "./registry.js";

describe("search_web", () => {
  it("returns results for a query", async () => {
    const originalFetch = globalThis.fetch;
    const mockHtml = `
      <div class="result results_links_deep result__web">
        <div class="links_main links_deep result__body">
          <a class="result__a" href="https://example.com/page1">First Result</a>
          <a class="result__snippet">This is the first result snippet.</a>
        </div>
      </div>
      <div class="result results_links_deep result__web">
        <div class="links_main links_deep result__body">
          <a class="result__a" href="https://example.com/page2">Second Result</a>
          <a class="result__snippet">This is the second result snippet.</a>
        </div>
      </div>
    `;

    globalThis.fetch = async () =>
      new Response(mockHtml, { status: 200, headers: { "Content-Type": "text/html" } });

    try {
      const result = (await searchWebTool.run({ query: "test query", count: 2 }, { cwd: "/tmp" })) as ToolOutput;
      assert.ok(result.content.includes("First Result"));
      assert.ok(result.content.includes("https://example.com/page1"));
      assert.ok(result.content.includes("Second Result"));
      assert.ok(result.content.includes("https://example.com/page2"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles no results gracefully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("<html><body>No results</body></html>", { status: 200 });

    try {
      const result = (await searchWebTool.run({ query: "xyznonexistent" }, { cwd: "/tmp" })) as ToolOutput;
      assert.ok(result.content.includes("No results found"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles HTTP errors gracefully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("Error", { status: 503 });

    try {
      const result = (await searchWebTool.run({ query: "test" }, { cwd: "/tmp" })) as ToolOutput;
      assert.ok(result.content.includes("Error"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
