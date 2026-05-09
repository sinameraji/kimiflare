---
title: P0 Audit Fixes and pi-mono Pattern Ports
type: feat
status: active
date: 2026-05-08
---

# P0 Audit Fixes and pi-mono Pattern Ports

## Overview

The code overhaul audit identified P0 issues across security (path traversal, world-readable creds), maintainability (13+ silent `saveConfig` failures), and testing (27 contrast failures in `kimiflare-light`). The upstream `pi-mono` repo (`/Volumes/BIWIN/CODES/pi-mono`) has battle-tested patterns that directly address every category. This plan coordinates a pre-PR cleanup pass to port those patterns and fix the audit blockers.

This is the direct follow-up to the TUI redesign plan (`docs/plans/2026-05-07-001-refactor-tui-redesign-plan.md`). Phase A (layout) and Phase B (themes, filled interaction, inline overlays) are already implemented on branch `feat/tui-opinionated-redesign`.

---

## Problem Frame

- **Theme contrast**: `kimiflare-light` palette fails WCAG 4.5:1 against white backgrounds in 27 test cases.
- **Silent failures**: `saveConfig(updated).catch(() => {})` appears 13+ times in `app.tsx`, hiding disk-full, permission-denied, and JSON serialization errors from users.
- **Insecure credential storage**: Cloud credentials are saved via `fs.writeFileSync` without permission restriction.
- **Config write races**: No locking on concurrent config writes; parallel `kimiflare` instances can corrupt `config.json`.
- **Path traversal**: `read`, `edit`, and `write` tools resolve paths relative to `cwd` without checking whether the resolved path escapes the project root.
- **Raw bash output**: ANSI escapes and binary data from subprocesses flow unfiltered into chat history.
- **Overlay state soup**: `app.tsx` manages overlay visibility with 4+ independent booleans (`showPermission`, `showThemePicker`, `showCommandPicker`, `showCommandDelete`) instead of a single state machine.
- **Test gaps**: New abstractions (`Frame`, `useTerminal`, `ThemeView`, `FilledItem`, inline overlays) have zero dedicated unit tests.

---

## Requirements Trace

- **R1.** All theme contrast combinations pass WCAG 4.5:1 (`src/ui/theme-contrast.test.ts` zero failures).
- **R2.** No `saveConfig` promise rejection is silently swallowed; failures are logged and surfaced to the user event stream.
- **R3.** Credential files are written with `0o600` and parent directories with `0o700`.
- **R4.** Config writes are concurrency-safe (file locking on `config.json`).
- **R5.** `read`/`edit`/`write` tools reject paths that escape the working directory.
- **R6.** Bash tool output strips ANSI escapes and sanitizes binary data before display.
- **R7.** Overlay state is expressed as a single discriminated union, eliminating parallel boolean flags.
- **R8.** Each new UI abstraction added in the redesign has at least one focused unit test.

---

## Scope Boundaries

- No new major UI features or theme variants.
- No Rust rewrites; all changes stay in TypeScript/TSX.
- PR creation is intentionally deferred to a separate follow-up step.
- The bash-permission key (`bash:git`) granularity refactor is noted but deferred — the pi-mono pattern requires a full permission model redesign.
- No changes to the `isolated-vm` optional dependency handling (the `node:vm` fallback removal is excluded unless trivial).

### Deferred to Follow-Up Work

- **Screen router with discriminated union**: Extracting the full app state machine (not just overlays) into a typed router is architecture surgery beyond this scope (`app.tsx` is ~2,400 lines). Plan it after this PR.
- **PR creation and merge**: Will happen after all units below are verified and committed.

---

## Context & Research

### Relevant Code and Patterns

- **Theme contrast tests**: `src/ui/theme-contrast.test.ts` — 27 failures on `kimiflare-light` (#a67c3b on #ffffff = 3.77:1).
- **Silent saveConfig**: `src/app.tsx` has `saveConfig(updated).catch(() => {})` at ~13 call sites.
- **Cloud credential save**: `src/app.tsx` function `saveCloudCredentials` or equivalent; search for `writeFileSync` with cloud/auth paths.
- **Config persistence**: `src/config.ts` defines config path logic; `saveConfig` writes to `~/.config/kimflicon/config.json`.
- **Tool paths**: `src/tools/read.ts`, `src/tools/edit.ts`, `src/tools/write.ts` use `path.resolve()` without traversal checks.
- **Bash tool**: `src/tools/bash.ts` streams `stdout`/`stderr` directly into events.
- **Overlay booleans**: `src/app.tsx` lines managing `showPermission`, `showThemePicker`, `showCommandPicker`, `showCommandDelete`.
- **Frame component**: `src/ui/frame.tsx` — auto-center, rounded-border enforcement, `backgroundRaised`.
- **FilledItem**: `src/ui/select-item.tsx` — custom `ink-select-input` renderer.
- **ThemeView**: `src/ui/theme-view.ts` + `src/ui/theme-context.tsx`.

### Upstream Reference (pi-mono)

- **Error-recording writes**: `packages/coding-agent/src/core/settings-manager.ts:474-488` (`enqueueWrite` with `.catch(recordError)`) and `drainErrors()` API.
- **Secure auth storage**: `packages/coding-agent/src/core/auth-storage.ts:53` (`mkdirSync` with `mode: 0o700`, `chmodSync` with `0o600`).
- **File locking**: `auth-storage.ts` uses `proper-lockfile` (`lock`, `unlock`).
- **Path resolution**: `packages/coding-agent/src/core/tools/path-utils.ts` (`resolveToCwd`, `resolveReadPath` with existence variants and macOS screenshot normalization).
- **Bash sanitization**: `packages/coding-agent/src/core/bash-executor.ts:39` (`sanitizeBinaryOutput`, `stripAnsi`, rolling buffer, truncation).
- **Overlay architecture**: `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2260` (`showExtensionCustom` with `overlay?: boolean` and overlay options).

### Institutional Learnings

- The TUI redesign already uses a `Frame` SSOT (single source of truth) for borders; the same SSOT discipline should apply to error handling (one wrapper, not N catch blocks).
- The `assertRoundedBorders` runtime check in `Frame` proves that assertion-based invariants work for agent-readable enforcement.

---

## Key Technical Decisions

- **Use pi-mono's `recordError` pattern, not a generic logger.** Kimiflare surfaces errors as in-app events. The wrapper should push to the event stream so the user sees "Save failed: EACCES" in chat, matching existing error UX.
- **Use `proper-lockfile` for config locking.** pi-mono already depends on it; adding it to kimiflare aligns dependency graphs and avoids rolling our own lock protocol.
- **Discriminated union for overlays only, not full app state.** The full `app.tsx` state machine is too large for this pass. We narrow scope to the 4+ overlay booleans that were already identified as inline overlays in Phase B.
- **Sanitize bash output at the tool boundary, not in chat rendering.** If we strip ANSI in `src/tools/bash.ts`, every downstream consumer (chat, log files, debug dumps) gets clean text. Doing it in `chat.tsx` would spread the concern.
- **Path traversal guard: block by default, no opt-out.** The tool must reject any resolved absolute path that is not equal to or inside `cwd`. This is security-critical.

---

## Open Questions

### Resolved During Planning

- **Q:** Should we add `proper-lockfile` as a new dependency or use `node:fs` advisory locks?
  - **A:** Add `proper-lockfile` — it is small, battle-tested, and used by the upstream reference.
- **Q:** Should the path traversal guard also block symlinks that escape the directory?
  - **A:** Yes, use `fs.realpathSync` after resolution. Defer the exact implementation detail to the unit.
- **Q:** Should the bash ANSI stripping also strip OSC hyperlinks and progress sequences?
  - **A:** Strip full ANSI escape sequences (OSC, CSI, SGR). Use the same regex pattern pi-mono uses.

### Deferred to Implementation

- **Exact bash truncate length:** Whether to truncate at 4,096 chars, 8,192, or use `stdout.rows`. Implementer will test with real tool output.
- **Overlay union variant names:** `kind: "permission"` vs `kind: "pendingPermission"`. Implementer picks the naming that reads best in `app.tsx` after attempting the refactor.

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification._

### Error Recording (Silent Save Fix)

```
saveConfig(data)
  -> promise.catch((err) => {
       const recorded = { scope: "config", message: err.message, timestamp: Date.now() };
       pushEvent({ kind: "error", key: mkKey(), text: `Save failed: ${err.message}` });
       return recorded; // for test assertions
     })
```

### Overlay Discriminated Union

Replace:

```typescript
const [showPermission, setShowPermission] = useState(false);
const [showThemePicker, setShowThemePicker] = useState(false);
// ... 4+ booleans
```

With:

```typescript
type Overlay =
  | { kind: "none" }
  | { kind: "permission"; perm: PendingPermission }
  | { kind: "themePicker" }
  | { kind: "commandPicker"; mode: "edit" | "delete" }
  | { kind: "commandList" };

const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
```

Then render:

```tsx
{overlay.kind === "permission" && <Permission ... />}
// etc.
```

---

## Implementation Units

- U1. **Theme Contrast Compliance**

**Goal:** Fix all 27 contrast failures in `kimiflare-light` so `theme-contrast.test.ts` passes.

**Requirements:** R1

**Dependencies:** None

**Files:**

- Modify: `src/ui/themes/kimiflare-light.json`
- Test: `src/ui/theme-contrast.test.ts`

**Approach:**

- Audit failing pairs in `theme-contrast.test.ts` output.
- Adjust `kimiflare-light` foreground/accent colors to hit WCAG 4.5:1 on `#ffffff`. The failing color is likely `#a67c3b` (gold) which drops to 3.77:1; darken slightly to ~`#8a6528` or shift to a deeper brown.
- Preserve the warm palette identity; do not swap to cool tones.

**Patterns to follow:**

- The existing contrast test already computes WCAG ratios; use its output as the target list.

**Test scenarios:**

- Happy path: Every `foreground`/`accent`/`muted` token against `background` and `backgroundRaised` passes 4.5:1.
- Edge case: New color must still pass against dark terminal themes when a user forces a dark terminal background under the light theme.

**Verification:**

- `npx vitest run theme-contrast.test.ts` exits with zero failures.

---

- U2. **Silent Save Failure Wrapper**

**Goal:** Eliminate all `.catch(() => {})` on `saveConfig` and replace with a wrapper that logs and surfaces errors.

**Requirements:** R2

**Dependencies:** None

**Files:**

- Create: `src/config-utils.ts` — `safeSave(operation, promise)` helper
- Modify: `src/app.tsx`
- Test: `src/app.test.tsx` (or `tests/save-failure.test.ts`)

**Approach:**

- Implement `safeSave(operationName: string, promise: Promise<void>)` in a new utility file, using the existing `pushEvent` / `setEvents` pattern that `app.tsx` already uses.
- Search-and-replace all `saveConfig(...).catch(() => {})` in `app.tsx` with `safeSave("saveConfig", saveConfig(...))`.
- The wrapper should log to `stderr` (for developer debugging) and append an error chat event (for user visibility).

**Patterns to follow:**

- pi-mono `settings-manager.ts:enqueueWrite` with `.catch(recordError)` and `drainErrors()` pattern, adapted to kimiflare's in-app event stream.

**Test scenarios:**

- Happy path: Successful save does not trigger an error event.
- Error path: Simulated `EACCES` save rejection surfaces a chat event containing "Save failed".
- Error path: Multiple simultaneous saves — each failure produces one event, no duplication.

**Verification:**

- `grep -n "catch(() => {})" src/app.tsx` returns zero matches.
- `grep -rn "catch(() => {})" src/` returns zero matches (if any other files swallow errors similarly).

---

- U3. **Secure Credential Storage**

**Goal:** Ensure cloud credential files and parent directories use restrictive POSIX permissions.

**Requirements:** R3

**Dependencies:** None

**Files:**

- Modify: `src/app.tsx` (search for cloud credential save logic)
- Modify: `src/config.ts` (config directory creation if applicable)
- Test: `tests/credential-permissions.test.ts`

**Approach:**

- Find the function that writes cloud credentials (likely `saveCloudCredentials` or similar). After `writeFileSync`, add `chmodSync(path, 0o600)`.
- Find the config directory creation logic in `config.ts`. Ensure `mkdirSync(..., { recursive: true, mode: 0o700 })` is used.
- If the credential file lives inside `~/.config/kimflicon/`, ensure the parent directory is also `0o700`.

**Patterns to follow:**

- pi-mono `auth-storage.ts` (`ensureParentDir` with `mkdirSync(mode: 0o700)`, `chmodSync` with `0o600`).

**Test scenarios:**

- Happy path: After saving credentials, `fs.statSync(path).mode & 0o777 === 0o600`.
- Edge case: On non-POSIX systems (Windows), the code should still run without crashing (skip `chmodSync` or guard with `process.platform !== "win32"`).
- Integration: Config directory is created with `0o700` if it did not exist.

**Verification:**

- New test file passes.
- `stat` on real credential file in `~/.config/kimflicon/` shows `-rw-------`.

---

- U4. **Config Write Locking**

**Goal:** Prevent race-condition corruption when multiple `kimiflare` instances write `config.json` simultaneously.

**Requirements:** R4

**Dependencies:** U2 (error wrapper should still work around locked-file retries)

**Files:**

- Modify: `src/config.ts` (the `saveConfig` function)
- Modify: `package.json` (add `proper-lockfile` dev/prod dependency)
- Test: `tests/config-locking.test.ts`

**Approach:**

- Install `proper-lockfile`.
- Wrap `saveConfig`'s `writeFileSync` call with `lockfile.lock(configPath)`, write, then `lockfile.unlock(configPath)`.
- Use a short `retry` config on the lock call so concurrent writers wait rather than fail immediately.
- If `lock` fails after retries, throw the error (which U2's wrapper will catch and surface).

**Patterns to follow:**

- pi-mono `auth-storage.ts` lock/unlock pattern.

**Test scenarios:**

- Happy path: Sequential saves from one process succeed.
- Integration: Two parallel saves to the same file from the same process (simulate with `Promise.all`) still result in valid JSON. This requires mocking or actual temp files.
- Error path: Lock acquisition failure surfaces a user-visible error via U2's wrapper.

**Verification:**

- Test simulates concurrent writes and asserts valid JSON at the end.
- No `proper-lockfile` errors leak as unhandled rejections.

---

- U5. **Path Traversal Guards**

**Goal:** Prevent `read`, `edit`, and `write` tools from accessing files outside the project root.

**Requirements:** R5

**Dependencies:** None

**Files:**

- Create: `src/path-utils.ts` — `resolveSafePath(input, cwd)`
- Modify: `src/tools/read.ts`, `src/tools/edit.ts`, `src/tools/write.ts`
- Test: `tests/path-traversal.test.ts`

**Approach:**

- Implement `resolveSafePath(filePath: string, cwd: string): string` that:
  1. Expands `~` via `os.homedir()`.
  2. Resolves to absolute path.
  3. Verifies the resolved path starts with `cwd` (after `fs.realpathSync` on both).
- If traversal is detected, throw a clear error: `Path traversal blocked: "${filePath}" resolves outside "${cwd}"`.
- Apply `resolveSafePath` to all three tool entry points before any file access.

**Patterns to follow:**

- pi-mono `path-utils.ts` (`resolveToCwd`, `expandPath`) plus an explicit `startsWith(cwd)` guard.

**Test scenarios:**

- Happy path: `./src/app.tsx` resolves to `{cwd}/src/app.tsx`.
- Edge case: `../outside.txt` is rejected with a clear error.
- Edge case: Symlink `foo -> /etc/passwd` in cwd is resolved via `realpathSync` and rejected.
- Edge case: Absolute path `/etc/passwd` when cwd is `/home/user` is rejected.

**Verification:**

- `vitest run path-traversal.test.ts` passes.
- No legitimate relative-path workflows in `tests/` are broken.

---

- U6. **Bash Output Sanitization**

**Goal:** Strip ANSI escape sequences and sanitize binary data from bash tool output before display.

**Requirements:** R6

**Dependencies:** None

**Files:**

- Create: `src/ui/sanitize-output.ts` — `stripAnsi(text)`, `sanitizeBinaryOutput(text)`
- Modify: `src/tools/bash.ts`
- Test: `tests/bash-sanitize.test.ts`

**Approach:**

- Port pi-mono's ANSI regex for CSI (`\u001b\[[0-9;]*[a-zA-Z]`) and OSC (`\u001b\][0-9;]*(?:\u0007|\u001b\\)`) sequences.
- For binary data: replace non-printable characters (control chars except `\n`, `\t`, `\r`) with a replacement marker or strip them.
- Apply sanitization to each `stdout`/`stderr` data chunk in `src/tools/bash.ts` before pushing to the event stream.

**Patterns to follow:**

- pi-mono `bash-executor.ts` (`sanitizeBinaryOutput`, `stripAnsi`).

**Test scenarios:**

- Happy path: Clean text passes through unchanged.
- Happy path: ANSI colored text (`\u001b[31mred\u001b[0m`) becomes `red`.
- Edge case: Mixed binary + text output produces readable text without garbage bytes.
- Error path: Empty string passes through as empty.

**Verification:**

- `vitest run bash-sanitize.test.ts` passes.
- Bash tool output in actual terminal no longer shows ESC sequences (e.g. from `git diff --color=always`).

---

- U7. **Overlay Discriminated Union State**

**Goal:** Replace the 4+ boolean overlay flags in `app.tsx` with a single typed overlay state.

**Requirements:** R7

**Dependencies:** Phase B inline overlay refactor must be in place (commit `2badd50` on branch)

**Files:**

- Modify: `src/app.tsx`
- Test: `tests/overlay-state.test.ts` (or extend `src/app.test.tsx`)

**Approach:**

1. Define `type Overlay = { kind: "none" } | { kind: "permission"; perm: PendingPermission } | { kind: "themePicker" } | { kind: "commandPicker"; mode: "edit" | "delete" } | { kind: "commandList" }`.
2. Replace `useState` booleans with `const [overlay, setOverlay] = useState<Overlay>({ kind: "none" })`.
3. Replace every `setShowPermission(true)` with `setOverlay({ kind: "permission", perm })`.
4. Replace every `setShowPermission(false)` with `setOverlay({ kind: "none" })`.
5. In JSX, replace `{showPermission && <Permission ... />}` with `{overlay.kind === "permission" && <Permission ... />}`.
6. Full-screen wizards (onboarding, checkpoint, resume, remote, LSP, command wizard) are **not** included — they remain as early-return screen replacements per Phase B decision.

**Patterns to follow:**

- pi-mono `interactive-mode.ts` overlay options pattern (`overlay?: boolean` + closure-based close callbacks).

**Test scenarios:**

- Happy path: Setting overlay to `{ kind: "themePicker" }` renders `<ThemePicker>`.
- Happy path: Calling `closeOverlay()` resets to `{ kind: "none" }`.
- Edge case: Multiple `setOverlay` calls in one tick — last one wins (React batching).
- Integration: Choosing a theme in `<ThemePicker>` calls an action that sets overlay back to `none`.

**Verification:**

- `grep -n "showPermission\|showThemePicker\|showCommandPicker\|showCommandDelete" src/app.tsx` returns zero boolean state declarations.
- All existing TDD tests still pass.

---

- U8. **Test Coverage Expansion**

**Goal:** Add focused unit tests for each new UI abstraction introduced in the redesign.

**Requirements:** R8

**Dependencies:** U1–U7 (tests should verify the fixed/clean state, not the broken state)

**Files:**

- Create: `src/ui/frame.test.tsx`
- Create: `src/ui/theme-view.test.ts`
- Create: `src/ui/select-item.test.tsx`
- Create: `tests/overlay-inline.test.tsx`
- Modify: `tests/ui-phase-a.test.tsx` (extend or keep as-is if already passing)

**Approach:**

- **Frame test**: Render `<Frame>` and assert that `children` are wrapped in rounded borders (`╭`, `╮`, `╰`, `╯`), not sharp ones. Use `ink-testing-library` or the existing TDD harness.
- **ThemeView test**: Assert that `toThemeView(catppuccinMocha)` produces `selectedBg` equal to the accent color, and `onSelected` equal to the background color.
- **FilledItem test**: Render a `SelectInput` with `FilledItem` component; assert selected item has `backgroundColor` prop set and unselected does not.
- **Overlay inline test**: Mount a mock app component with inline overlay rendering; assert that `<ThemePicker>` overlays chat history (not replacing it) until dismissed.

**Patterns to follow:**

- Existing `tests/ui-phase-a.test.tsx` TDD harness pattern.
- `ink-testing-library` API (`render`, `waitFor`, `cleanup`).

**Test scenarios:**

- Frame: Border characters are exclusively rounded.
- Frame: `backgroundRaised` is applied via `Box backgroundColor`.
- ThemeView: Missing semantic tokens receive sensible defaults (e.g., if no `accent`, `selectedBg` falls back to `primary`).
- FilledItem: Selected state uses `selectedBg`/`onSelected`; unselected has no background.
- Overlay inline: Overlay renders as a floating dialog above existing chat messages.

**Verification:**

- All new test files pass with `vitest`.
- Total test suite (new + existing 14 TDD tests) passes clean.

---

## System-Wide Impact

- **Interaction graph:**
  - `safeSave` touches every `saveConfig` call in `app.tsx` + any future callers.
  - `resolveSafePath` adds a synchronous guard at the entry of `read`/`edit`/`write` tools.
  - Bash sanitization runs on every stdout/stderr chunk; any consumer relying on raw ANSI will receive plain text.
- **Error propagation:**
  - Previously swallowed save errors now surface as chat events. This is a user-visible behavior change, but it is correcting broken UX (silent data loss), not introducing new failures.
- **State lifecycle risks:**
  - Overlay discriminated union changes how overlays open/close. Must ensure that dismissing one overlay via Escape does not accidentally clear a different overlay type.
- **API surface parity:**
  - No changes to CLI flags, env vars, or external contracts.
  - `saveConfig` now uses locking — any external script that reads `config.json` concurrently may see brief unavailability during lock acquisition, but this is safer than corruption.
- **Unchanged invariants:**
  - Full-screen wizards remain early-return screen replacements (not inline).
  - The `Frame` SSOT for borders is untouched.
  - `ThemeView` contract stays intact.

---

## Risks & Dependencies

| Risk                                                                                                                        | Likelihood | Impact | Mitigation                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------- |
| Config locking with `proper-lockfile` introduces a new dependency that may fail on exotic filesystems (NFS, Docker volumes) | Low        | Med    | Retry with short delay; if lock fails, fall back to unguarded write and warn.                             |
| Path traversal guard breaks legitimate absolute-path workflows (e.g., user runs from `/` and wants to edit `/etc/hosts`)    | Low        | High   | Reject only if resolved path truly escapes `cwd`. If `cwd === "/"`, any absolute path under `/` is valid. |
| Overlay union refactor introduces rendering glitches (overlay flicker, double-render)                                       | Med        | Med    | Characterization tests before refactor; use React StrictMode to surface double effects.                   |
| Bash ANSI regex strips too aggressively (removes Unicode combining chars)                                                   | Low        | Med    | Use well-tested ANSI regex from pi-mono; add test with non-ASCII text.                                    |

---

## Documentation / Operational Notes

- Update `DESIGN.md` if any color tokens change (U1).
- Document the `resolveSafePath` guard in any internal tool-authoring docs.
- Add a note in the changelog about user-visible save-error surfacing.

---

## Sources & References

- **Origin TUI redesign plan:** `docs/plans/2026-05-07-001-refactor-tui-redesign-plan.md`
- **Expert audit reports:** `docs/research/expert-proposals/2026-05-08-0131/`
  - `security-sentinel.md` (path traversal, credential permissions)
  - `maintainability-reviewer.md` (silent failures, unhandled promises)
  - `testing-reviewer.md` (contrast failures, untested abstractions)
- **Upstream reference repo:** `/Volumes/BIWIN/CODES/pi-mono`
  - `packages/coding-agent/src/core/settings-manager.ts`
  - `packages/coding-agent/src/core/auth-storage.ts`
  - `packages/coding-agent/src/core/bash-executor.ts`
  - `packages/coding-agent/src/core/tools/path-utils.ts`
  - `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
