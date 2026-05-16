import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  logDir,
  logPathFor,
  setLogDirForTesting,
  setLogSinkEnabled,
  isLogSinkEnabled,
  writeLogLine,
  pruneOldLogs,
  setLogSessionId,
  getLogSessionId,
  setLogTurnId,
  getLogTurnId,
  flushAndCloseForTesting,
} from "./log-sink.js";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "log-sink-test-"));
  setLogDirForTesting(dir);
  setLogSinkEnabled(true);
});

after(() => {
  setLogDirForTesting(null);
  setLogSinkEnabled(true);
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  // Close any cached stream from the previous test before unlinking the
  // file it points at — otherwise the next write goes to a dead fd.
  await flushAndCloseForTesting();
  for (const f of readdirSync(dir)) {
    rmSync(join(dir, f), { force: true });
  }
  setLogSessionId(null);
  setLogTurnId(null);
});

describe("logDir / logPathFor", () => {
  it("uses the override dir when set", () => {
    assert.strictEqual(logDir(), dir);
  });

  it("formats the daily path as YYYY-MM-DD.jsonl", () => {
    const d = new Date("2026-05-17T12:34:56Z");
    assert.strictEqual(logPathFor(d), join(dir, "2026-05-17.jsonl"));
  });
});

describe("writeLogLine", () => {
  it("appends one JSON line per call", async () => {
    writeLogLine({ event: "first", a: 1 });
    writeLogLine({ event: "second", a: 2 });
    await flushAndCloseForTesting();
    const path = logPathFor();
    const content = readFileSync(path, "utf8");
    const lines = content.trim().split("\n");
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(JSON.parse(lines[0]!), { event: "first", a: 1 });
    assert.deepStrictEqual(JSON.parse(lines[1]!), { event: "second", a: 2 });
  });

  it("is a silent no-op when the sink is disabled", () => {
    setLogSinkEnabled(false);
    writeLogLine({ event: "should not appear" });
    assert.strictEqual(readdirSync(dir).length, 0);
    setLogSinkEnabled(true);
  });

  it("rotates files on UTC date change", async () => {
    const day1 = new Date("2026-05-17T23:59:59Z");
    const day2 = new Date("2026-05-18T00:00:01Z");
    writeLogLine({ event: "late" }, day1);
    writeLogLine({ event: "early" }, day2);
    await flushAndCloseForTesting();
    const day1Path = logPathFor(day1);
    const day2Path = logPathFor(day2);
    assert.strictEqual(readFileSync(day1Path, "utf8").trim(), JSON.stringify({ event: "late" }));
    assert.strictEqual(readFileSync(day2Path, "utf8").trim(), JSON.stringify({ event: "early" }));
  });
});

describe("isLogSinkEnabled / setLogSinkEnabled", () => {
  it("round-trips", () => {
    setLogSinkEnabled(false);
    assert.strictEqual(isLogSinkEnabled(), false);
    setLogSinkEnabled(true);
    assert.strictEqual(isLogSinkEnabled(), true);
  });
});

describe("pruneOldLogs", () => {
  it("returns 0 when the dir doesn't exist", () => {
    // Point at a definitely-empty subdir
    setLogDirForTesting(join(dir, "nope"));
    assert.strictEqual(pruneOldLogs(), 0);
    setLogDirForTesting(dir);
  });

  it("deletes files older than the retention window", () => {
    // Create one old, one fresh
    const old = join(dir, "2020-01-01.jsonl");
    const fresh = join(dir, logPathFor().split("/").pop()!);
    writeFileSync(old, "{}\n");
    writeFileSync(fresh, "{}\n");
    // Backdate the old one to 30 days ago
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(old, past, past);

    const removed = pruneOldLogs(7);
    assert.strictEqual(removed, 1);
    const remaining = readdirSync(dir);
    assert.ok(remaining.includes(fresh.split("/").pop()!));
    assert.ok(!remaining.includes("2020-01-01.jsonl"));
  });

  it("ignores non-jsonl files", () => {
    const notALog = join(dir, "readme.txt");
    writeFileSync(notALog, "hi");
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(notALog, past, past);
    assert.strictEqual(pruneOldLogs(7), 0);
    assert.ok(readdirSync(dir).includes("readme.txt"));
  });
});

describe("correlation context", () => {
  it("round-trips session id", () => {
    assert.strictEqual(getLogSessionId(), null);
    setLogSessionId("sess_abc");
    assert.strictEqual(getLogSessionId(), "sess_abc");
    setLogSessionId(null);
    assert.strictEqual(getLogSessionId(), null);
  });

  it("round-trips turn id independently of session id", () => {
    setLogTurnId("turn_5");
    assert.strictEqual(getLogTurnId(), "turn_5");
    setLogSessionId("sess_xyz");
    // setting session does NOT clear turn
    assert.strictEqual(getLogTurnId(), "turn_5");
  });
});
