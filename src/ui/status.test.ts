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
      "ctx 10%",
      "$0.00",
      "AI Gateway · cache hit",
    ]);
  });

  it("omits gateway cache status when Cloudflare does not return it", () => {
    assert.strictEqual(formatGatewayCacheStatus({ logId: "log_123" }), null);
  });

  it("suppresses MISS so users without caching don't see a constant 'cache miss'", () => {
    // Cloudflare returns cf-aig-cache-status: MISS on every uncached request,
    // including when caching isn't configured. Surfacing it would read as a
    // failure indicator on every turn.
    assert.strictEqual(formatGatewayCacheStatus({ cacheStatus: "MISS" }), null);
    assert.strictEqual(formatGatewayCacheStatus({ cacheStatus: "miss" }), null);
  });

  it("still surfaces non-miss cache statuses (hit, revalidated, bypass)", () => {
    assert.strictEqual(
      formatGatewayCacheStatus({ cacheStatus: "HIT" }),
      "AI Gateway · cache hit",
    );
    assert.strictEqual(
      formatGatewayCacheStatus({ cacheStatus: "REVALIDATED" }),
      "AI Gateway · cache revalidated",
    );
  });
});
