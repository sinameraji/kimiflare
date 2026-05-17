import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordUsage } from "../usage-tracker.js";
import type { SessionUsage, UsageLog } from "../usage-tracker.js";

const TMP_XDG = join(tmpdir(), `kimiflare-test-${process.pid}-${Date.now()}`);
const USAGE_JSON = join(TMP_XDG, "kimiflare", "usage.json");

function readLog(): UsageLog {
  return JSON.parse(readFileSync(USAGE_JSON, "utf8")) as UsageLog;
}

function findSession(log: UsageLog, sessionId: string): SessionUsage | undefined {
  return log.sessions.find((s) => s.id === sessionId);
}

describe("recordUsage — parentSessionId (M7.1)", () => {
  beforeEach(() => {
    if (existsSync(TMP_XDG)) rmSync(TMP_XDG, { recursive: true, force: true });
    process.env.XDG_DATA_HOME = TMP_XDG;
  });

  it("stamps parentSessionId on TurnCost and on first SessionUsage", async () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 0 },
    };

    await recordUsage("parent.sub1", usage, undefined, { parentSessionId: "parent" });
    await recordUsage("parent.sub1", usage, undefined, { parentSessionId: "parent" });

    const session = findSession(readLog(), "parent.sub1");
    assert.ok(session, "session should exist");
    assert.equal(session!.parentSessionId, "parent");
    assert.ok(session!.turns && session!.turns.length === 2);
    assert.equal(session!.turns![0]!.parentSessionId, "parent");
    assert.equal(session!.turns![1]!.parentSessionId, "parent");
  });

  it("non-subagent usage records without parentSessionId (back-compat)", async () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 0 },
    };

    await recordUsage("standalone_session", usage);

    const session = findSession(readLog(), "standalone_session");
    assert.ok(session);
    assert.equal(session!.parentSessionId, undefined);
    assert.equal(session!.turns![0]!.parentSessionId, undefined);
  });
});
