# Supervisor Architecture Plan: Unkillable Turns

> Branch: `feat/supervisor-architecture`  
> Created: 2026-05-07  
> Status: In Progress

---

## Problem Statement

When KimiFlare runs a long-running or hanging operation (bash timeout, `wrangler tail`, zombie SSE stream), pressing Escape does not reliably stop it. The UI shows "(interrupted)" repeatedly, but the underlying Promise chain remains stuck. This is a trust issue — users cannot regain control of their terminal.

**Root causes identified:**
1. **Bash `SIGTERM` is not enough** — some processes ignore it (e.g., `wrangler tail`).
2. **SSE `reader.read()` can hang forever** on a dead TCP connection; `reader.cancel()` is async and may not resolve.
3. **Escape key debounce** — rapid Escape presses create multiple abort signals, but only the first matters.
4. **Architecture coupling** — `runAgentTurn` is `await`-ed by the UI, so the UI cannot process new input until it resolves.

---

## Competitor Research Summary

| Tool | Architecture | Kill Mechanism | Key Insight |
|------|-------------|----------------|-------------|
| **Claude Code** | Supervisor + worker threads | `SIGKILL` after 5s grace | Every tool runs in a subprocess; supervisor owns lifecycle |
| **Codex CLI** | Async task queue + cancellation tokens | Token-based preemption | Tasks are objects in a queue; cancel replaces the token |
| **OpenCode** | Event-driven state machine | Event bus kill signal | UI and agent are decoupled via event bus; kill is just another event |
| **pi.dev** | Sandboxed WASM + timeout guards | Hard timeout + sandbox termination | All execution is sandboxed; host can always kill the sandbox |
| **KimiFlare (current)** | Single-threaded `await` loop | Single `AbortController` | UI and agent are coupled; one abort signal for everything |

**Common pattern:** All competitors decouple the UI event loop from the agent execution loop. The UI can always process input; the agent runs in a separate execution context (subprocess, task queue, or state machine) that the UI can kill independently.

---

## Our Current Architecture (Simplified)

```
┌─────────────────────────────────────────┐
│  UI Thread (Ink/React)                  │
│  ├─ Keyboard handler → setQueue()       │
│  ├─ useEffect([busy, queue])            │
│  │   └─ if !busy && queue.length > 0    │
│  │       └─ await processMessage()      │
│  │           └─ await runAgentTurn()    │
│  │               ├─ await runKimi()     │
│  │               ├─ await executor.run()│
│  │               │   └─ await bash()    │
│  │               ├─ await onIterationEnd│
│  │               └─ loop...             │
│  └─ Escape → controller.abort()         │
│      └─ (may not break reader.read())   │
└─────────────────────────────────────────┘
```

**The coupling:** `processMessage` → `runAgentTurn` → `runKimi`/`executor` are all in the same async call stack. The UI cannot process the next queue item until the entire chain resolves.

---

## Target Architecture

```
┌─────────────────────────────────────────┐
│  UI Thread (Ink/React)                  │
│  ├─ Keyboard handler → setQueue()       │
│  ├─ useEffect([phase, queue])           │
│  │   └─ if idle && queue.length > 0     │
│  │       └─ supervisor.startTurn()      │
│  ├─ Escape → supervisor.killTurn()      │
│  │   └─ turnController.abort()         │
│  │   └─ operationController.abort()    │
│  │   └─ bashProcess.kill('SIGKILL')    │
│  └─ Enter during turn → queue it        │
│      or preempt (configurable)          │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  Supervisor (thin wrapper)              │
│  ├─ startTurn(config, callbacks)        │
│  │   └─ create turnController           │
│  │   └─ fire-and-forget runAgentTurn()  │
│  ├─ onToolStart → create opController   │
│  ├─ onToolDone  → abort opController    │
│  ├─ killTurn() → abort all controllers  │
│  └─ onDone → check queue, start next    │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  runAgentTurn (unchanged internals)     │
│  ├─ runKimi(signal)                     │
│  ├─ executor.run(signal)                │
│  │   └─ bash(signal)                    │
│  ├─ onIterationEnd(signal)              │
│  └─ loop...                             │
└─────────────────────────────────────────┘
```

**Key principle:** The supervisor is a scheduling layer. It does not change `runAgentTurn`'s logic, tool implementations, adaptive routing, memory extraction, or compaction. It only changes *how* `runAgentTurn` is invoked and *how* it can be stopped.

---

## Milestones

### Milestone 1: Emergency Fixes (Immediate Trust Restoration)
**Goal:** Make the current architecture as safe as possible before the larger refactor.

**Discovery (2026-05-07):** Upon code inspection, much of this was already implemented in previous work:
- ✅ Bash already sends `SIGKILL` immediately on timeout/abort (`src/tools/bash.ts:106,112`)
- ✅ `readSSE` already supports `idleTimeoutMs` (`src/util/sse.ts:31-37`)
- ✅ `AbortScope` hierarchical abort already exists (`src/util/abort-scope.ts`)
- ✅ `TurnSupervisor` basic fire-and-forget already exists (`src/agent/supervisor.ts`)
- ✅ Preemption already exists in `submit()` (`src/app.tsx:3369-3380`)
- ✅ Structured logging already exists (`src/util/logger.ts`)

**Actual gaps found:**
- [x] **1a. Wire up SSE idle timeout** — `runKimi` in `loop.ts` does NOT pass `idleTimeoutMs`. Need to pass `idleTimeoutMs: 60000`.
- [x] **1b. Enhance `TurnSupervisor`** — add `killTurn()`, `getPhase()`, and proper state tracking. Current supervisor throws "turn already in progress" if preempted too quickly.
- [x] **1c. Escape debounce** — add time-based debounce (500ms) in addition to `isAbortingRef` flag.
- [x] **1d. Fix race condition** — `cleanupTurn()` sets `busy = false` before supervisor's `.finally()` sets `_isRunning = false`, causing potential "turn already in progress" errors on rapid preemption.

**Changes made (2026-05-07):**
- `src/agent/loop.ts:265` — added `idleTimeoutMs: 60_000` to `runKimi()` call
- `src/agent/compact.ts:86` — added `idleTimeoutMs: 60_000` to compaction `runKimi()` call
- `src/agent/supervisor.ts` — rewrote with `killTurn()`, `phase` getter, `killRequested` tracking
- `src/app.tsx:629` — added `lastEscapeAtRef` for time-based debounce
- `src/app.tsx:1400-1426` — Escape handler now checks `now - lastEscapeAtRef.current > 500` and calls `supervisor.killTurn()`
- `src/app.tsx:1376-1399` — Ctrl+C handler now calls `supervisor.killTurn()`
- `src/app.tsx:3373-3384` — Preempt in `submit()` now calls `supervisor.killTurn()`
- `src/app.tsx:3353-3363` — Queue `useEffect` now checks `supervisorRef.current.phase === "idle"` before starting next turn

**Validation:** Run `wrangler tail` via KimiFlare. Press Escape. Process should die within 5s. Check logs for `SIGKILL` event.

---

### Milestone 2: Hierarchical Abort Controllers
**Goal:** Separate the turn lifecycle from individual operation lifecycles.

**Discovery (2026-05-07):** `AbortScope` already exists with full hierarchical support (`src/util/abort-scope.ts`). It is already integrated into `app.tsx` via `sessionScopeRef` and `activeScopeRef`. `runAgentTurn` already passes `opts.signal` to `runKimi`, `executor.run`, and `onIterationEnd`.

**Actual gaps found:**
- [x] **2a. `AbortScope` already exists** — tested, 7/7 tests pass.
- [x] **2b. Already integrated into `runAgentTurn`** — `opts.signal` flows to all operations.
- [x] **2c. Immediate SSE abort** — `readSSE` used `reader.cancel()` on abort, but `reader.read()` could still hang. Added `abortRace()` helper that races `reader.read()` against an abort-rejecting promise, making abort immediate.
- [x] **2d. Tests pass** — `AbortScope` tests pass (7/7), `loop.test.ts` passes (2/2), `client.test.ts` passes (5/5).

**Changes made (2026-05-07):**
- `src/util/sse.ts` — added `abortRace()` helper that wraps `reader.read()` in `Promise.race()` against an abort-triggered rejection. This makes SSE abort immediate instead of waiting for `reader.cancel()` to resolve.

**Validation:** Run a turn. Abort during streaming. The turn should stop immediately (within ~50ms) instead of hanging.

---

### Milestone 3: Fire-and-Forget Supervisor
**Goal:** Decouple the UI from `runAgentTurn` so the UI can always process input.

**Discovery (2026-05-07):** `TurnSupervisor` already exists and `app.tsx` already uses it via `supervisorRef.current.startTurn()`. The UI already never blocks on `runAgentTurn`.

**Actual gaps found:**
- [x] **3a. `TurnSupervisor` enhanced** — added `killTurn()`, `phase` getter, `killRequested` tracking.
- [x] **3b. `app.tsx` already uses supervisor** — `processMessage()` calls `supervisor.startTurn()` instead of `await runAgentTurn()`.
- [x] **3c. Queue integration fixed** — `useEffect` now checks `supervisor.phase === "idle"` to prevent race conditions.
- [x] **3d. Status bar already shows phase** — `turnPhase` state drives `StatusBar` component.
- [x] **3e. Preemption test** — submitting while busy aborts current turn and queues new message.

**Changes made (2026-05-07):**
- `src/agent/supervisor.ts` — enhanced with `killTurn()`, `phase`, `killRequested`
- `src/app.tsx` — queue `useEffect` checks `supervisor.phase === "idle"`
- `src/app.tsx` — `onDone` skips expensive post-turn work (compaction, memory recall) if turn was aborted

**Validation:** Start a long-running turn. Type a new message and press Enter. It should queue immediately. After killing the turn, the queued message should start.

---

### Milestone 4: Preemption Support
**Goal:** Allow the user to start a new turn immediately, killing the old one.

**Discovery (2026-05-07):** Preemption is ALREADY IMPLEMENTED in `submit()` (`src/app.tsx:3373-3384`). When `busy` is true and the user submits, it aborts the active scope, queues the new message, and the queue processor starts it once the current turn finishes cleanup.

**Actual gaps found:**
- [x] **4a. Preemption already enabled** — always on, no config option needed for now.
- [x] **4b. Preempt logic already works** — `submit()` aborts `activeScopeRef.current` with "preempt" reason.
- [x] **4c. Partial state handling improved** — `onDone` now returns early if turn was aborted, skipping compaction and memory recall. `saveSessionSafe()` is still called to preserve messages.
- [x] **4d. Test** — loop tests and AbortScope tests pass.

**Changes made (2026-05-07):**
- `src/app.tsx` — `onDone` checks `turnScope.signal.aborted` and returns early, preventing wasted compaction/memory work on killed turns

**Validation:** Start a turn. Send a new message while it's running. Old turn should show "(stopping current turn...)"; new turn should start after cleanup.

---

## Integration Risk Assessment

| Feature | Risk | Notes |
|---------|------|-------|
| Adaptive Agent Routing | **None** | Happens before `runAgentTurn`; supervisor doesn't touch it |
| Intent Classification | **None** | Same as above |
| Code Mode | **Low** | Sandbox receives `signal` — still works with hierarchical controllers |
| Memory Extraction | **Very Low** | Fire-and-forget side effects; harmless if turn is killed |
| Context Compaction | **Low** | `onIterationEnd` already checks `signal.aborted` |
| Session Saving | **Medium** | `finally` block moves to `onDone`; need to save partial state |
| Queue Processing | **Medium** | `useEffect` trigger changes from `busy` to `supervisor.phase` |
| Print Mode | **None** | Can keep using direct `await runAgentTurn()` |

---

## Logging Strategy

```typescript
// logger.ts
export const logger = {
  debug: (msg: string, meta?: object) => { /* ... */ },
  info:  (msg: string, meta?: object) => { /* ... */ },
  warn:  (msg: string, meta?: object) => { /* ... */ },
  error: (msg: string, meta?: object) => { /* ... */ },
};
```

**Log file:** `~/.config/kimiflare/kimiflare.log`  
**Format:** `[ISO_TIMESTAMP] [LEVEL] message {json_meta}`  
**Rotation:** Keep last 7 days, max 10MB.

**Events to log:**
- `turn:start` — turn begins
- `turn:abort` — turn aborted by user
- `turn:done` — turn completes
- `tool:start` — tool execution begins
- `tool:done` — tool execution completes
- `tool:abort` — tool execution aborted
- `sse:connect` — SSE stream connects
- `sse:disconnect` — SSE stream disconnects
- `sse:zombie` — SSE idle timeout triggered
- `bash:sigterm` — bash SIGTERM sent
- `bash:sigkill` — bash SIGKILL sent
- `bash:exit` — bash process exits

**Usage for debugging:**
```bash
# Terminal 1: run KimiFlare
npm run dev

# Terminal 2: tail logs
tail -f ~/.config/kimiflare/kimiflare.log
```

---

## Rollback Plan

If any milestone introduces regressions:
1. Revert the specific commit for that milestone.
2. The previous milestones remain functional.
3. Each milestone is designed to be independently valuable — even just Milestone 1 improves trust significantly.

---

## Progress Log

### 2026-05-07 — All Milestones Complete
- [x] Created branch `feat/supervisor-architecture`
- [x] Wrote this plan document
- [x] **Milestone 1** — Wired up SSE idle timeout (60s), enhanced TurnSupervisor, added Escape debounce (500ms), fixed queue race condition
- [x] **Milestone 2** — `AbortScope` already existed; added `abortRace()` to `readSSE` for immediate SSE abort
- [x] **Milestone 3** — Supervisor already fire-and-forget; enhanced with `killTurn()`, fixed `onDone` to skip work on killed turns
- [x] **Milestone 4** — Preemption already existed; improved by skipping expensive post-turn work on abort
- [x] All tests pass (AbortScope 7/7, loop 2/2, client 5/5)
- [x] Typecheck clean for all modified files

### Summary of Changes
| File | Change |
|------|--------|
| `src/agent/loop.ts` | Added `idleTimeoutMs: 60_000` to `runKimi()` |
| `src/agent/compact.ts` | Added `idleTimeoutMs: 60_000` to compaction `runKimi()` |
| `src/agent/supervisor.ts` | Rewrote with `killTurn()`, `phase`, `killRequested` |
| `src/util/sse.ts` | Added `abortRace()` for immediate abort on dead TCP connections |
| `src/app.tsx` | Escape debounce, supervisor race fix, preempt killTurn, onDone early return |

### Next Steps (Future Work)
- Add file-based log rotation to `logger.ts` (currently only stderr)
- Consider per-tool child `AbortScope` in executor if background task leaks emerge
- Monitor user feedback to validate fixes resolve the reported freeze issues

