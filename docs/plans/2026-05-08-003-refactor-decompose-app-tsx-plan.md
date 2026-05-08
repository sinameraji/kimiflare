---
title: Decompose the app.tsx God Component into Domain Coordinators
type: refactor
status: active
date: 2026-05-08
deepened: 2026-05-08
origin: code-overhaul-review Section 1A (app.tsx Architecture issue)
---

# Decompose the app.tsx God Component into Domain Coordinators

## Overview

`src/app.tsx` is 4,054 lines — 14% of the entire source code. It mixes six distinct responsibilities inside a single React component. This plan extracts each responsibility into a focused, independently testable module, leaving `App` as a thin composition shell.

---

## Problem Frame

`app.tsx` currently contains:

1. **15 top-level utility functions** (`buildFilePickerIgnoreList`, `detectGitHubRepo`, `findImagePaths`, etc.) — pure logic exported from a component file
2. **TUI state machine** — 45 `useState` hooks for overlays, pickers, modes, themes, tasks
3. **Business orchestration** — TurnSupervisor wiring, `runAgentTurn` callbacks, permission flows, memory integration, compaction
4. **Input handling** — `useInput` keyboard routing, file/slash picker logic, history, cursor management
5. **Configuration & subsystem init** — MCP, LSP, memory manager, custom commands, theme loading, update checking
6. **Session lifecycle** — save/load/resume, serialization, artifact store, checkpoint management

Every UI-only change requires reading through agent logic. Every business logic bug surfaces inside Ink JSX. Adding new features means bolting onto an already unnavigable surface. The `deletion test` fails: deleting `app.tsx` would eliminate ~40% of the product at once, proving subsystems are shallow (they delegate to app.tsx to be useful).

---

## Requirements Trace

- R1. `app.tsx` drops below 300 lines (thin composition shell).
- R2. Each extracted coordinator is independently testable without Ink rendering.
- R3. No behavioral changes — all existing tests pass without modification.
- R4. Cross-domain communication is explicit and typed (not closure-captured magic).
- R5. Existing `useRef` patterns for imperative coordination (TurnSupervisor, AbortScope) are preserved.

---

## Scope Boundaries

- No changes to the JSX component tree or user-facing behavior.
- No changes to `agent/loop.ts`, `tools/executor.ts`, or other subsystems.
- No introduction of external state management libraries (Zustand, Redux, etc.). React hooks are sufficient.
- No refactoring of `index.tsx` print mode (already planned separately).

### Deferred to Follow-Up Work

- Convert remaining `useRef` imperative patterns to reactive state where practical.
- Add comprehensive integration tests for full chat flow.
- Evaluate React Context vs. props drilling for deeply nested UI components.

---

## Context & Research

### Relevant Code and Patterns

- `src/app.tsx` — the monolith (4,054 LOC, 139 commits).
- `src/agent/supervisor.ts` — already creates a real seam around turn execution. Expand this pattern.
- `src/util/abort-scope.ts` — good cancellation primitive. Used by agent coordinator.
- `src/ui/chat.tsx` — consumes `ChatEvent[]`. The event stream is the primary cross-domain seam.

### Existing Patterns to Follow

- **Custom hooks**: The codebase already uses `useState`, `useRef`, `useCallback`, `useEffect` extensively. Extracted coordinators should be custom hooks, not classes or context providers, to minimize learning curve.
- **Ref coordination**: `TurnSupervisor`, `AbortScope`, `ToolExecutor`, `McpManager` are all managed via refs. Preserve this for the agent coordinator.
- **Event append pattern**: Cross-domain communication currently happens via `setEvents((e) => [...e, newEvent])`. The extracted hooks will accept an `appendEvent` callback.

---

## Key Technical Decisions

1. **Coordinator = custom hook, not class or context**: Hooks are the native React pattern already used. They compose naturally. No new abstraction needed.
2. **Cross-domain communication via typed callbacks, not event bus**: The simplest seam is `appendEvent: (event: ChatEvent) => void` and `safeSave: (operation: string, promise: Promise<unknown>) => void`. Each hook receives these from App. This makes dependencies explicit and testable.
3. **Preserve refs for imperative objects**: `supervisorRef`, `executorRef`, `messagesRef`, `sessionStateRef`, `artifactStoreRef` stay as refs within their coordinator hooks. This avoids massive `useMemo`/`useCallback` churn.
4. **Extract pure utilities FIRST**: The 15 exported helper functions (`buildFilePickerIgnoreList`, `detectGitHubRepo`, etc.) move out of app.tsx immediately. This alone removes ~450 lines with zero risk.

---

## Open Questions

### Resolved During Planning

- **Should we use React Context?** No. The tree depth between App and consumers is shallow (1-2 levels). Props + hooks are sufficient. Context adds indirection without solving a real props-drilling problem here.
- **Should coordinators own their own React state?** Yes. Each coordinator hook returns its state values and setters. App spreads them into JSX. This preserves the existing reactivity model.

### Deferred to Implementation

- Exact callback signatures for cross-domain seams may need tuning once code is in motion.
- Whether to fully extract `useInput` handler into InputCoordinator or keep a thin switch in App (decided during U4).

---

## Output Structure

```
src/
  app.tsx                           ← thin shell (<300 lines)
  app/
    use-session-coordinator.ts      ← session ID, save/load, artifact store
    use-agent-coordinator.ts        ← turn lifecycle, permissions, tool exec
    use-input-coordinator.ts        ← keyboard, pickers, commands, history
    use-settings-coordinator.ts     ← config, theme, LSP, MCP, remote
  util/
    file-picker.ts                  ← buildFilePickerIgnoreList, filterPickerItems, etc.
    git-detect.ts                   ← detectGitHubRepo, detectGitBranch
    image-paths.ts                  ← findImagePaths
    token-format.ts                 ← formatTokens
    event-helpers.ts                ← capEvents, compactEventsVisual, mkKey
```

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
Before (monolith):
┌─────────────────────────────────────────────────────┐
│                    app.tsx (4,054 LOC)               │
│  ┌──────────┬──────────┬──────────┬──────────┐      │
│  │  TUI     │  Agent   │  Input   │ Session  │      │
│  │  State   │  Logic   │  Logic   │  Logic   │      │
│  │  (45+    │  (turn   │  (picker,│  (save/  │      │
│  │   hooks) │  supv)   │  kb)     │  load)   │      │
│  └──────────┴──────────┴──────────┴──────────┘      │
│  ┌──────────┬──────────┬──────────┐                 │
│  │  Utils   │  Settings│  Config  │                 │
│  │  (15 fns)│  (theme, │  (MCP,   │                 │
│  │          │  LSP)    │  init)   │                 │
│  └──────────┴──────────┴──────────┘                 │
└─────────────────────────────────────────────────────┘

After (coordinators):
┌─────────────────────────────────────────────────────┐
│                    app.tsx (<300 LOC)                │
│  ┌──────────────────┬──────────────────┐            │
│  │ useSessionState  │ useAgentOrchestrator            │
│  │ useInputManager  │ useSettingsManager │            │
│  └──────────────────┴──────────────────┘            │
│              ↕  typed callbacks                      │
│  ┌─────────────────────────────────────┐            │
│  │        ChatEvent append pipeline    │            │
│  └─────────────────────────────────────┘            │
│              ↕  JSX render                          │
│  ┌──────────────────────────────────────────────┐   │
│  │  ThemeProvider > Box > ChatView | Overlays   │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  util/ (pure helpers, ~15 functions)         │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## Implementation Units

- U1. **Extract pure utility functions from app.tsx to util/**

**Goal:** Remove ~450 lines of pure functions from app.tsx into focused utility modules. Zero behavioral change.

**Requirements:** R3

**Dependencies:** None

**Files:**

- Create: `src/util/file-picker.ts` — `buildFilePickerIgnoreList`, `filterPickerItems`
- Create: `src/util/git-detect.ts` — `detectGitHubRepo`, `detectGitBranch`
- Create: `src/util/image-paths.ts` — `findImagePaths`
- Create: `src/util/token-format.ts` — `formatTokens`
- Create: `src/util/recent-files.ts` — `trackRecentFile`
- Create: `src/util/event-helpers.ts` — `capEvents`, `compactEventsVisual`, `mkKey`, `makePrefixMessages`
- Modify: `src/app.tsx` — remove function bodies, update imports

**Approach:**

1. For each function: copy body to new file, add export, update import in app.tsx.
2. `mkKey` uses a module-level counter — make it a factory function or keep module-level state.
3. Verify no closures capture app.tsx state (they don't — all are pure).

**Execution note:** Characterization tests first: run existing tests, verify they pass, then move code.

**Test scenarios:**

- **Happy path**: `npm test` still passes after all utility moves.
- **Integration**: `npm run typecheck` shows zero errors.

**Verification:**

- `npm test` passes
- `npm run typecheck` passes
- `app.tsx` line count drops by ~450 lines

---

- U2. **Extract `useSessionCoordinator` hook**

**Goal:** Encapsulate session lifecycle (ID generation, save/load, serialization, artifact store, checkpoints, resume) into a custom hook.

**Requirements:** R1, R2, R4

**Dependencies:** U1

**Files:**

- Create: `src/app/use-session-coordinator.ts`
- Modify: `src/app.tsx` — replace inline session logic with hook usage

**Approach:**

1. Identify all session-related state: `sessionIdRef`, `sessionCreatedAtRef`, `sessionTitleRef`, `sessionStateRef`, `artifactStoreRef`, `compiledContextRef`, `checkpointSession`, `checkpointList`, `resumeSessions`.
2. Identify all session-related callbacks: `ensureSessionId`, `saveSessionSafe`.
3. Bundle into `useSessionCoordinator({ cfg, appendEvent, initialState? })` returning `{ sessionId, ensureSessionId, saveSessionSafe, checkpointList, ... }`.
4. The hook owns the refs internally. App receives stable callbacks.

**Technical design:** _(directional guidance)_

```ts
interface SessionCoordinator {
  sessionId: string | null;
  ensureSessionId: () => string;
  saveSessionSafe: () => Promise<void>;
  checkpointList: Checkpoint[];
  checkpointSession: SessionSummary | null;
  resumeSessions: SessionSummary[] | null;
  setCheckpointSession: (s: SessionSummary | null) => void;
  loadCheckpoints: (sessionId: string) => Promise<void>;
  // + sessionState access for agent coordinator
  sessionState: SessionState;
  artifactStore: ArtifactStore;
}

function useSessionCoordinator(opts: {
  cfg: Cfg | null;
  appendEvent: (ev: ChatEvent) => void;
  initialCheckpointSession?: SessionSummary | null;
}): SessionCoordinator;
```

**Test scenarios:**

- **Happy path**: Session ID is generated on first message.
- **Edge case**: `saveSessionSafe` handles missing cfg gracefully.
- **Integration**: Session state survives across coordinator re-renders (ref-based).

**Verification:**

- `npm test` passes
- Session resume/restore behavior unchanged

---

- U3. **Extract `useAgentCoordinator` hook**

**Goal:** Encapsulate the agent turn lifecycle: TurnSupervisor management, `runAgentTurn` callback construction, permission flow, tool result handling, compaction hook, memory integration points.

**Requirements:** R1, R2, R4, R5

**Dependencies:** U2

**Files:**

- Create: `src/app/use-agent-coordinator.ts`
- Modify: `src/app.tsx` — replace agent logic with hook usage

**Approach:**

1. Identify agent-related state: `busy`, `usage`, `sessionUsage`, `gatewayMeta`, `cloudBudget`, `tasks`, `tasksStartedAt`, `tasksStartTokens`, `turnStartedAt`, `turnPhase`, `currentToolName`.
2. Identify agent-related callbacks: `onIterationEnd`, all `AgentCallbacks` (onTextDelta, onToolResult, onUsage, askPermission, etc.).
3. The hook receives `cfg`, `messagesRef`, `executorRef`, `supervisorRef`, `sessionCoordinator`, `memoryManagerRef`, `appendEvent`.
4. Returns `{ busy, turnPhase, startTurn, interruptTurn, ...callbacksForUI }`.

**Technical design:** _(directional guidance)_

```ts
interface AgentCoordinator {
  busy: boolean;
  turnPhase: TurnPhase;
  tasks: Task[];
  usage: Usage | null;
  startTurn: (messages: ChatMessage[], opts?: TurnOpts) => void;
  interruptTurn: () => void;
  // UI-bound callbacks (for StatusBar display)
  currentToolName: string | null;
  turnStartedAt: number | null;
}

function useAgentCoordinator(opts: {
  cfg: Cfg | null;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  executorRef: React.MutableRefObject<ToolExecutor>;
  sessionCoordinator: SessionCoordinator;
  memoryManagerRef: React.MutableRefObject<MemoryManager | null>;
  appendEvent: (ev: ChatEvent) => void;
  // ... other refs as needed
}): AgentCoordinator;
```

**Patterns to follow:**

- Preserve existing `supervisorRef`, `activeScopeRef`, `pendingToolCallsRef` patterns.
- Keep permission flow with `permResolveRef` — it's a proven pattern.

**Test scenarios:**

- **Happy path**: `startTurn` invokes TurnSupervisor with correct callbacks.
- **Error path**: Interrupt during streaming kills the turn and saves session.
- **Integration**: Compaction hook (`onIterationEnd`) still fires between tool iterations.

**Verification:**

- `npm test` passes
- Manual smoke: send a message, verify turn completes

---

- U4. **Extract `useInputCoordinator` hook**

**Goal:** Encapsulate all input handling: keyboard routing (`useInput`), picker management (file/slash), command dispatch (`/mode`, `/thread`, etc.), history navigation, cursor offset.

**Requirements:** R1, R2, R4

**Dependencies:** U1

**Files:**

- Create: `src/app/use-input-coordinator.ts`
- Modify: `src/app.tsx` — replace input logic with hook usage

**Approach:**

1. Identify input-related state: `input`, `cursorOffset`, `activePicker`, `filePickerItems`, `history`, `historyIndex`, `draftInput`, `customCommandsVersion`, `queue`.
2. Identify input-related callbacks: all picker handlers (Up/Down/Select/Cancel), all slash command handlers, history navigation, submit logic.
3. The hook returns `{ input, setInput, cursorOffset, activePicker, onInputChar, submit, ... }`.
4. Cross-domain: `submit` needs to call into `agentCoordinator.startTurn` and `sessionCoordinator.ensureSessionId`. This is achieved by accepting `onSubmit: (text: string) => void` as a prop.

**Test scenarios:**

- **Happy path**: `@` opens file picker, `/` opens slash picker.
- **Edge case**: Picker auto-closes when cursor moves before anchor.
- **Integration**: History navigation (up/down) cycles through past inputs.

**Verification:**

- `npm test` passes
- Picker interactions work in dev mode

---

- U5. **Extract `useSettingsCoordinator` hook**

**Goal:** Encapsulate configuration, theme, LSP, MCP, skills, remote, and custom commands initialization and state.

**Requirements:** R1, R2, R4

**Dependencies:** U3 (needs agent coordinator's `executorRef` for MCP/LSP tool registration)

**Files:**

- Create: `src/app/use-settings-coordinator.ts`
- Modify: `src/app.tsx` — replace settings logic with hook usage

**Approach:**

1. Identify settings-related state: `cfg`, `lspScope`, `lspProjectPath`, `theme`, `originalTheme`, `showLspWizard`, `showRemoteDashboard`, `selectedRemoteSession`, `commandWizard`, `skillsActive`, `customCommandsRef`.
2. Identify init logic: `initMcp`, `initLsp`, theme loading, memory manager init, custom commands loading.
3. The hook receives `initialCfg`, `appendEvent`, `executorRef` (for tool registration).
4. Returns `{ cfg, setCfg, theme, setTheme, initMcp, initLsp, ... }`.

**Technical design:** _(directional guidance)_

```ts
interface SettingsCoordinator {
  cfg: Cfg | null;
  setCfg: (c: Cfg) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  originalTheme: Theme | null;
  lspManager: LspManager;
  mcpManager: McpManager;
  memoryManager: MemoryManager | null;
  initMcp: () => Promise<void>;
  initLsp: () => Promise<void>;
  customCommands: CustomCommand[];
  reloadCustomCommands: () => Promise<void>;
}
```

**Test scenarios:**

- **Happy path**: MCP servers connect on startup when configured.
- **Error path**: Missing MCP server shows error event, doesn't crash.
- **Integration**: Theme change updates `ThemeProvider` context.

**Verification:**

- `npm test` passes
- `npm run build` succeeds

---

- U6. **Recompose `app.tsx` as thin shell**

**Goal:** Reduce `app.tsx` to a composition shell that imports and wires the four coordinators.

**Requirements:** R1, R3, R4

**Dependencies:** U1, U2, U3, U4, U5

**Files:**

- Modify: `src/app.tsx`

**Approach:**

1. Import all four coordinator hooks.
2. Call them in order (settings → session → agent → input).
3. Pass cross-domain callbacks as props between hooks.
4. Render JSX using returned state values.
5. Remove all extracted code from app.tsx body.

**Target structure:**

```tsx
function App({ initialCfg, ... }) {
  const { cfg, theme, initMcp, initLsp, ...settings } = useSettingsCoordinator({...});
  const session = useSessionCoordinator({ cfg, appendEvent });
  const agent = useAgentCoordinator({ cfg, messagesRef, executorRef, session, ... });
  const input = useInputCoordinator({ onSubmit: handleSubmit, ... });

  // Thin wiring for cross-domain events
  const appendEvent = useCallback((ev) => setEvents((e) => [...e, ev]), []);

  return (
    <ThemeProvider theme={theme}>
      {/* JSX using input.*, agent.*, session.*, settings.* */}
    </ThemeProvider>
  );
}
```

**Test scenarios:**

- **Integration**: Full app still renders without runtime errors.
- **Integration**: `npm test` all passes.

**Verification:**

- `app.tsx` < 300 lines
- `npm test` passes
- `npm run typecheck` passes

---

- U7. **Add unit tests for extracted coordinators**

**Goal:** Prove each coordinator works in isolation.

**Requirements:** R2

**Dependencies:** U6

**Files:**

- Create: `src/app/use-session-coordinator.test.ts`
- Create: `src/app/use-agent-coordinator.test.ts`
- Create: `src/app/use-input-coordinator.test.ts`
- Create: `src/app/use-settings-coordinator.test.ts`

**Approach:**

1. Session coordinator: test `ensureSessionId` generates deterministic ID, `saveSessionSafe` calls `saveSession`.
2. Agent coordinator: test `startTurn` constructs correct `AgentTurnOpts`, `interruptTurn` calls `supervisor.killTurn`.
3. Input coordinator: test picker state transitions, history navigation.
4. Settings coordinator: test theme resolution, config loading.

**Execution note:** Use React Testing Library's `renderHook` (via `ink-testing-library` or `@testing-library/react`). Mock refs and external dependencies.

**Test scenarios:**

- **Happy path**: Each coordinator hook renders without error in isolation.
- **Edge case**: Coordinator handles null/undefined inputs gracefully.

**Verification:**

- New test files run and pass
- Total test count increases by 10+

---

- U8. **End-to-end smoke verification**

**Goal:** Ensure no behavioral regressions after full decomposition.

**Requirements:** R3

**Dependencies:** U7

**Files:** None (verification only)

**Approach:**

1. Run full test suite.
2. Run dev mode and verify: startup, chat message, tool execution, picker, slash command.
3. Verify build output size is comparable (should be identical or slightly smaller due to tree-shaking).

**Verification:**

- `npm test` — 321+ pass, 0 fail
- `npm run typecheck` — 0 errors
- `npm run build` — success, bundle size ±5%
- `npm run lint` — 0 issues

---

## System-Wide Impact

- **Import graph**: `app.tsx` now imports from `src/app/` and `src/util/` instead of inline definitions. No circular dependencies expected — each coordinator imports its own subsystem.
- **Ref lifecycle**: Refs like `messagesRef`, `executorRef` are created in App and passed to coordinators. This preserves React's ref identity across renders.
- **Event pipeline**: `appendEvent` is the primary cross-domain seam. Events flow: agent/input → appendEvent → App state → ChatView. This is a unidirectional data flow.
- **Unchanged invariants**: `agent/loop.ts`, `tools/executor.ts`, `memory/manager.ts`, `lsp/manager.ts`, `mcp/manager.ts` are untouched. Their interfaces are consumers of the refactoring, not subjects.

---

## Risks & Dependencies

| Risk                                      | Mitigation                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Cross-domain callback signatures wrong    | U6 is the integration point — verify by running tests before proceeding from U5→U6 |
| `useRef` identity lost in hook extraction | Create refs in App, pass to hooks. Never recreate refs inside hooks                |
| useCallback dependencies become stale     | Each hook returns stable callbacks. App only passes refs/callbacks, not closures   |
| Bundle size increase                      | Pure utility extraction should enable better tree-shaking. Monitor in U8           |

---

## Documentation / Operational Notes

- Update `KIMI.md` if it mentions `app.tsx` architecture (it describes the data flow from `app.tsx` as the root).
- No user-facing documentation changes needed.

---

## Sources & References

- **Origin document:** code-overhaul-review Section 1A
- Related plan: `docs/plans/2026-05-08-002-refactor-quick-wins-build-types-tests-plan.md` (preceding work)
- Target file: `src/app.tsx` (4,054 LOC)
- Existing seam pattern: `src/agent/supervisor.ts` (TurnSupervisor)
