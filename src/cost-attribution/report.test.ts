import { describe, it } from "node:test";
import assert from "node:assert";
import { buildReport } from "./report.js";
import type { SessionUsage } from "../usage-tracker.js";

describe("buildReport", () => {
  const makeSession = (overrides: Partial<SessionUsage> = {}): SessionUsage => ({
    id: "s1",
    date: "2026-04-28",
    promptTokens: 100,
    completionTokens: 50,
    cachedTokens: 0,
    cost: 1.0,
    ...overrides,
  });

  it("aggregates sessions by category", () => {
    const report = buildReport({
      startDate: "2026-04-28",
      endDate: "2026-04-28",
      sessions: [
        makeSession({ id: "s1", category: "editing-source-code", cost: 5 }),
        makeSession({ id: "s2", category: "editing-source-code", cost: 3 }),
        makeSession({ id: "s3", category: "running-tests", cost: 2 }),
      ],
    });

    assert.strictEqual(report.categories.length, 2);
    const editing = report.categories.find((c) => c.category === "editing-source-code");
    assert.ok(editing);
    assert.strictEqual(editing!.thisPeriod.cost, 8);
    assert.strictEqual(editing!.thisPeriod.sessions, 2);
    const testing = report.categories.find((c) => c.category === "running-tests");
    assert.ok(testing);
    assert.strictEqual(testing!.thisPeriod.cost, 2);
  });

  it("computes week-over-week change", () => {
    const report = buildReport({
      startDate: "2026-04-28",
      endDate: "2026-04-28",
      sessions: [makeSession({ category: "editing-source-code", cost: 10 })],
      previousSessions: [makeSession({ category: "editing-source-code", cost: 8 })],
    });

    const editing = report.categories.find((c) => c.category === "editing-source-code");
    assert.ok(editing);
    assert.strictEqual(editing!.changePct, 25);
  });

  it("filters by category", () => {
    const report = buildReport({
      startDate: "2026-04-28",
      endDate: "2026-04-28",
      sessions: [
        makeSession({ category: "editing-source-code", cost: 5 }),
        makeSession({ category: "running-tests", cost: 2 }),
      ],
      categoryFilter: "editing-source-code",
    });

    assert.strictEqual(report.categories.length, 1);
    assert.strictEqual(report.categories[0]!.category, "editing-source-code");
  });

  it("includes top sessions", () => {
    const report = buildReport({
      startDate: "2026-04-28",
      endDate: "2026-04-28",
      sessions: [
        makeSession({ id: "s1", category: "editing-source-code", cost: 5, summary: "fix bug" }),
        makeSession({ id: "s2", category: "running-tests", cost: 2 }),
      ],
    });

    assert.strictEqual(report.topSessions.length, 2);
    assert.strictEqual(report.topSessions[0]!.sessionId, "s1");
    assert.strictEqual(report.topSessions[0]!.summary, "fix bug");
  });

  it("omits empty categories", () => {
    const report = buildReport({
      startDate: "2026-04-28",
      endDate: "2026-04-28",
      sessions: [makeSession({ category: "other", cost: 1 })],
    });

    const hasEmpty = report.categories.some((c) => c.thisPeriod.sessions === 0 && c.lastPeriod.sessions === 0);
    assert.strictEqual(hasEmpty, false);
  });
});
