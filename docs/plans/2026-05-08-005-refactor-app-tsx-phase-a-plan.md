---
title: Extract Remaining Agent Logic from app.tsx — RunInit, Callbacks, ProcessMessage, Input
type: refactor
status: active
date: 2026-05-08
origin: docs/plans/2026-05-08-004-refactor-app-tsx-remaining-work-plan.md
---

# Extract Remaining Agent Logic from app.tsx — RunInit, Callbacks, ProcessMessage, Input

## Overview

Continue the proven extraction pattern from the current session: move function bodies out of `src/app.tsx` into standalone typed modules in `src/app/`, keep thin `useCallback` wrappers in App.

Target: reduce `app.tsx` from **3,112 lines → ~1,800 lines** by extracting:

1. `runInit` (~370 lines)
2. Shared `AgentCallbacks` builder (~200 lines, deduplicates `processMessage` + `runInit`)
3. `processMessage` + `submit` (~350 lines after deduplication)
4. Picker state + `useInput` handler (~330 lines)

## Problem Frame

`app.tsx` still contains the core agent turn logic — `processMessage` (743 lines) and `runInit` (372 lines) — which share ~80% identical callback shapes. Both construct massive `AgentCallbacks` objects inline, making the file hard to navigate and creating real duplication.

The picker/input logic (~330 lines of effects + callbacks) is also self-contained but lives inline.

## Requirements Trace

- R1. No behavioral changes — all 327 existing tests pass.
- R2. Cross-domain communication stays explicit and typed (context interface pattern).
- R3. Preserve all `useRef` imperative patterns.
- R4. Each extraction must pass `typecheck`, `test`, `lint`, `build` before proceeding.

## Scope Boundaries

- Extract function bodies only; App keeps thin `useCallback` wrappers.
- JSX render block (~420 lines) stays in `app.tsx` — it is the composition shell.
- No custom hooks (proven pattern is plain async functions with typed context).
- No changes to `agent/loop.ts`, `tools/executor.ts`, or subsystems.

### Deferred to Follow-Up Work

- Extracting the JSX render block into smaller components (requires design decisions on prop drilling).
- Converting remaining `useRef` patterns to reactive state.

## Context & Research

### Proven Pattern (9 successful extractions)

For each extraction:

1. Define typed `*Ctx` interface in new module.
2. Copy function body, replace closure captures with `ctx.field` dereferences.
3. Add `import` in `app.tsx`.
4. Replace body with a one-line call passing the context object.
5. Verify: `typecheck`, `test`, `lint`, `build`.

### Relevant Code

- `src/app.tsx` lines 1263–1633: `runInit`
- `src/app.tsx` lines 1857–2599: `processMessage`
- `src/app.tsx` lines 2135–2320: `sharedCallbacks` (inside `processMessage`)
- `src/app.tsx` lines 2316: `cleanupTurn` (inside `processMessage`)
- `src/app.tsx` lines 2608–2666: `submit`
- `src/app.tsx` lines 553–733: picker effects + callbacks
- `src/app.tsx` lines 1127–1220: `useInput` handler
- Existing extracted files in `src/app/` follow the same pattern.

### Key Insight: Callback Duplication

`runInit` and `processMessage` both build `AgentCallbacks` with:

- `onAssistantStart`, `onReasoningDelta`, `onTextDelta`, `onAssistantFinal`
- `onToolCallFinalized`, `onToolResult`
- `onUsage`, `onUsageFinal`, `onGatewayMeta`
- `askPermission`
- `onKimiMdStale`

Extracting a `buildSharedCallbacks(ctx)` function removes ~200 lines of duplication.

## Key Technical Decisions

- **Plain functions over hooks**: The 9 previous extractions used this pattern and all passed. Hooks would require hoisting refs and risking identity bugs.
- **Context objects over long param lists**: Each function receives one typed `ctx` object. This keeps call sites readable and lets TypeScript verify completeness.
- **Shared callbacks before processMessage**: Extract the shared builder first so `processMessage` and `runInit` can both call it, avoiding duplication.

## Open Questions

### Resolved During Planning

- **Should the JSX render block be extracted?** No. It's the composition shell; extracting would add wrappers with no value.
- **Should processMessage and runInit share callbacks?** Yes. They share ~80% of callback shape. Extract once, call from both.

### Deferred to Implementation

- Exact `*Ctx` interface field names depend on what each closure actually captures. The implementer derives these by inspecting the body.
- Whether `cleanupTurn` should be shared or kept local to `processMessage` — decide once callback builder is in place.

## Implementation Units

- U1. **Extract `runInit` to `src/app/agent-turn.ts`**

**Goal:** Move the `/init` command implementation out of `app.tsx`.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**

- Create: None (append to existing `src/app/agent-turn.ts`)
- Modify: `src/app.tsx`
- Test: existing tests cover `/init` behavior

**Approach:**

- Define `RunInitCtx` interface in `src/app/agent-turn.ts`.
- Move `runInit` body into `runInitFn(ctx)`.
- Replace `runInit` body in `app.tsx` with thin `useCallback` wrapper calling `runInitFn({ ...ctx })`.
- At this stage, `runInit` still builds its own callbacks inline (will be deduplicated in U2).

**Patterns to follow:**

- Same pattern as `runCompact` extraction (commit `d6326cf`).

**Test scenarios:**

- Happy path: `npm test` still passes, `npm run typecheck` 0 errors.
- Integration: `/init` command in dev mode generates KIMI.md successfully.

**Verification:**

- `npm run typecheck` passes
- `npm test` passes
- `npm run lint` passes
- `npm run build` passes

---

- U2. **Extract shared `AgentCallbacks` builder**

**Goal:** Deduplicate callback construction between `processMessage` and `runInit`.

**Requirements:** R1, R2

**Dependencies:** U1

**Files:**

- Modify: `src/app/agent-turn.ts` (add `buildAgentCallbacks`)
- Modify: `src/app.tsx` (use builder in `runInit` and `processMessage`)

**Approach:**

- Inside `processMessage`, the `sharedCallbacks` object spans ~180 lines. Extract it to `buildAgentCallbacks(ctx: AgentCallbacksCtx)`.
- `AgentCallbacksCtx` needs: `nextAssistantId`, `activeAsstIdRef`, `setTurnPhase`, `setLastActivityAt`, `setEvents`, `updateAssistant`, `updateTool`, `setCurrentToolName`, `pendingToolCallsRef`, `usageRef`, `setUsage`, `setSessionUsage`, `ensureSessionId`, `cfg`, `cloudToken`, `cloudDeviceId`, `initialCloudToken`, `initialCloudDeviceId`, `gatewayMetaRef`, `setGatewayMeta`, `permResolveRef`, `limitResolveRef`, `setOverlay`, `modeRef`, `kimiMdStaleNudgedRef`, `setKimiMdStale`, `tasksRef`, `setTasks`, `setTasksStartedAt`, `setTasksStartTokens`, `mkKey`, `updateGatewayMeta`, `recordUsage`, `gatewayUsageLookupFromConfig`, `getCostReport`, `fetchCloudUsage`, `isBlockedInPlanMode`, `isReadOnlyBash`.
- Also extract `cleanupTurn` if it can be shared; otherwise keep it in `processMessage`.

**Patterns to follow:**

- The builder returns a plain object, not a hook or class.

**Test scenarios:**

- Happy path: Both `/init` and normal chat use the same callbacks. `npm test` passes.
- Edge case: Abort during `/init` or chat still calls `cleanupTurn` correctly.

**Verification:**

- `npm run typecheck` passes
- `npm test` passes
- `npm run lint` passes
- `npm run build` passes
- Manual smoke: send a message, run `/init`, verify both complete

---

- U3. **Extract `processMessage` and `submit` to `src/app/process-message.ts`**

**Goal:** Move the core chat turn body out of `app.tsx`.

**Requirements:** R1, R2, R3

**Dependencies:** U2

**Files:**

- Create: `src/app/process-message.ts`
- Modify: `src/app.tsx`
- Test: existing tests cover chat flow

**Approach:**

- After U2, `processMessage` body shrinks from ~743 to ~350 lines (callbacks removed).
- Remaining logic: custom command rendering, image encoding, memory recall, skill routing, session title, system prompt injection, turn setup, `supervisorRef.current.startTurn` call.
- `submit` (~59 lines) is small and directly adjacent; put it in the same file.
- Define `ProcessMessageCtx` and `SubmitCtx` interfaces.

**Patterns to follow:**

- Same pattern as `session-helpers.ts` and `agent-turn.ts`.

**Test scenarios:**

- Happy path: `npm test` passes.
- Integration: Normal chat message flows through without error.
- Edge case: Image upload, custom command, queued message, preempt turn.

**Verification:**

- `npm run typecheck` passes
- `npm test` passes
- `npm run lint` passes
- `npm run build` passes

---

- U4. **Extract picker logic + `useInput` handler to `src/app/input-coordinator.ts`**

**Goal:** Move all keyboard and picker handling out of `app.tsx`.

**Requirements:** R1, R2

**Dependencies:** None (can run in parallel with U1-U3, but simpler to do after)

**Files:**

- Create: `src/app/input-coordinator.ts`
- Modify: `src/app.tsx`

**Approach:**

- Extract `handlePickerUp`, `handlePickerDown`, `handlePickerSelect`, `handlePickerCancel`.
- Extract four `useEffect` hooks that manage picker open/close/clamping.
- Extract `useInput` body into `handleKeyboard(ctx, inputChar, key)`.
- Define `InputCoordinatorCtx` with: all picker state setters, `busyRef`, `activeScopeRef`, `isAbortingRef`, `supervisorRef`, `permResolveRef`, `limitResolveRef`, `setOverlay`, `sessionScopeRef`, `setEvents`, `setTasks`, `setTasksStartedAt`, `setTasksStartTokens`, `tasksRef`, `setQueue`, `setShowReasoning`, `setMode`, `setVerbose`, `saveSessionSafe`, `submitRef`, `setInput`, `setHistoryIndex`, `setDraftInput`, `modeRef`, `exit`, `lspManagerRef`, `mkKey`, `overlay`, `commandWizard`, `showLspWizard`, `resumeSessions`, `checkpointSession`, `cursorOffset`, `lastEscapeAtRef`.

**Patterns to follow:**

- Same pattern as `commands-init.ts` and `session-helpers.ts`.

**Test scenarios:**

- Happy path: `@` opens file picker, `/` opens slash picker, arrow keys navigate, Enter selects.
- Edge case: Picker auto-closes when cursor moves before anchor.
- Integration: Ctrl+C aborts turn, Escape interrupts, Shift+Tab cycles mode.

**Verification:**

- `npm run typecheck` passes
- `npm test` passes
- `npm run lint` passes
- `npm run build` passes

---

## System-Wide Impact

- **Import graph:** `app.tsx` imports from `src/app/agent-turn.ts`, `src/app/process-message.ts`, `src/app/input-coordinator.ts`. No circular dependencies expected.
- **Ref lifecycle:** All refs stay created in `app.tsx` and are passed into extracted functions. This preserves React ref identity.
- **Unchanged invariants:** `agent/loop.ts`, `tools/executor.ts`, `memory/manager.ts`, `lsp/manager.ts`, `mcp/manager.ts` are untouched. Their interfaces are consumers, not subjects.

## Risks & Dependencies

| Risk                                                | Mitigation                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Callback builder signature mismatch                 | TypeScript catches this — the `AgentCallbacksCtx` interface is the contract. |
| `nextAssistantId` module counter lost in extraction | Pass as mutable ref (`nextAssistantIdRef`) in the context.                   |
| useCallback dependency arrays become stale          | Each extracted function returns nothing — App's wrappers stay stable.        |
| `processMessage` is deeply coupled to 20+ refs      | Context object pattern handles this cleanly; proven across 9 extractions.    |
| Any phase breaks tests                              | Stop and fix before proceeding. Each phase is independent.                   |

## Phased Delivery

### Phase 1

- U1: Extract `runInit`

### Phase 2

- U2: Extract shared `AgentCallbacks` builder

### Phase 3

- U3: Extract `processMessage` + `submit`

### Phase 4

- U4: Extract picker + `useInput`

Each phase runs the full verification suite before proceeding.

## Documentation / Operational Notes

- Update `KIMI.md` if it references `app.tsx` architecture.
- No user-facing changes.

## Sources & References

- **Origin document:** docs/plans/2026-05-08-004-refactor-app-tsx-remaining-work-plan.md
- **Parent plan:** docs/plans/2026-05-08-003-refactor-decompose-app-tsx-plan.md
- Target file: `src/app.tsx` (3,112 LOC)
- Existing pattern: `src/app/agent-turn.ts` (runCompact), `src/app/session-helpers.ts`, `src/app/commands-init.ts`
