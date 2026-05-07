# Interruptibility & Supervisor Architecture Plan

> **Branch:** `feat/supervisor-interruptibility`  
> **Created:** 2026-05-07  
> **Status:** In Progress — Step 1  
> **Author:** kimiflare

---

## 1. Problem Statement

### User Report
A user experienced a "freeze" during a Bash tool execution. The command (`timeout 8 bash -c ...`) completed quickly (`<1s`), but the UI remained in "waiting" state for 3.5+ minutes. The user pressed Escape multiple times — `(interrupted)` appeared on screen repeatedly — but execution did not stop. The spinner continued. Subsequent user input was queued rather than executed.

### Root Cause Hypothesis
The Bash tool itself finished. The hang is likely in:
1. **`runKimi()` SSE stream** — zombie TCP connection to Cloudflare Workers AI
2. **`readSSE()`** — `reader.read()` hanging indefinitely on a dead connection
3. **A subsequent tool call** not visible in the screenshot

The core issue: **KimiFlare has no true preemption.** Once `runAgentTurn()` starts, the user cannot stop it. Escape sends `AbortSignal`, but:
- `bash` tool ignores `SIGTERM` (only sends `SIGTERM`, not `SIGKILL`)
- `readSSE()` may not respond to `reader.cancel()` on dead connections
- The UI remains blocked because `runAgentTurn()` is `await`-ed synchronously

### Trust Impact
> "Would be a big deal if I were to use it for work. I can't trust it for now."

This is a **P0 trust issue**. Users must be able to stop any operation, especially:
- Long-running Bash commands (e.g., `wrangler tail` which runs forever)
- Hanging API streams
- Runaway tool loops

---

## 2. Competitor Research Summary

| Tool | Architecture | Isolation Mechanism | User Interrupt |
|------|-------------|---------------------|----------------|
| **Claude Code** | Supervisor + per-turn `AbortController` | Each turn is a `Promise` with its own signal. `SIGINT` → `controller.abort()` → kills turn. | `Ctrl+C` immediately kills current turn. New input preempts old turn. |
| **OpenCode** (OpenAI) | Event-loop with operation-level timeouts | Every tool call has a hard timeout. Bash runs in a subprocess with `SIGKILL` after timeout. | `Ctrl+C` cancels the current operation. Queue is flushed on new input. |
| **Codex CLI** | Turn-based with `AbortController` hierarchy | Parent `AbortController` for the session. Child controllers for each turn. `abort()` cascades. | `Ctrl+C` aborts current turn. Session continues. |
| **pi.dev** | Sandboxed execution environment | Each tool runs in an isolated process/container. OS-level `kill -9` on abort. | Immediate termination via process kill. |
| **Cline** | Async task queue with cancellation tokens | Tasks are queued. Each has a `CancellationToken`. New task cancels previous. | `Escape` cancels current task. Queue processes next. |

### Key Patterns
1. **Supervisor / Scheduler Layer** — A thin wrapper that owns turn lifecycle, not the turn logic itself
2. **Hierarchical Abort Controllers** — Parent (session) → Child (turn) → Grandchild (operation). `abort()` cascades down
3. **Fire-and-Forget Turns** — The scheduler starts a turn as an unawaited `Promise`, then listens for events via callbacks
4. **Hard Timeouts** — Every operation has a wall-clock timeout enforced by `setTimeout` + `AbortController`
5. **SIGKILL for Bash** — `SIGTERM` is insufficient; `SIGKILL` is required for guaranteed termination

---

## 3. Current KimiFlare Architecture

### 3.1 Simplified Flow

```
User Input
    ↓
processMessage()  ←── sets busy=true, appends user message
    ↓
await runAgentTurn({  ←── BLOCKS HERE for entire turn
  messages,
  tools,
  signal: activeController.signal,
  onToolResult: (r) => { /* UI update */ },
  onIterationEnd: (m) => { /* compaction */ },
})
    ↓
setBusy(false)  ←── ONLY after turn fully completes
    ↓
useEffect([busy, queue])  ←── dequeues next message
```

### 3.2 The Blocking Problem

`runAgentTurn()` is **synchronously awaited** by `processMessage()`. This means:
- The UI thread (Ink render loop) continues, but the **control flow** is blocked
- `setBusy(false)` only happens after the entire turn finishes
- If the turn hangs, `busy` never becomes false
- The queue never dequeues
- User input is queued but never processed

### 3.3 Abort Signal Path

```
User presses Escape
    ↓
activeControllerRef.current.abort()  ←── single controller for entire turn
    ↓
  ├─→ bash tool: sends SIGTERM to child process  ←── may not work
  ├─→ readSSE: calls reader.cancel()  ←── may hang on dead TCP
  ├─→ fetch: aborts HTTP request  ←── works for in-flight requests
  └─→ runKimi: catches AbortError, returns  ←── works if signal propagates
```

### 3.4 Why Escape Doesn't Work

1. **Bash tool only sends SIGTERM** — The child process may ignore SIGTERM (e.g., `wrangler tail`)
2. **readSSE reader.cancel() is async** — If the TCP connection is dead, `cancel()` may never resolve
3. **No hierarchical abort** — One signal for everything. If `reader.read()` is stuck, it blocks the entire turn
4. **No hard timeout** — Operations can hang forever

---

## 4. Proposed Architecture: Supervisor Pattern

### 4.1 Design Principles

1. **Separation of Concerns** — The supervisor handles scheduling, lifecycle, and cancellation. `runAgentTurn` handles AI logic, tool execution, and callbacks.
2. **Fire-and-Forget** — The supervisor starts `runAgentTurn` as an unawaited `Promise`. The UI is never blocked.
3. **Hierarchical Abort** — Session → Turn → Operation. Each level can be aborted independently.
4. **Hard Timeouts** — Every operation has a wall-clock timeout. No operation can hang forever.
5. **Preemption** — New user input can kill the current turn and start a new one.

### 4.2 New Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         SUPERVISOR                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Phase     │  │   Queue     │  │  AbortController    │  │
│  │  Machine    │  │  Manager    │  │    Hierarchy        │  │
│  │             │  │             │  │                     │  │
│  │ idle        │  │ [msg1, msg2]│  │ sessionController   │  │
│  │ streaming   │  │             │  │   └─ turnController │  │
│  │ tool_running│  │             │  │        └─ opCtrl    │  │
│  │ compacting  │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ startTurn(config)
                              ▼
                    ┌─────────────────┐
                    │  runAgentTurn() │  ←── UNCHANGED LOGIC
                    │   (Promise)     │
                    └─────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        onTextDelta     onToolResult     onIterationEnd
              │               │               │
              ▼               ▼               ▼
           UI Update      UI Update      Compaction
```

### 4.3 State Machine

```
                    ┌─────────┐
         ┌─────────│  IDLE   │◄────────────────┐
         │         └────┬────┘                 │
         │              │ startTurn()           │ turn completes
         │              ▼                       │ or abort()
         │    ┌─────────────────┐               │
         │    │    STREAMING    │───────────────┘
         │    │  (runKimi active)│
         │    └────────┬────────┘
         │             │ tool_call_start
         │             ▼
         │    ┌─────────────────┐
         └────│   TOOL_RUNNING  │
              │ (executor active)│
              └────────┬────────┘
                       │ tool results → next iteration
                       └──────────────────────────────► (back to STREAMING)
```

### 4.4 Abort Hierarchy

```
sessionController (lives for entire TUI session)
    └── turnController (created per turn, aborted on Escape or new input)
            ├── bashOperationController (created per bash call)
            ├── readOperationController (created per readSSE)
            ├── fetchOperationController (created per web_fetch)
            └── ... (one per tool call)
```

**Abort behavior:**
- `turnController.abort()` → kills current turn, cancels all child operations
- `sessionController.abort()` → kills everything, shuts down
- `bashOperationController.abort()` → sends SIGKILL to child process

### 4.5 Preemption Flow

```
User sends new message while turn is running
    ↓
supervisor.preemptTurn()
    ↓
  1. turnController.abort()  ←── kills current turn + all children
  2. Wait for Promise to settle (with timeout)
  3. Clear partial UI state (spinner, "waiting")
  4. Call onDone callback
  5. Queue manager dequeues next message
  6. Start new turn
```

---

## 5. Implementation Plan

### Milestone 0: Document & Branch Setup ✅
- [x] Create branch `feat/supervisor-interruptibility`
- [x] Write this plan document
- [ ] Review plan with user

### Milestone 1: Emergency Fixes (Immediate Trust Restoration)
**Goal:** Fix the most common hang scenarios without architectural changes.

- [ ] **1.1 Bash SIGKILL** — Change `bash` tool from `SIGTERM` to `SIGKILL` on abort
  - File: `src/tools/bash.ts`
  - Change: `child.kill()` → `child.kill('SIGKILL')`
  - Risk: Low. SIGKILL is guaranteed. Some cleanup scripts may not run.

- [ ] **1.2 SSE Zombie Protection** — Add hard timeout to `readSSE()`
  - File: `src/util/sse.ts`
  - Change: Add `setTimeout` that aborts if no data received for 60s
  - Risk: Low. 60s is generous for streaming.

- [ ] **1.3 Escape Debounce** — Prevent multiple `(interrupted)` lines
  - File: `src/app.tsx`
  - Change: Track `isAborting` flag, ignore subsequent Escape presses
  - Risk: Low. Purely UI behavior.

- [ ] **1.4 Structured Logging** — Add `src/util/logger.ts` for real-time debugging
  - File: `src/util/logger.ts` (new)
  - Features: Timestamped logs, log levels (debug/info/warn/error), file output to `~/.config/kimiflare/logs/`
  - Risk: Low. New file, no existing code changes.

- [ ] **1.5 Log Injection** — Add strategic log points
  - `runAgentTurn`: start, end, abort caught
  - `runKimi`: connection start, first chunk, last chunk, error
  - `readSSE`: read attempt, timeout, cancel
  - `bash`: spawn, stdout, stderr, exit, kill signal
  - `executor`: tool start, tool end, result

**Validation:**
- Run KimiFlare in one terminal
- `tail -f ~/.config/kimiflare/logs/kimiflare.log` in another
- Trigger a long operation, press Escape, verify logs show the abort path

### Milestone 2: Hierarchical Abort Controllers
**Goal:** Replace single `AbortController` with a tree.

- [ ] **2.1 Create `AbortScope` class**
  - File: `src/util/abort-scope.ts` (new)
  - API:
    ```typescript
    class AbortScope {
      constructor(parent?: AbortScope);
      get signal(): AbortSignal;
      abort(reason?: string): void;
      createChild(): AbortScope;
      get isAborted(): boolean;
    }
    ```

- [ ] **2.2 Integrate into `runAgentTurn`**
  - File: `src/agent/loop.ts`
  - Change: `runAgentTurn` creates child scopes for each operation
  - Bash tool receives operation-level signal
  - `readSSE` receives operation-level signal

- [ ] **2.3 Update `app.tsx`**
  - File: `src/app.tsx`
  - Change: Replace `activeControllerRef` with `sessionScope`
  - Each turn creates a child scope from `sessionScope`

**Validation:**
- Run a bash command, press Escape
- Verify logs show: `turn aborted` → `bash op aborted` → `process killed with SIGKILL`

### Milestone 3: Fire-and-Forget Supervisor
**Goal:** Decouple turn execution from UI control flow.

- [ ] **3.1 Create `TurnSupervisor` class**
  - File: `src/agent/supervisor.ts` (new)
  - API:
    ```typescript
    type TurnPhase = "idle" | "streaming" | "tool_running" | "compacting" | "error";
    
    interface SupervisorCallbacks {
      onTextDelta: (text: string) => void;
      onToolStart: (tool: ToolCall) => void;
      onToolResult: (result: ToolResult) => void;
      onPhaseChange: (phase: TurnPhase) => void;
      onError: (error: Error) => void;
      onDone: () => void;
    }
    
    class TurnSupervisor {
      get phase(): TurnPhase;
      startTurn(config: TurnConfig, callbacks: SupervisorCallbacks): void;
      abortCurrentTurn(reason?: string): void;
      preemptTurn(config: TurnConfig, callbacks: SupervisorCallbacks): void;
    }
    ```

- [ ] **3.2 Refactor `processMessage`**
  - File: `src/app.tsx`
  - Change: Replace `await runAgentTurn(...)` with `supervisor.startTurn(...)`
  - Move `setBusy(false)` logic into `onDone` callback
  - Update `useEffect([busy, queue])` to `useEffect([supervisor.phase, queue])`

- [ ] **3.3 Handle Edge Cases**
  - Turn aborts during compaction → save partial session
  - Turn throws unexpected error → log + enter error phase
  - Multiple rapid Escape presses → debounce

**Validation:**
- Send a message, verify turn starts
- Press Escape during streaming, verify turn stops, UI returns to idle
- Send another message immediately, verify new turn starts

### Milestone 4: Preemption Support
**Goal:** New user input kills old turn and starts new one automatically.

- [ ] **4.1 Queue + Preemption Logic**
  - File: `src/agent/supervisor.ts`
  - Change: `preemptTurn()` kills current turn, then starts new one
  - If queue has items, process next item
  - If user types while turn is running, preempt immediately

- [ ] **4.2 UI Updates**
  - File: `src/app.tsx`
  - Change: Input box is always active
  - Show "Stopping previous turn..." during preemption
  - Clear spinner and partial output from killed turn

- [ ] **4.3 Session State Handling**
  - Decide: Save partial messages from killed turn, or discard?
  - Recommendation: Save partial. User's input was valid, partial AI response is context.

**Validation:**
- Start a long operation
- Type a new message while it's running
- Verify old turn is killed, new turn starts immediately
- Verify session state is consistent

### Milestone 5: Integration Testing
**Goal:** Verify all existing features work with new architecture.

- [ ] **5.1 Adaptive Agent Routing**
  - Test: Intent classification still works
  - Test: Skill routing still works
  - Test: Code mode still works

- [ ] **5.2 Memory System**
  - Test: Memory extraction still fires
  - Test: Memory retrieval still works

- [ ] **5.3 Context Compaction**
  - Test: Compaction still triggers at token limit
  - Test: Compaction aborts gracefully on Escape

- [ ] **5.4 Print Mode**
  - Test: `npm start -- --print` still works
  - Test: SIGINT in print mode still aborts

- [ ] **5.5 MCP / LSP**
  - Test: MCP tools still work
  - Test: LSP tools still work

### Milestone 6: Performance & Polish
**Goal:** Ensure no regressions.

- [ ] **6.1 Benchmark**
  - Measure: Turn start latency (should be < 50ms)
  - Measure: Abort latency (should be < 100ms)
  - Measure: Memory usage (should not increase)

- [ ] **6.2 Code Review**
  - Review: All integration points
  - Review: Error handling paths
  - Review: Type safety

- [ ] **6.3 Documentation Update**
  - Update: This plan document with final decisions
  - Update: `KIMI.md` if architecture changes are significant

---

## 6. Integration Point Audit

| Feature | Location | Risk | Mitigation |
|---------|----------|------|------------|
| Adaptive Routing | `app.tsx:2938` | **Low** | Happens before `runAgentTurn`. Supervisor doesn't touch it. |
| `onIterationEnd` / Compaction | `app.tsx:1287` | **Low** | Already checks `signal.aborted`. Receives turn signal. |
| Memory Extraction | `agent/loop.ts:522` | **Very Low** | Fire-and-forget side effect. Harmless if turn killed. |
| Code Mode Sandbox | `agent/loop.ts:456` | **Low** | Receives turn signal. Has own 30s timeout. |
| Session Saving | `app.tsx:1266` | **Medium** | Move `finally` block to `onDone`. Save partial state. |
| Queue Processing | `app.tsx:3338` | **Medium** | Rewrite `useEffect` trigger. Localized change. |
| Print Mode | `index.tsx:276` | **Low** | Can keep direct `await` or use lightweight supervisor. |
| Callback Timing | Various | **Medium** | Verify no callback assumes synchronous `runAgentTurn` stack. |

---

## 7. Logging Strategy

### Purpose
Validate the hypothesis that `runKimi()` / SSE streams are the source of hangs. Also useful for general debugging.

### Implementation

```typescript
// src/util/logger.ts
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
```

### Log Points

| Component | Event | Level |
|-----------|-------|-------|
| `runAgentTurn` | Turn started | info |
| `runAgentTurn` | Turn completed | info |
| `runAgentTurn` | Turn aborted | warn |
| `runAgentTurn` | Turn error | error |
| `runKimi` | HTTP request initiated | debug |
| `runKimi` | First SSE chunk received | debug |
| `runKimi` | Last SSE chunk received | debug |
| `runKimi` | HTTP error | error |
| `readSSE` | `reader.read()` called | debug |
| `readSSE` | `reader.read()` resolved | debug |
| `readSSE` | `reader.read()` timed out | warn |
| `readSSE` | `reader.cancel()` called | debug |
| `bash` | Child process spawned | debug |
| `bash` | Child process exited | debug |
| `bash` | `kill('SIGKILL')` called | warn |
| `executor` | Tool execution started | debug |
| `executor` | Tool execution completed | debug |
| `supervisor` | Phase changed | debug |
| `supervisor` | Turn preempted | info |

### Usage

```bash
# Terminal 1: Run KimiFlare
npm run dev

# Terminal 2: Tail logs
tail -f ~/.config/kimiflare/logs/kimiflare.log
```

---

## 8. Testing Strategy

### Unit Tests
- `AbortScope`: parent abort propagates to children
- `TurnSupervisor`: phase transitions, abort, preemption
- `readSSE`: timeout fires, cancel works
- `bash`: SIGKILL terminates unresponsive process

### Integration Tests
- Full turn: start → streaming → tool → done
- Abort during streaming
- Abort during tool execution
- Preemption: new input kills old turn
- Compaction during turn + abort

### Manual Tests
- `wrangler tail` (infinite command) + Escape
- Large file read + Escape
- Slow API response + Escape
- Rapid Escape presses (debounce)

---

## 9. Milestone Tracker

| Milestone | Status | Date | Notes |
|-----------|--------|------|-------|
| 0: Setup | ✅ Done | 2026-05-07 | Branch created, plan written |
| 1: Emergency Fixes | ✅ Done | 2026-05-07 | Committed as 2678d74 |
| 1.1: Bash SIGKILL | ✅ Done | | `child.kill('SIGKILL')` on abort; removed `signal` from spawn opts |
| 1.2: SSE Zombie Protection | ✅ Done | | `idleTimeoutMs=60s` already existed; added log warning |
| 1.3: Escape Debounce | ✅ Done | | `isAbortingRef` prevents multiple `(interrupted)` lines |
| 1.4: Structured Logging | ✅ Done | | `src/util/logger.ts` writes JSON to stderr |
| 1.5: Log Injection | ✅ Done | | Logs added to loop.ts, client.ts, bash.ts, sse.ts |
| 2: Hierarchical Abort | ✅ Done | 2026-05-07 | Committed as 5465921 |
| 3: Fire-and-Forget Supervisor | 🔄 In Progress | | |
| 4: Preemption Support | ⬜ Pending | | |
| 5: Integration Testing | ⬜ Pending | | |
| 6: Performance & Polish | ⬜ Pending | | |

---

## 10. Open Questions

1. **Should we save partial session state when a turn is preempted?**
   - *Recommendation:* Yes. Partial context is better than lost context.

2. **Should print mode use the supervisor or keep direct `await`?**
   - *Recommendation:* Keep direct `await` for simplicity. Print mode has no queue or TUI.

3. **What should the UI show during preemption?**
   - *Recommendation:* "Stopping previous turn..." for 500ms, then start new turn.

4. **Should we add a "force kill" (double Escape) for truly stuck operations?**
   - *Recommendation:* Yes, as a fallback. Double Escape sends SIGKILL to the process group.

5. **Should the supervisor enforce a maximum turn duration (e.g., 10 minutes)?**
   - *Recommendation:* Yes, as a safety net. Log a warning and auto-abort.

---

## 11. References

- Current `runAgentTurn`: `src/agent/loop.ts`
- Current `app.tsx` process flow: `src/app.tsx`
- Current bash tool: `src/tools/bash.ts`
- Current SSE reader: `src/util/sse.ts`
- Current API client: `src/agent/client.ts`
