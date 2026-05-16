import { describe, it } from "node:test";
import assert from "node:assert";
import {
  clearLimitLoopResolvers,
  interruptTurn,
  interruptOrExit,
  type InterruptDeps,
} from "./input-handlers.js";

// Minimal ref factory — matches the React MutableRefObject shape that
// the helpers care about (just `current`).
function ref<T>(initial: T): { current: T } {
  return { current: initial };
}

interface MockDeps extends InterruptDeps {
  events: string[];
  toolUpdates: Array<{ id: string; patch: unknown }>;
  saveCalls: number;
  clearTaskCalls: number;
  exitCalls: number;
  stopAllCalls: number;
}

function makeDeps(overrides: Partial<{
  busy: boolean;
  hasScope: boolean;
  aborting: boolean;
  limit: boolean;
  loop: boolean;
  permission: boolean;
}> = {}): MockDeps {
  const events: string[] = [];
  const toolUpdates: MockDeps["toolUpdates"] = [];
  let saveCalls = 0;
  let clearTaskCalls = 0;
  let exitCalls = 0;
  let stopAllCalls = 0;

  const activeScope = overrides.hasScope
    ? { abort: (_reason: string) => {} } as unknown
    : null;

  const supervisor = { killTurn: () => {} } as unknown;
  const lspManager = {
    stopAll: () => {
      stopAllCalls += 1;
      return Promise.resolve();
    },
  } as unknown;

  const deps = {
    busyRef: ref(overrides.busy ?? false),
    activeScopeRef: ref(activeScope as never),
    isAbortingRef: ref(overrides.aborting ?? false),
    supervisorRef: ref(supervisor as never),
    limitResolveRef: ref(overrides.limit ? ((_: string) => {}) as never : null),
    loopResolveRef: ref(overrides.loop ? ((_: string) => {}) as never : null),
    setLimitModal: () => {},
    setLoopModal: () => {},
    hasPendingPermission: () => overrides.permission ?? false,
    denyPendingPermission: () => overrides.permission ?? false,
    pendingToolCallsRef: ref(new Map<string, string>([["t1", "bash"]])),
    updateTool: (id: string, patch: unknown) => {
      toolUpdates.push({ id, patch });
    },
    setEvents: ((updater: unknown) => {
      if (typeof updater === "function") {
        // record only info events emitted by the helper
        const out = (updater as (e: unknown[]) => unknown[])([]);
        for (const e of out) {
          const ev = e as { kind: string; text?: string };
          if (ev.kind === "info" && ev.text) events.push(ev.text);
        }
      }
    }) as never,
    mkKey: () => "key",
    saveSessionSafe: () => {
      saveCalls += 1;
    },
    clearTaskTracking: () => {
      clearTaskCalls += 1;
    },
    lspManagerRef: ref(lspManager as never),
    exit: () => {
      exitCalls += 1;
    },
  } as unknown as MockDeps;

  Object.defineProperties(deps, {
    events: { value: events, enumerable: false },
    toolUpdates: { value: toolUpdates, enumerable: false },
    saveCalls: { get: () => saveCalls, enumerable: false },
    clearTaskCalls: { get: () => clearTaskCalls, enumerable: false },
    exitCalls: { get: () => exitCalls, enumerable: false },
    stopAllCalls: { get: () => stopAllCalls, enumerable: false },
  });

  return deps;
}

describe("clearLimitLoopResolvers", () => {
  it("returns false flags when nothing is pending", () => {
    const deps = makeDeps();
    const { hadLimit, hadLoop } = clearLimitLoopResolvers(deps);
    assert.strictEqual(hadLimit, false);
    assert.strictEqual(hadLoop, false);
  });

  it("clears the limit resolver and returns the flag", () => {
    const deps = makeDeps({ limit: true });
    const { hadLimit, hadLoop } = clearLimitLoopResolvers(deps);
    assert.strictEqual(hadLimit, true);
    assert.strictEqual(hadLoop, false);
    assert.strictEqual(deps.limitResolveRef.current, null);
  });

  it("clears both resolvers when both are pending", () => {
    const deps = makeDeps({ limit: true, loop: true });
    const { hadLimit, hadLoop } = clearLimitLoopResolvers(deps);
    assert.strictEqual(hadLimit, true);
    assert.strictEqual(hadLoop, true);
    assert.strictEqual(deps.limitResolveRef.current, null);
    assert.strictEqual(deps.loopResolveRef.current, null);
  });
});

describe("interruptTurn", () => {
  it("is a no-op when idle (no busy, no perm, no resolvers)", () => {
    const deps = makeDeps();
    const out = interruptTurn(deps);
    assert.deepStrictEqual(out, {
      hadPermission: false,
      hadLimit: false,
      hadLoop: false,
      didInterruptTurn: false,
    });
    assert.strictEqual(deps.events.length, 0);
    assert.strictEqual(deps.saveCalls, 0);
    assert.strictEqual(deps.clearTaskCalls, 0);
  });

  it("clears resolvers without killing a turn when not busy", () => {
    const deps = makeDeps({ limit: true });
    const out = interruptTurn(deps);
    assert.strictEqual(out.hadLimit, true);
    assert.strictEqual(out.didInterruptTurn, false);
    assert.strictEqual(deps.saveCalls, 0);
  });

  it("kills the turn when busy, has scope, and not aborting", () => {
    const deps = makeDeps({ busy: true, hasScope: true });
    const out = interruptTurn(deps);
    assert.strictEqual(out.didInterruptTurn, true);
    assert.strictEqual(deps.isAbortingRef.current, true);
    assert.deepStrictEqual(deps.events, ["(interrupted)"]);
    assert.strictEqual(deps.saveCalls, 1);
    assert.strictEqual(deps.clearTaskCalls, 1);
    assert.deepStrictEqual(deps.toolUpdates, [{ id: "t1", patch: { status: "cancelled" } }]);
    assert.strictEqual(deps.pendingToolCallsRef.current.size, 0);
  });

  it("does not double-interrupt when already aborting", () => {
    const deps = makeDeps({ busy: true, hasScope: true, aborting: true });
    const out = interruptTurn(deps);
    assert.strictEqual(out.didInterruptTurn, false);
    assert.strictEqual(deps.saveCalls, 0);
    assert.strictEqual(deps.clearTaskCalls, 0);
  });
});

describe("interruptOrExit", () => {
  it("exits when fully idle", () => {
    const deps = makeDeps();
    interruptOrExit(deps);
    assert.strictEqual(deps.stopAllCalls, 1);
  });

  it("does NOT exit when a turn was interrupted", () => {
    const deps = makeDeps({ busy: true, hasScope: true });
    interruptOrExit(deps);
    assert.strictEqual(deps.stopAllCalls, 0);
  });

  it("does NOT exit when a permission was pending", () => {
    const deps = makeDeps({ permission: true });
    interruptOrExit(deps);
    assert.strictEqual(deps.stopAllCalls, 0);
  });

  it("does NOT exit when a limit resolver was pending", () => {
    const deps = makeDeps({ limit: true });
    interruptOrExit(deps);
    assert.strictEqual(deps.stopAllCalls, 0);
  });

  it("does NOT exit when a loop resolver was pending", () => {
    const deps = makeDeps({ loop: true });
    interruptOrExit(deps);
    assert.strictEqual(deps.stopAllCalls, 0);
  });
});
