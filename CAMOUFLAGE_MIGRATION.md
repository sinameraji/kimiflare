# Camouflage UI Parity Migration Tracker

> This document tracks the incremental migration of features from Ink to Camouflage UI mode.
> Last updated: 2026-06-11

## Overview

Camouflage (`src/ui-mode.ts`) is the experimental terminal UI renderer that will eventually replace Ink (`src/app.tsx`). This document tracks which Ink features have been ported and which remain.

---

## Phase 1 — Critical Workflow Gaps (P0) ✅ COMPLETED

*Goal: Users switching to Camouflage don't lose essential functionality.*

### P0.1 Wire MemoryManager in Camouflage mode ✅
- [x] Instantiate `MemoryManager` in `ui-mode.ts` at boot (when `memoryEnabled`)
- [x] Implement `/memory search` using `ShowKeyValueView` to display `HybridResult` items
- [x] Implement `/memory clear` with `confirm` dialog
- **Files:** `src/ui-mode.ts`
- **PR:** #571

### P0.2 Instantiate MCP, LSP, and Hooks managers ✅
- [x] Start `McpManager`, `LspManager`, `HooksManager` at boot in Camouflage mode
- [x] Wire `/mcp reload` to unregister old tools, reset init flag, and re-run `initMcp()`
- [x] Wire `/lsp reload` to unregister old tools, reset init flag, and re-run `initLsp()`
- [x] Wire `/hooks reload` to call `hooksManager.reload()`
- **Files:** `src/ui-mode.ts`
- **PR:** #571

### P0.3 Add diff rendering support
- [ ] Send diff output as pre-formatted ANSI in `ToolExecutionStdout`, or
- [ ] Add `ShowDiffView` event to Camouflage protocol
- **Files:** `src/ui-mode.ts`, Camouflage renderer crate

### P0.4 Fuzzy file picker overlay
- [ ] Add `ShowFilePicker` event or reuse `selectList` with `allow_filter: true`
- [ ] Mirror Ink's recent-files bubbling behavior
- **Files:** `src/ui-mode.ts`

---

## Phase 2 — High-Impact UX Parity (P1)

*Goal: Camouflage feels as polished as Ink for daily use.*

### P1.5 Theme system parity
- [ ] Make Camouflage respect theme events, or document Camouflage-native theme system
- **Files:** Camouflage renderer, or `src/ui-mode.ts`

### P1.6 Inline plan overlays
- [ ] Add `ShowInlinePicker` or `ShowChatOverlay` event for `PlanCompletePicker`/`PlanOptionsPicker`
- **Files:** Camouflage renderer, `src/ui-mode.ts`

### P1.7 Rich tool visualization
- [ ] Send elapsed-time updates via `ToolExecutionUpdate` event
- [ ] Add `expanded` state support or always show full results
- [ ] Verify repeated-call warnings render correctly
- **Files:** `src/ui-mode.ts`, Camouflage renderer

### P1.8 Skills add/edit wizard
- [ ] Build `form` + `selectList` multi-step wizard for creating/editing skill files
- **Files:** `src/ui-mode.ts`

---

## Phase 3 — Medium Impact / Nice-to-Have (P2)

*Goal: Full feature parity plus Camouflage-native enhancements.*

### P2.9 Billing/Cost detailed view
- [ ] Add `/cost` handler that opens `ShowKeyValueView` with breakdown
- **Files:** `src/ui-mode.ts`

### P2.10 Multi-agent worker list
- [ ] Add `ShowWorkerList` event or render workers as `BackgroundTaskUpdate` entries
- **Files:** `src/ui-mode.ts`, Camouflage renderer

### P2.11 Hooks dashboard
- [ ] Port `HooksDashboard` to sequential `selectList` + `ShowKeyValueView` flows
- **Files:** `src/ui-mode.ts`

### P2.12 QR code support
- [ ] Add `ShowQrCode` event to Camouflage renderer, or render as ASCII art
- **Files:** `src/ui-mode.ts`, Camouflage renderer

### P2.13 Changelog image picker
- [ ] Port to `form` + `selectList` flow (owner/repo/days inputs)
- **Files:** `src/ui-mode.ts`

---

## Phase 4 — Camouflage-Exclusive Enhancements (P3)

*Goal: Users switching to Camouflage get *more* than they had in Ink.*

### P3.14 Native scrollback search
- [ ] Add `/` search through chat history in Rust renderer

### P3.15 Persistent log buffer
- [ ] Keep full session logs in memory for instant resume

### P3.16 Better paste handling
- [ ] Handle paste sanitization natively in renderer

### P3.17 Mouse support
- [ ] Click to expand tools, click to copy code blocks

---

## Implementation Notes

### Manager Instantiation Pattern (Ink → Camouflage)

Ink creates managers in `App()` component body:
```tsx
const mcpManagerRef = useRef(new McpManager());
const lspManagerRef = useRef(new LspManager());
const memoryManagerRef = useRef<MemoryManager | null>(null);
const hooksManagerRef = useRef(new HooksManager(process.cwd()));
```

Camouflage should instantiate these in `runUiMode()` before the event loop starts, gated by config flags (e.g., `memoryEnabled`, `lspEnabled`).

### Tool Registration Pattern

Ink registers MCP/LSP tools via callbacks passed to `runAgentTurn`:
```tsx
onMcpTools: (tools) => { /* register with executor */ },
onLspTools: (tools) => { /* register with executor */ },
```

Camouflage already has `executor` instantiated — we need to wire the same callbacks.

### Memory Search/Clear Pattern

Ink's `handleMemory` in `slash-commands.ts`:
- `memoryManagerRef.current?.recall({ text: query, repoPath: cwd, limit: 10 })`
- `memoryManagerRef.current?.clearRepo(process.cwd())`

Camouflage should call the same methods and render results via Camouflage events (`ShowKeyValueView`, `selectList`, `confirm`).
