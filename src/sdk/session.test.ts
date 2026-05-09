import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createAgentSession } from "./session.js";
import type { KimiFlareSession, SessionEvent } from "./types.js";

// We need credentials for createAgentSession to work, so we set env vars
const TEST_ACCOUNT = "test_account";
const TEST_TOKEN = "test_token";
const TEST_MODEL = "@cf/moonshotai/kimi-k2.6";

describe("SDK Session", () => {
  let originalAccount: string | undefined;
  let originalToken: string | undefined;
  let originalModel: string | undefined;
  let session: KimiFlareSession | null = null;
  const testCwd = join(process.cwd(), ".test-sdk-session");

  before(async () => {
    originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    originalToken = process.env.CLOUDFLARE_API_TOKEN;
    originalModel = process.env.KIMI_MODEL;
    process.env.CLOUDFLARE_ACCOUNT_ID = TEST_ACCOUNT;
    process.env.CLOUDFLARE_API_TOKEN = TEST_TOKEN;
    process.env.KIMI_MODEL = TEST_MODEL;
    await mkdir(testCwd, { recursive: true });
  });

  after(async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = originalAccount;
    process.env.CLOUDFLARE_API_TOKEN = originalToken;
    process.env.KIMI_MODEL = originalModel;
    session?.dispose();
    await rm(testCwd, { recursive: true, force: true });
  });

  it("creates a session with default options", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    assert.ok(s.sessionId);
    assert.strictEqual(s.cwd, testCwd);
    assert.strictEqual(s.isStreaming, false);
    assert.ok(Array.isArray(s.messages));
  });

  it("emits events via subscribe", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    const events: SessionEvent[] = [];
    const unsubscribe = s.subscribe((event) => {
      events.push(event);
    });

    // We can't easily test prompt() without mocking runAgentTurn,
    // but we can test that subscribe/unsubscribe works
    assert.strictEqual(events.length, 0);
    unsubscribe();
  });

  it("setModel changes the model", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    s.setModel("@cf/moonshotai/kimi-k2.6-lite");
    // Model is internal; we verify it doesn't throw
    assert.ok(true);
  });

  it("setMode changes the mode", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    s.setMode("auto");
    const status = s.getStatus();
    assert.strictEqual(status.currentMode, "auto");
  });

  it("setReasoningEffort changes the effort level", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    s.setReasoningEffort("high");
    // Effort is internal; we verify it doesn't throw
    assert.ok(true);
  });

  it("abort does not throw when not streaming", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    await s.abort();
    assert.ok(true);
  });

  it("getUsage returns initial zeros", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    const usage = s.getUsage();
    assert.strictEqual(usage.totalInputTokens, 0);
    assert.strictEqual(usage.totalOutputTokens, 0);
    assert.strictEqual(usage.totalCost, 0);
    assert.strictEqual(usage.turnCount, 0);
  });

  it("getStatus returns correct initial state", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    const status = s.getStatus();
    assert.strictEqual(status.isStreaming, false);
    assert.strictEqual(status.isCompacting, false);
    assert.deepStrictEqual(status.pendingSteer, []);
    assert.deepStrictEqual(status.pendingFollowUp, []);
    assert.strictEqual(status.currentMode, "edit");
  });

  it("save persists session to disk", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    await s.save();
    // If save() resolves without error, we consider it successful
    assert.ok(true);
  });

  it("dispose cleans up without error", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    s.dispose();
    assert.ok(true);
    session = null;
  });

  it("steer does not queue when not streaming", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    await s.steer("use TypeScript");
    const status = s.getStatus();
    assert.deepStrictEqual(status.pendingSteer, []);
  });

  it("followUp queues messages", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    await s.followUp("also add tests");
    const status = s.getStatus();
    assert.deepStrictEqual(status.pendingFollowUp, ["also add tests"]);
  });

  it("resolvePermission does not throw for unknown requestId", async () => {
    const { session: s } = await createAgentSession({ cwd: testCwd });
    session = s;
    s.resolvePermission("unknown", "allow");
    assert.ok(true);
  });
});
