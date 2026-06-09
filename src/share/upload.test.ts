import { describe, it } from "node:test";
import assert from "node:assert";
import { uploadSession } from "./upload.js";

describe("uploadSession", () => {
  it("throws on non-ok response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("bad request", { status: 400 }) as unknown as Response;

    try {
      await assert.rejects(
        uploadSession("https://example.com", "secret", "{}"),
        /Share upload failed \(400\)/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns id and url on success", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ id: "abc123", url: "https://example.com/s/abc123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as unknown as Response;

    try {
      const result = await uploadSession("https://example.com", "secret", "{}");
      assert.strictEqual(result.id, "abc123");
      assert.strictEqual(result.url, "https://example.com/s/abc123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
