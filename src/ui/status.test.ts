import { describe, it } from "node:test";
import assert from "node:assert";
import { buildRightParts, formatGatewayCacheStatus } from "./status.js";

describe("status gateway cache formatting", () => {
  it("shows gateway cache status separately from token cache", () => {
    const parts = buildRightParts(
      {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 50 },
      },
      1_000,
      null,
      { cacheStatus: "hit" },
    );

    assert.deepStrictEqual(parts, [
      "in 100 (50 cached)",
      "out 20",
      "ctx 10%",
      "$0.00014",
      "AI Gateway · cache hit",
    ]);
  });

  it("omits gateway cache status when Cloudflare does not return it", () => {
    assert.strictEqual(formatGatewayCacheStatus({ logId: "log_123" }), null);
  });
});
