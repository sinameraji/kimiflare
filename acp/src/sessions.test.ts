import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { getSession, setSession, deleteSession, type AcpSession } from "./sessions.js";

function makeStubSession(id: string, overrides?: Partial<AcpSession>): AcpSession {
  return {
    id,
    cwd: "/tmp",
    config: { accountId: "test", apiToken: "test", model: "test-model" } as AcpSession["config"],
    executor: { list: () => [], clearSessionPermissions: () => {} } as unknown as AcpSession["executor"],
    mcpManager: { disconnectAll: () => Promise.resolve() } as unknown as AcpSession["mcpManager"],
    messages: [],
    mode: "edit",
    abortController: new AbortController(),
    promptRunning: false,
    memoryManager: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// The sessions module uses a module-level Map, so we need to clean up
// between tests. Since we can't reset the module, we delete keys manually.
function clearAllSessions() {
  // Delete sessions by trying known IDs until none remain
  for (let i = 0; i < 200; i++) {
    deleteSession(`s-${i}`);
  }
  deleteSession("a");
  deleteSession("b");
  deleteSession("c");
  deleteSession("test-session");
}

describe("sessions", () => {
  beforeEach(() => {
    clearAllSessions();
  });

  describe("getSession / setSession / deleteSession", () => {
    it("stores and retrieves a session", () => {
      const session = makeStubSession("test-session");
      setSession("test-session", session);
      const retrieved = getSession("test-session");
      assert.strictEqual(retrieved, session);
      assert.strictEqual(retrieved!.id, "test-session");
    });

    it("returns undefined for unknown session", () => {
      assert.strictEqual(getSession("nonexistent"), undefined);
    });

    it("deletes a session", () => {
      const session = makeStubSession("test-session");
      setSession("test-session", session);
      assert.strictEqual(deleteSession("test-session"), true);
      assert.strictEqual(getSession("test-session"), undefined);
    });

    it("returns false when deleting nonexistent session", () => {
      assert.strictEqual(deleteSession("nonexistent"), false);
    });

    it("overwrites an existing session with same ID", () => {
      const s1 = makeStubSession("test-session", { cwd: "/a" });
      const s2 = makeStubSession("test-session", { cwd: "/b" });
      setSession("test-session", s1);
      setSession("test-session", s2);
      assert.strictEqual(getSession("test-session")!.cwd, "/b");
    });
  });

  describe("MAX_SESSIONS eviction", () => {
    it("evicts the oldest session when limit is reached", () => {
      // Fill up to 64 sessions
      for (let i = 0; i < 64; i++) {
        setSession(`s-${i}`, makeStubSession(`s-${i}`));
      }
      // Verify all 64 exist
      assert.notStrictEqual(getSession("s-0"), undefined);
      assert.notStrictEqual(getSession("s-63"), undefined);

      // Adding a 65th should evict s-0
      setSession("s-64", makeStubSession("s-64"));
      assert.strictEqual(getSession("s-0"), undefined);
      assert.notStrictEqual(getSession("s-1"), undefined);
      assert.notStrictEqual(getSession("s-64"), undefined);
    });

    it("does not evict when updating an existing session", () => {
      for (let i = 0; i < 64; i++) {
        setSession(`s-${i}`, makeStubSession(`s-${i}`));
      }
      // Update s-63 (existing key) — should not evict anything
      setSession("s-63", makeStubSession("s-63", { cwd: "/updated" }));
      assert.notStrictEqual(getSession("s-0"), undefined);
      assert.strictEqual(getSession("s-63")!.cwd, "/updated");
    });

    it("aborts the evicted session's abort controller", () => {
      for (let i = 0; i < 64; i++) {
        setSession(`s-${i}`, makeStubSession(`s-${i}`));
      }
      const evicted = getSession("s-0")!;
      assert.strictEqual(evicted.abortController.signal.aborted, false);

      // Trigger eviction
      setSession("s-64", makeStubSession("s-64"));
      assert.strictEqual(evicted.abortController.signal.aborted, true);
    });
  });
});
