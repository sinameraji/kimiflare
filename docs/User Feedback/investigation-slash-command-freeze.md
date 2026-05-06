# Investigation Plan: Slash Command Freeze

> Branch: `investigate-slash-command-freeze`  
> Trigger: Quoc Huy feedback — "slash command but randomly" causes total UI freeze and session loss.  
> Status: Planning phase — no code changes yet.

---

## 1. What We Know

### Symptoms
- TUI becomes "totally unresponsive" — no keyboard input accepted, no rendering updates.
- Freeze is **intermittent**, not deterministic.
- User strongly correlates freezes with **slash command usage** (`/theme`, `/help`, other `/` commands).
- When freeze occurs, the **entire session is lost** — no recovery, no resume.
- Both production and dev builds affected; user perceives prod as "riskier."

### Frequency
- Not every slash command.
- "Once in a while" — suggests race condition, state collision, or async deadlock rather than a pure logic bug.

---

## 2. Slash Command Architecture (Current)

### Flow

```
User types "/" → shouldOpenSlashPicker() → SlashPicker renders
User selects or types command → insertSlashCommand() → submitRef.current(value)
submit() → processMessage() → if (trimmed.startsWith("/")) → handleSlash(trimmed)
handleSlash() → dispatches by command name → sets React state (setEvents, setCfg, setTheme, etc.)
```

### Key Components

| File | Role |
|------|------|
| `src/app.tsx` | `handleSlash()` — main dispatcher. ~400 lines of imperative state mutations. |
| `src/ui/slash-picker.tsx` | Renders filtered command list. Pure component, no async. |
| `src/ui/text-input.tsx` | `CustomTextInput` — captures keystrokes, calls `onSubmit`. |
| `src/commands/builtins.ts` | Static list of built-in commands. |

### State Surfaces Touched by Slash Commands

- `setEvents` — appends info/error/memory events to chat log.
- `setCfg` — mutates config (theme, gateway, effort, etc.).
- `setTheme` / `setShowThemePicker` — theme switching.
- `setMode` — agent mode switching.
- `setBusy` / `setTurnStartedAt` — agent turn lifecycle.
- `messagesRef.current` — direct mutation of message array.
- `sessionIdRef.current` — session identity.
- `saveConfig()` — async file I/O, fire-and-forget.
- `saveSessionSafe()` — async session persistence.

### Critical Observation

`handleSlash` is a **synchronous function** that returns `boolean`. However, several branches inside it:
1. Trigger **async side effects** (`void saveConfig(...)`, `void getCostReport(...).then(...)`).
2. Mutate **refs and state** in the same tick.
3. Are called from `processMessage`, which is `async` and runs agent turns.

There is **no explicit synchronization** between slash command state mutations and the agent turn loop.

---

## 3. Hypotheses (Ranked by Likelihood)

> **CRITICAL UPDATE (2026-05-06):** Reproduction attempt revealed the "freeze" is actually **V8 garbage collector thrashing followed by heap exhaustion (OOM)**. The process allocates memory rapidly until it hits Node's ~4GB heap limit, becomes unresponsive during GC, then crashes. This invalidates pure deadlock hypotheses (H1, H5) and points to a **memory leak** triggered by the interrupt → modal flow.

---

### H1: Memory Leak — Agent Turn Callbacks Continue After Interrupt
**Likelihood: HIGH**

When Escape is pressed, `activeControllerRef.current.abort()` is called. However, `runAgentTurn` may not immediately stop:
- `fetch` with AbortSignal may take time to propagate.
- Tool executions (bash, read, glob) may not check the signal and continue running.
- Callbacks (`onTextDelta`, `onToolResult`) may keep firing even after `finally` block sets `activeControllerRef.current = null`.

If callbacks fire while the theme picker is open (early return branch), `setEvents` is called repeatedly on a component tree that no longer renders the chat log. React still processes these state updates, creating new arrays that accumulate before GC can reclaim them.

**Why 4GB?** If the agent was streaming a large response (e.g., competitor analysis with many tool calls), each `updateAssistant` → `flushAssistantUpdates` → `setEvents` cycle copies the entire `events` array. With thousands of events, each copy is megabytes. Rapid successive copies exhaust the heap.

**Why intermittent?** Depends on whether the agent was in a tool-heavy phase when interrupted. Simple text streaming may not allocate enough to hit the limit.

---

### H2: `pendingTextRef` / `flushTimeoutRef` Accumulation
**Likelihood: MEDIUM-HIGH**

`updateAssistant` batches text deltas in `pendingTextRef` and schedules a 16ms flush timeout. On interrupt:
1. `finally` block calls `updateAssistant(asstId, () => ({ streaming: false }))`.
2. This checks `flushTimeoutRef.current` — if pending, it clears and flushes immediately.
3. But if the timeout already fired and `flushAssistantUpdates` is running, a race condition may leave `pendingTextRef` in an inconsistent state.

If `flushAssistantUpdates` is called recursively or multiple times in quick succession (e.g., from both the finally block and a lingering callback), it could create duplicate `events` arrays.

**Evidence needed:** Add logging to `flushAssistantUpdates` to count how many times it fires after an interrupt.

---

### H3: Theme Picker / Modal State Collision (Revised)
**Likelihood: MEDIUM**

The early-return pattern for modals (`if (showThemePicker) return <ThemePicker />`) unmounts the entire chat tree. However:
- `useInput` hooks from the parent may not be fully cleaned up before the modal's `useInput` activates.
- If both handlers process the same keystroke, they could trigger competing state updates.
- `SelectInput` from `ink-select-input` may re-render in a tight loop if props change rapidly.

**Why less likely after OOM finding?** A render loop would cause high CPU, not necessarily 4GB heap growth. But if the loop involves cloning large arrays (e.g., `items` for `SelectInput`), it could contribute.

---

### H4: `/clear` Does Not Fully Release Memory
**Likelihood: MEDIUM**

The user ran `/clear` between reproduction attempts. `/clear` does:
```ts
setEvents([]);
messagesRef.current = [messagesRef.current[0]!];
artifactStoreRef.current = new ArtifactStore();
executorRef.current.clearArtifacts();
```

But it does NOT clear:
- `pendingToolCallsRef.current` — may still hold references to tool call objects.
- `sessionStateRef.current` — reset to empty, but old nested objects may be retained by closures.
- `pendingTextRef.current` — Map of assistant text deltas.

If old `events` arrays are referenced by closures in async callbacks or React's time-slicing, they may not be GC'd even after `setEvents([])`.

---

### H5: Tool Result Buffering Leak
**Likelihood: LOW-MEDIUM**

Tools like `read`, `glob`, and `bash` may return large strings (file contents, directory listings). These are stored in:
- `messagesRef.current` (as tool result messages)
- `events` state (as `tool` events with `result` field)
- `executorRef.current` artifacts

If `/clear` or interrupt does not truncate these results, and subsequent turns append more, memory grows monotonically.

**Why less likely?** `/clear` resets `events` and `messagesRef`. But if the leak is in a ref not cleared by `/clear`, it persists.

---

## 4. Investigation Steps

### Step 1: Confirm OOM with Memory Logging ✅ DONE
Reproduced Scenario B (prompt → Escape → `/themes`). Process crashed with:
```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```
Heap reached ~4GB before crash. Theme picker rendered successfully before freeze.

**Next:** Add `process.memoryUsage()` logging to `app.tsx` to track heap growth in real-time.

### Step 2: Identify Leak Source — Callback Survival After Interrupt
Add logging to:
- `onTextDelta` callback — count calls after `activeControllerRef.current` is set to `null`.
- `onToolResult` callback — count calls after interrupt.
- `flushAssistantUpdates` — count invocations and log `pendingTextRef.current.size`.

Hypothesis: Agent callbacks continue firing after interrupt, causing repeated `setEvents` calls that clone large arrays.

### Step 3: Test with Increased Heap Limit
Run with:
```bash
node --max-old-space-size=8192 $(which tsx) src/index.tsx
```
If the freeze lasts longer but still eventually crashes, the leak is unbounded. If it stabilizes, the leak is bounded but exceeds default heap.

### Step 4: Audit `/clear` Memory Release
After `/clear`, check if old `events` arrays are retained:
- Use `--inspect` flag and Chrome DevTools Memory tab.
- Take heap snapshot before `/clear`, after `/clear`, and after reproducing freeze.
- Look for retained `ChatEvent[]` arrays.

### Step 5: Test Other Modals
Reproduce with `/help`, `/resume`, `/lsp config` instead of `/themes`.
If all modals trigger OOM, the leak is in the interrupt → modal transition, not theme-specific.
If only `/themes` triggers it, investigate `ThemePicker` and `ink-select-input`.

### Step 6: Profile with clinic.js
```bash
npx clinic doctor -- node --max-old-space-size=4096 $(which tsx) src/index.tsx
```
Reproduce freeze, then analyze the clinic output for:
- Event loop blockages
- Memory allocation patterns
- GC pressure spikes

---

## 5. Decision Gates

| Gate | Question | If Yes | If No |
|------|----------|--------|-------|
| G1 | Does heap grow monotonically after interrupt? | H1 (leaking callbacks) is likely. | Look at H2, H4. |
| G2 | Does `--max-old-space-size=8192` prevent crash? | Leak is bounded; H4 (accumulated state) is likely. | Leak is unbounded; H1 (infinite callback loop) is likely. |
| G3 | Do other modals (`/help`, `/resume`) also OOM? | Leak is in interrupt → modal transition (H1/H2). | Leak is theme-specific (H3). |
| G4 | Do callbacks (`onTextDelta`, `onToolResult`) fire after `activeControllerRef.current = null`? | H1 is confirmed. | Look at H2, H4. |
| G5 | Does heap snapshot show retained `ChatEvent[]` arrays after `/clear`? | H4 (`/clear` incomplete) is likely. | Look at H1, H2. |

---

## 6. What We Will NOT Do in This Branch

- No fixes.
- No refactoring of `handleSlash`.
- No new features (session checkpointing, AGENT.md, etc.).

This branch is for **intelligence gathering only**.

---

*Last updated: 2026-05-06 (post-reproduction — OOM confirmed, not deadlock)*
