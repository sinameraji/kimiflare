import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  recordTurnHealth,
  consumePendingHealthHint,
  _resetHealthForTests,
} from "./health.js";

describe("session health (M7.1 Tier 1)", () => {
  beforeEach(() => _resetHealthForTests());

  it("first turn with no baseline is `healthy` and emits no hint", () => {
    const h = recordTurnHealth({
      sessionId: "s",
      tier: "light",
      durationMs: 3000,
      promptTokens: 5000,
      cacheHitRatio: 0.9,
    });
    assert.equal(h.diagnosis, "healthy");
    assert.equal(h.hint, null);
    assert.equal(consumePendingHealthHint("s"), null);
  });

  it("detects context_bloat when prompt is large AND duration is 3x baseline", () => {
    // Seed baseline with 5 turns at ~5s each, then push a 30s turn at 150k tokens.
    for (let i = 0; i < 5; i++) {
      recordTurnHealth({
        sessionId: "s",
        tier: "heavy",
        durationMs: 5000,
        promptTokens: 30_000,
        cacheHitRatio: 0.9,
      });
    }
    const bloat = recordTurnHealth({
      sessionId: "s",
      tier: "heavy",
      durationMs: 30_000,
      promptTokens: 150_000,
      cacheHitRatio: 0.85,
    });
    assert.equal(bloat.diagnosis, "context_bloat");
    assert.ok(bloat.hint);
    assert.match(bloat.hint!, /context|tokens|slower/i);
    assert.equal(consumePendingHealthHint("s"), bloat.hint);
    // Single-shot: second consume returns null.
    assert.equal(consumePendingHealthHint("s"), null);
  });

  it("detects cache_collapse when prior cache was high and current dropped sharply", () => {
    // Warm-up turn: high cache ratio.
    recordTurnHealth({
      sessionId: "s",
      tier: "medium",
      durationMs: 5000,
      promptTokens: 20_000,
      cacheHitRatio: 0.9,
    });
    // Next turn: cache collapsed.
    const collapse = recordTurnHealth({
      sessionId: "s",
      tier: "medium",
      durationMs: 12_000,
      promptTokens: 25_000,
      cacheHitRatio: 0.2,
    });
    assert.equal(collapse.diagnosis, "cache_collapse");
    assert.ok(collapse.hint);
    assert.match(collapse.hint!, /cache/i);
  });

  it("partitions baselines per session", () => {
    for (let i = 0; i < 5; i++) {
      recordTurnHealth({
        sessionId: "a",
        tier: "light",
        durationMs: 1000,
        promptTokens: 5000,
        cacheHitRatio: 0.9,
      });
    }
    // Session b has its own (empty) baseline → falls back to tier default.
    const b = recordTurnHealth({
      sessionId: "b",
      tier: "light",
      durationMs: 2000,
      promptTokens: 5000,
      cacheHitRatio: 0.9,
    });
    // Should be healthy because 2000ms is below the 3x default-3000ms threshold.
    assert.equal(b.diagnosis, "healthy");
  });

  it("never auto-shedding: heavy-tier slowdowns still surface as `context_bloat` (the user/model gets to decide)", () => {
    for (let i = 0; i < 5; i++) {
      recordTurnHealth({
        sessionId: "s",
        tier: "heavy",
        durationMs: 10_000,
        promptTokens: 60_000,
        cacheHitRatio: 0.9,
      });
    }
    const heavyBloat = recordTurnHealth({
      sessionId: "s",
      tier: "heavy",
      durationMs: 60_000,
      promptTokens: 180_000,
      cacheHitRatio: 0.85,
    });
    assert.equal(heavyBloat.diagnosis, "context_bloat");
    // We surface it but don't take destructive action — the hint is
    // advisory only; loop.ts never drops history without consent.
    assert.ok(heavyBloat.hint);
  });
});
