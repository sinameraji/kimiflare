import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setLogDirForTesting,
  setLogSinkEnabled,
  setLogSessionId,
  setLogTurnId,
  logPathFor,
  flushAndCloseForTesting,
} from "./log-sink.js";
import { log, logger, setLogLevel } from "./logger.js";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "logger-test-"));
  setLogDirForTesting(dir);
  setLogSinkEnabled(true);
  setLogLevel("off"); // suppress stderr
});

after(() => {
  setLogDirForTesting(null);
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await flushAndCloseForTesting();
  for (const f of readdirSync(dir)) {
    rmSync(join(dir, f), { force: true });
  }
  setLogSessionId(null);
  setLogTurnId(null);
});

async function readEntries(): Promise<Array<Record<string, unknown>>> {
  await flushAndCloseForTesting();
  const path = logPathFor();
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

describe("logger.log → file sink", async () => {
  it("writes a JSONL line with ts, level, event, data", async () => {
    log("info", "test:event", { foo: "bar" });
    const entries = await readEntries();
    assert.strictEqual(entries.length, 1);
    const e = entries[0]!;
    assert.strictEqual(e.level, "info");
    assert.strictEqual(e.event, "test:event");
    assert.deepStrictEqual(e.data, { foo: "bar" });
    assert.ok(typeof e.ts === "string");
  });

  it("stamps session_id when set", async () => {
    setLogSessionId("sess_42");
    logger.info("with:session");
    const entries = await readEntries();
    assert.strictEqual(entries[0]!.session_id, "sess_42");
  });

  it("stamps turn_id when set", async () => {
    setLogSessionId("sess_42");
    setLogTurnId("turn_3");
    logger.warn("with:turn", { hint: 1 });
    const entries = await readEntries();
    assert.strictEqual(entries[0]!.session_id, "sess_42");
    assert.strictEqual(entries[0]!.turn_id, "turn_3");
  });

  it("lifts data.request_id (snake_case) to top level", async () => {
    log("debug", "llm:call", { request_id: "req_abc", model: "kimi" });
    const entries = await readEntries();
    assert.strictEqual(entries[0]!.request_id, "req_abc");
  });

  it("also lifts legacy data.requestId (camelCase)", async () => {
    log("debug", "llm:call", { requestId: "req_xyz", model: "kimi" });
    const entries = await readEntries();
    assert.strictEqual(entries[0]!.request_id, "req_xyz");
  });

  it("does not lift request_id from outside data", async () => {
    log("info", "no:req");
    const entries = await readEntries();
    assert.strictEqual(entries[0]!.request_id, undefined);
  });
});
