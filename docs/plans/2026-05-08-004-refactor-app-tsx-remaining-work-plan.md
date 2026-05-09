# Remaining app.tsx Decomposition — Updated Plan

type: refactor  
status: draft  
date: 2026-05-08  
origin: Session on 2026-05-08, user requested plan-before-code

---

## Current State

`src/app.tsx` is **3,112 lines** (down from ~4,972 at start of session).

Already extracted:

| Unit                     | Lines removed | File created                 |
| ------------------------ | ------------- | ---------------------------- |
| Pure utilities           | ~450          | `src/util/*.ts` (6 files)    |
| MCP/LSP init             | ~180          | `src/app/mcp-lsp-init.ts`    |
| Compaction callback      | ~100          | `src/app/compaction.ts`      |
| Command init             | ~95           | `src/app/commands-init.ts`   |
| UI updaters              | ~88           | `src/app/ui-updates.ts`      |
| `handleSlash` dispatcher | ~1,400        | `src/app/slash-commands.ts`  |
| Session helpers          | ~200          | `src/app/session-helpers.ts` |
| Command save/delete      | ~60           | `src/app/commands-init.ts`   |
| `runCompact`             | ~120          | `src/app/agent-turn.ts`      |

All verification passes: `typecheck` (0 errors), `test` (327 pass), `lint` (0 issues), `build` (success).

---

## Remaining Unextracted Logic

Listed by line count and extraction feasibility:

| Block                      | Lines | Description                                                                                             | Extraction Feasibility                                                |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `processMessage`           | 743   | Core turn: image encoding, skill routing, `runAgentTurn` with massive callbacks, onDone/onError cleanup | **Medium** — requires ~20-param context, but body is self-contained   |
| `runInit`                  | 372   | `/init` command: `runAgentTurn` with callbacks, KIMI.md write, memory refresh                           | **High** — nearly identical callback shape to processMessage          |
| Picker effects + callbacks | ~236  | File/slash picker open/close logic, filtering, selection                                                | **High** — uses stable refs, cross-cuts input + events only           |
| `useInput` handler         | 94    | Ctrl+C (abort/exit), Escape (interrupt), Ctrl+R (reasoning toggle), Shift+Tab (mode), Ctrl+O (verbose)  | **High** — reads/sets many refs; thin wrapper with context works      |
| `submit`                   | 59    | Preemption, queueing, history append, processMessage call                                               | **High** — depends on busyRef, processMessage, but small              |
| JSX render block           | ~420  | Conditional renders (onboarding, pickers, overlays, chat, status bar, input)                            | **Low** — this IS the composition shell; extracting would fragment UI |

### What's _NOT_ Worth Extracting

The JSX render block (~420 lines) is the **composition shell** — it maps state to components. Extracting it would create wrapper components that just forward props, adding indirection without value. The original plan target of `app.tsx < 300 lines` assumed full hook-based decomposition. The actual pattern that worked was "extract implementation body to plain function." With this pattern, the realistic floor is ~600–800 lines (state declarations + thin wrappers + JSX shell).

---

## Proposed Approach

Continue the **proven pattern**: extract function bodies to standalone async functions with typed context interfaces. Keep thin `useCallback` wrappers in App.

### Option A: Extract runInit + processMessage + submit + picker + useInput (recommended)

Target: `app.tsx` drops from **3,112 → ~1,800–2,000 lines**.

#### A1. Extract `runInit` → `src/app/agent-turn.ts` (~370 lines)

- Already adjacent to `runCompact` in same file.
- `runInit` does one thing: runs `runAgentTurn` to generate KIMI.md.
- Create `RunInitCtx` interface, mirror pattern of `RunCompactCtx`.
- **Risk**: `runInit` and `processMessage` share ~80% of the same callback setup. Extracting both separately creates duplication.

#### A2. Extract shared `runAgentTurn` callback builder (~60% of processMessage + runInit)

- Both `processMessage` and `runInit` build massive `AgentCallbacks` objects.
- Extract `buildAgentCallbacks(ctx)` that returns the shared callbacks.
- This is the **highest-value extraction** — it removes ~400 lines of duplication.
- **Risk**: Callbacks reference `nextAssistantId` (module-level counter). Need to pass as mutable ref or parameter.

#### A3. Extract `processMessage` body → `src/app/process-message.ts` (~743 lines minus shared callbacks)

- Remaining logic: custom command rendering, image encoding, memory recall, skill routing, session title, system prompt injection.
- After A2, this drops to ~350 lines.
- `ProcessMessageCtx` interface with ~12 parameters.

#### A4. Extract `submit` → `src/app/process-message.ts` (~59 lines)

- Small, directly adjacent to `processMessage`. Keep in same file.

#### A5. Extract picker + `useInput` → `src/app/input-coordinator.ts` (~330 lines)

- Four `handlePicker*` callbacks + four `useEffect` hooks for picker clamping/closing.
- `useInput` body reads many refs but only sets a few things.
- Can be extracted as `handleKeyboard(ctx, inputChar, key)`.

### Option B: Stop here (~3,112 lines)

Argument: The remaining logic is tightly coupled to React state lifecycle. `processMessage` is not a pure function — it's a closure over 20+ refs and state setters. Extracting it as a plain function creates a massive context object. The code is now navigable:

- Lines 1–600: State/refs + init effects
- Lines 600–900: Picker logic
- Lines 900–1200: Config/session helpers
- Lines 1200–1700: Agent turn (init, compact)
- Lines 1700–1900: Resume/checkpoint/theme
- Lines 1900–2700: processMessage + submit
- Lines 2700–3100: JSX

Each section is now a scrollable unit. The original plan's hook-based coordinator approach was the right architecture for a greenfield build; applying it retroactively to working code may not be worth the regression risk.

### Option C: Custom hooks (original plan)

Refactor remaining state into four React hooks:

- `useSessionCoordinator` — sessionIdRef, saveSessionSafe, checkpoint state
- `useAgentCoordinator` — busy, turnPhase, tasks, processMessage, runInit, runCompact
- `useInputCoordinator` — input, activePicker, history, submit
- `useSettingsCoordinator` — cfg, theme, lsp, mcp, cloud

**Not recommended** at this stage because:

1. Requires hoisting refs from App into hooks — risky identity changes.
2. `processMessage` needs `messagesRef`, `supervisorRef`, `executorRef`, `artifactStoreRef`, `sessionStateRef` — all passed through. That's a lot of plumbing.
3. Hooks would need stable callback references or risk infinite loops. The current `useCallback` dependencies are already carefully tuned.
4. The codebase has no precedent for multi-hundred-line custom hooks. This pattern would be novel to the codebase.

---

## Risk Matrix

| Approach               | Lines saved  | Regression risk | Test burden                                 | Value                           |
| ---------------------- | ------------ | --------------- | ------------------------------------------- | ------------------------------- |
| A1 + A2 + A3 + A4 + A5 | ~1,100–1,300 | Medium-High     | Must verify chat + init + picker + keyboard | High                            |
| A1 + A2 only           | ~500         | Medium          | Chat + init                                 | Medium-High                     |
| A1 only                | ~370         | Low             | `/init` smoke                               | Medium                          |
| Option B (stop)        | 0            | Zero            | None                                        | (baseline)                      |
| Option C (hooks)       | ~1,200       | High            | Full regression required                    | Medium (architecture debt only) |

---

## Recommended Default

**Option A, phases:**

1. **Phase 1**: Extract `runInit` (A1) — lowest risk, proven pattern.
2. **Phase 2**: Extract shared callback builder (A2) — deduplicates processMessage + runInit.
3. **Pause + verify**: Run full tests, manual smoke. If clean, continue.
4. **Phase 3**: Extract `processMessage` body minus shared callbacks (A3) + `submit` (A4).
5. **Phase 4**: Extract picker + `useInput` (A5).
6. **Final verify**: All checks green.

This delivers **~1,100–1,300 lines removed** with staged risk. If any phase breaks, we stop and fix before proceeding.

---

## Verification After Each Phase

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- Manual smoke (if available): `/init`, normal chat, `/compact`, picker, keyboard shortcuts

---

## Acceptance Criteria

- `app.tsx` < 2,000 lines (from 3,112)
- Zero behavioral changes
- All existing tests pass
- No new dependencies
- No custom hook architecture (keeps proven pattern)
