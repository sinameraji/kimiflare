# Camouflage UI Parity Migration Tracker

> This document tracks the incremental migration of features from Ink to Camouflage UI mode.
> Last updated: 2026-06-12
>
> **Current status:** P0–P2 fully complete. P3.14–P3.16 complete. P3.17 pending renderer support.

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

### P0.3 Add diff rendering support ✅
- [x] Send diff output as pre-formatted ANSI in `ToolExecutionStdout`
- [x] `formatAnsiDiff` helper renders `+` green / `-` red; no renderer changes needed
- **Files:** `src/ui-mode.ts`

### P0.4 Fuzzy file picker overlay ✅
- [x] `registerMentions` now uses `glob("**/*")` with `buildFilePickerIgnoreList` (Ink parity)
- [x] Recent-files bubbling preserved via `recent` flag on `MentionCandidatesRegistered`
- **Files:** `src/ui-mode.ts`

---

## Phase 2 — High-Impact UX Parity (P1)

*Goal: Camouflage feels as polished as Ink for daily use.*

### P1.5 Theme system parity ✅
- [x] Persist theme choice to config via `saveConfig()` so it applies on next Ink session
- [x] Load saved theme from config on startup (falls back to `everforest-dark`)
- [x] Update toast/prompt messaging to clarify the theme applies on next Ink session
- **Files:** `src/ui-mode.ts`
- **PR:** #574

### P1.6 Inline plan overlays ✅
- [x] After plan-mode turn completes, show `selectList` with three choices: auto, edit, continue
- [x] On auto/edit: reset session, rebuild system prompt for chosen mode, seed with distilled plan
- [x] On continue/cancel: do nothing, user keeps chatting in plan mode
- **Files:** `src/ui-mode.ts`
- **PR:** #574

### P1.7 Rich tool visualization ✅
- [x] Elapsed-time updates already implemented (`setInterval` sending `StatusUpdate` with `elapsed` segment)
- [x] Camouflage always shows full tool results (no collapsible UI needed)
- [x] Repeated-call warnings already sent via `ToolExecutionStarted` with `repeated: true`
- **Files:** `src/ui-mode.ts`
- **Note:** Already complete from prior work; verified during P1 assessment.

### P1.8 Skills add/edit wizard ✅
- [x] `/skills add` (no-arg): form collects name/description/content → selectList for scope → create
- [x] `/skills add <name>`: create immediately with defaults (project scope)
- [x] `/skills edit` (no-arg): selectList of skills → read file → form pre-populated → write back
- [x] `/skills edit <name>`: skip picker, edit named skill directly
- **Files:** `src/ui-mode.ts`
- **PR:** #574

---

## Phase 3 — Medium Impact / Nice-to-Have (P2)

*Goal: Full feature parity plus Camouflage-native enhancements.*

### P2.9 Billing/Cost detailed view ✅
- [x] Add `/cost` handler that opens `ShowKeyValueView` with breakdown
- [x] Uses `getCostReport`, `formatCostReport`, `formatGatewaySection` for session/today/month/all-time + gateway section
- **Files:** `src/ui-mode.ts`
- **PR:** #575

### P2.10 Multi-agent worker list ✅
- [x] Render workers as `BackgroundTaskUpdate` entries during multi-agent execution
- [x] Add `/workers` command to list active workers via `ShowKeyValueView`
- **Files:** `src/ui-mode.ts`
- **PR:** #575

### P2.11 Hooks dashboard ✅
- [x] Port `HooksDashboard` to sequential `selectList` + `ShowKeyValueView` flows
- [x] `/hooks dashboard` shows configured + recommended hooks in selectList
- [x] Enter toggles enable/disable; `+ Create custom hook` opens form
- **Files:** `src/ui-mode.ts`
- **PR:** #575

### P2.12 QR code support ✅
- [x] `/hello` generates QR code as ASCII art via `QRCode.toString` and renders in `ShowKeyValueView`
- **Files:** `src/ui-mode.ts`
- **PR:** #575

### P2.13 Changelog image picker ✅
- [x] Port to `form` + `selectList` flow (owner/repo/days inputs)
- [x] `/changelog-image` with no args opens form; days picked via selectList
- [x] Runs `changelogImageTool` with `BackgroundTaskUpdate` task tracking
- **Files:** `src/ui-mode.ts`
- **PR:** #575

---

## Phase 4 — Camouflage-Exclusive Enhancements (P3)

*Goal: Users switching to Camouflage get *more* than they had in Ink.*

### P3.14 Native scrollback search ✅
- [x] Renderer-native: `Ctrl+F` opens the transcript search overlay (ratatui viewport search)
- [x] Documented in `HELP_KEYS` (`src/ui-mode.ts:3323`)
- [x] No host code required — works automatically in camouflage-tui ≥ 1.0.0
- **Note:** The renderer's SQLite-backed event log enables full-text search across the entire session history, not just the visible viewport.

### P3.15 Persistent log buffer ✅
- [x] Pass `--db <path>` to renderer pointing to `~/.config/kimiflare/camouflage-sessions.db`
- [x] Directory created recursively at boot via `mkdirSync`
- [x] Renderer persists every inbound event to SQLite WAL before rendering (automatic)
- [x] Sessions are replayable via renderer's `--replay <SESSION_ID>` CLI flag
- **Files:** `src/ui-mode.ts` (mount args)
- **Note:** This integrates the renderer's native persistence with kimiflare's config directory, so sessions survive terminal restarts and can be replayed deterministically.

### P3.16 Better paste handling ✅
- [x] Upgraded to `camouflage-tui@2.1.0-beta.1` which ships paste preview + multi-line paste support (PR #29)
- [x] No host changes required — renderer handles bracketed paste and sanitization natively
- **Files:** `package.json` (optionalDependency)

### P3.17 Mouse support
- [ ] Click to expand tools, click to copy code blocks
- **Status:** Blocked on renderer support. ratatui supports mouse events; Camouflage does not yet wire them to actions.
- **Proposed implementation:**
  1. Renderer: enable crossterm mouse capture mode on startup
  2. Renderer: track click coordinates → map to row IDs in the transcript
  3. Renderer: on click inside a tool-execution row, toggle expand/collapse
  4. Renderer: on click inside a code block, copy contents to clipboard (via OSC 52 or external command)
  5. Host: add `MouseClick` outbound event if the host needs to react (e.g. open a file at clicked line)
- **Upstream issue:** sinameraji/camouflage#?? (file when ready)

---

## Bug Fixes & Clean-ups

### Invalid `TranscriptCleared` event removed
- `TranscriptCleared` was never part of the Camouflage protocol (not in `EventType` enum)
- Removed all 5 occurrences in `src/ui-mode.ts` (checkpoint restore, `/clear`, `/compact`, mode switch, `/resume`)
- Added comments explaining that Camouflage is append-only; the visible scrollback is not cleared, but the internal `messages` array is correctly reset

### Agent todo list now uses `TodoListUpdate`
- `onTasks` callback sends `TodoListUpdate` (v2.1.0+) instead of individual `BackgroundTaskUpdate` events
- Maps directly to the renderer's vertical checklist panel (☐ pending / ◐ in_progress / ☑ completed)
- `BackgroundTaskUpdate` is still used for ephemeral background jobs (skills selection, memory recall, etc.)

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
