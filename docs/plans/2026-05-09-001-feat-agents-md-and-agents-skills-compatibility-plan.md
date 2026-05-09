---
title: feat: AGENTS.md + .agents/skills/ compatibility for kimiflare
type: feat
status: active
date: 2026-05-09
issues:
  - https://github.com/sinameraji/kimiflare/issues/356
  - https://github.com/sinameraji/kimiflare/issues/357
  - https://github.com/sinameraji/kimiflare/issues/358
  - https://github.com/sinameraji/kimiflare/issues/359
  - https://github.com/sinameraji/kimiflare/issues/360
---

# feat: AGENTS.md + .agents/skills/ compatibility for kimiflare

## Overview

kimiflare currently only loads context from `KIMI.md`/`KIMIFLARE.md` at the project root and skills from `.kimiflare/skills/` using a custom format with router-based full-body injection. This plan adds compatibility with the industry-standard `AGENTS.md` context file convention and `.agents/skills/` skill discovery — the same convention used by pi, Claude Code, Codex, Cursor, Gemini, Ampcode, and others.

The goal is that users can share project context and skills across tools without duplicating files. `KIMI.md` and `.kimiflare/skills/` remain as the native authoritative locations. The router and custom skill format are removed.

---

## Problem Frame

kimiflare is the odd one out. Every other tool picks up `AGENTS.md` from the repo root, but kimiflare only reads `KIMI.md`. Users who maintain `AGENTS.md` for pi/Claude Code/Codex must also maintain a separate `KIMI.md` for kimiflare. Similarly, skills installed in `.agents/skills/` for other tools are invisible to kimiflare.

The custom skill format (flat `.md` files with `match`/`priority`/`scope` frontmatter, router-based token budgeting, full body injection) adds friction without benefit — the industry standard (Agent Skills spec) uses progressive disclosure: catalog all skills as name+description+location, model reads on demand.

---

## Scope Boundaries

- AGENTS.md is appended after KIMI.md — KIMI.md is authoritative
- AGENT.md (singular) is removed from the recognized filename list
- Only AGENTS.md (bare) participates in the walk-up. KIMI.md remains single-file-at-cwd only
- No staleness/drift detection for AGENTS.md — that remains KIMI.md-only (KIMI.md is agent-generated, AGENTS.md is user-authored static canon)
- No trust gating for .agents/skills/ — skills in untrusted repos are loaded same as always
- The intent classifier (`src/intent/classify.ts`) is not changed — the tier system still exists for reasoning effort even though skill routing is removed

---

## Context & Research

### Relevant Code and Patterns

- `src/agent/system-prompt.ts` — `loadContextFile()` function loads a single file from CONTEXT_FILENAMES; `buildSessionPrefix()` renders it after env block. This is the primary file for AGENTS.md changes.
- `src/skills/loader.ts` — `loadSkillsFromDir()` scans a directory for `.md` files with frontmatter. Needs a second loader for `SKILL.md`-inside-subdir format (or a unified one).
- `src/skills/router.ts` — `selectSkills()` does keyword matching, token budgeting, priority sorting. Entirely dead code under the catalog model.
- `src/skills/router.test.ts` — tests for the router. Delete with the router.
- `src/skills/manager.ts` — `getSkillDirs()`, `listAllSkills()`, CRUD operations. Needs `.agents/` paths and multi-location awareness.
- `src/app.tsx` — lines ~3246-3292 wire `routeSkills()` into the turn loop, pass `selectedSkills` to `buildSessionPrefix()`. Remove `routeSkills`, pass full catalog instead.
- `src/mode.ts` — untouched by these changes (mode system is orthogonal).

### Existing Plans

- `docs/plans/skills-and-session-tree-plan.md` — the original skills design. The current custom-format + router implementation came from this plan. This compatibility plan replaces that approach.

### Key Technical Decisions

- **KIMI.md authoritative, AGENTS.md appended after**: kimiflare's own native format should always win over the compat format. The user explicitly chose kimiflare — KIMI.md reflects their intent.
- **AGENT.md removed from CONTEXT_FILENAMES**: The industry settled on `AGENTS.md` (plural). Supporting the singular form alongside the plural creates confusion about which file is loaded when both exist. Keeping both means maintenance burden for zero benefit.
- **Global at `~/.agents/AGENTS.md`, not `~/AGENTS.md`**: The `.agents/` convention is the cross-client standard. Skills already use `.agents/skills/`. Keeping AGENTS.md under the same prefix is consistent.
- **Walk-up looks for bare `AGENTS.md`, not `.agents/AGENTS.md`**: Other tools (pi, Claude Code) look for bare `AGENTS.md` in ancestor directories. Matching that convention means users can drop a single `AGENTS.md` in a parent repo without needing a `.agents/` subdirectory.
- **`.kimiflare/skills/` > `.agents/skills/` by name at project scope**: The tool's own config directory should be authoritative over a cross-client compatibility directory. If a user explicitly put a skill in `.kimiflare/skills/`, their version shadows whatever is in `.agents/skills/`.
- **No router, no matching, no token budget, no body injection**: The Agent Skills spec says: "Most implementations rely on the model's own judgment as the activation mechanism, rather than implementing harness-side trigger matching or keyword detection." Full body injection wastes tokens for skills that may never be used.
- **All skill locations use `SKILL.md`-inside-subdir format**: One consistent standard everywhere simplifies the loader. No more flat `.md` files with custom frontmatter.
- **Dynamic AGENTS.md injection via tool-call interception**: Detecting directory changes by comparing the working directory before/after each tool call. No shell parsing, no bash monitoring — just diffing the execution context's cwd against the last known value.

---

## Implementation Units

- U1. **AGENTS.md static loading — global + walk-up + cwd**

**Goal:** Add `~/.agents/AGENTS.md` (global) + walk-up from cwd to git root collecting bare `AGENTS.md` files. Append all content after KIMI.md in the system prompt. Remove `AGENT.md` from CONTEXT_FILENAMES.

**Requirements:** KIMI.md authoritative, AGENTS.md appended after. Staleness detection remains KIMI.md-only.

**Dependencies:** None

**Files:**
- Modify: `src/agent/system-prompt.ts`
- Test: `src/agent/system-prompt.test.ts` (create)

**Approach:**
- Rename `loadContextFile()` to `loadKimiflareContextFile()` returning KIMI.md data (unchanged behavior, just renamed for clarity)
- Add `loadAgentsContextFiles(cwd): ContextFile[]` that:
  1. Loads `~/.agents/AGENTS.md` if present
  2. Walks up from `cwd` to the nearest git root (via `findGitRepoRoot` or similar), collects all bare `AGENTS.md` files found along the way
  3. Returns them in order: global, then farthest ancestor → nearest → cwd
- Update `buildSessionPrefix()` to render both blocks:
  ```
  [KIMI.md content — unchanged]
  [AGENTS.md — global, then ancestors, then cwd]
  ```
- Change `CONTEXT_FILENAMES` from `["KIMI.md", "KIMIFLARE.md", "AGENT.md"]` to `["KIMI.md", "KIMIFLARE.md"]`
- Walk-up stops at git root (not filesystem root), matching pi's `.agents/skills/` behavior. Use `findGitRepoRoot` from `src/util/git.ts` or an inline implementation (check for `.git` dir in each parent).

**Patterns to follow:**
- Existing `loadContextFile()` for the stat + read + size check pattern
- The git root detection in `src/skills/loader.ts` or package-manager.js in pi (check parent dirs for `.git` directory)

**Test scenarios:**
- Happy path: `~/.agents/AGENTS.md` exists → content appears after KIMI.md in prompt
- Happy path: walk-up finds 3 AGENTS.md files in ancestor chain → all appear in order
- Edge case: no AGENTS.md found anywhere → no AGENTS.md section appears (KIMI.md unchanged)
- Edge case: AGENTS.md exceeds 20 KB → silently skipped (same as existing MAX_CONTEXT_BYTES)
- Edge case: AGENT.md (singular) at cwd → not loaded (prove it no longer appears)
- Edge case: no git root found (outside a repo) → walk up to cwd only, still works
- Integration: KIMI.md + AGENTS.md both present → KIMI.md first, AGENTS.md appended

**Verification:**
- Unit tests pass for load and formatting
- Manual: drop a test AGENTS.md in a parent dir, run kimiflare, verify system prompt shows both KIMI.md and AGENTS.md content in correct order

---

- U2. **.agents/skills/ discovery + skill catalog XML**

**Goal:** Add `.agents/skills/` discovery across all scopes (project cwd, ancestors, `~/.agents/skills/`). List all skills from all locations in an `<available_skills>` XML block in the system prompt. `.kimiflare/skills/` name shadows `.agents/skills/` at the same project scope.

**Requirements:** All skills listed as name + description + location XML. No body injection. No matching. No budget. `.kimiflare/skills/` > `.agents/skills/` by name at project scope.

**Dependencies:** None (independent of U1)

**Files:**
- Modify: `src/skills/loader.ts`
- Modify: `src/skills/manager.ts`
- Modify: `src/agent/system-prompt.ts`
- Modify: `src/app.tsx`
- Create: `src/skills/discovery.ts` (new module for .agents/ path enumeration)
- Test: `src/skills/discovery.test.ts` (create)

**Approach:**
- Add `SKILL.md`-dir scanning in `src/skills/loader.ts`: a function `loadSkillsFromAgentsDir(dir)` that scans for subdirectories containing `SKILL.md`, reads frontmatter, returns skills. This is separate from the existing flat-`.md` loader (which still serves `.kimiflare/skills/` until U3 unifies them).
- In `src/skills/manager.ts`, update `getSkillDirs()` to return both `.kimiflare/` and `.agents/` dir info. Update `listAllSkills()` to merge both, applying `.kimiflare/skills/` > `.agents/skills/` by name at project scope.
- Create `src/skills/discovery.ts` for ancestor `.agents/skills/` scanning (walk up from cwd to git root, collect all `.agents/skills/` dirs, scan each for skills).
- In `src/app.tsx`: at session start, call `listAllSkills()` and pass the merged list to `buildSessionPrefix()`. Remove the `routeSkills` call (moved to U3). Add `<available_skills>` XML rendering in `buildSessionPrefix()` — all skills, name + description + location, with instructions for model to `read` on demand.
- Update `SystemPromptOpts` to accept a skill catalog list instead of `selectedSkills`.
- Respect `.gitignore` during .agents/ directory scanning. Max depth 6, max 1000 directories to prevent runaway scanning.

**Patterns to follow:**
- The existing `collectSkillEntries` pattern from pi's source (scan for subdirs with `SKILL.md`, recurse but stop at first SKILL.md)
- The existing `loadSkillFromFile` in `loader.ts` for frontmatter parsing

**Test scenarios:**
- Happy path: `cwd/.agents/skills/foo/SKILL.md` → skill appears in XML catalog
- Happy path: `.kimiflare/skills/bar/SKILL.md` and `.agents/skills/bar/SKILL.md` → only `.kimiflare` version appears (shadowing)
- Happy path: ancestor `.agents/skills/baz/SKILL.md` → appears in catalog
- Happy path: `~/.agents/skills/qux/SKILL.md` → appears in catalog
- Edge case: empty `.agents/skills/` directory → no `<available_skills>` block
- Edge case: `SKILL.md` with missing description → skill is skipped, warning logged
- Edge case: `.agents/skills/README.md` (bare `.md`, not in a subdir) → ignored
- Integration: model `read`s a skill's `location` from the catalog → gets full body

**Verification:**
- Unit tests pass for all locations and shadowing rules
- Manual: create skills in each location, verify XML catalog content, verify model can read the SKILL.md

---

- U3. **Router removal + .kimiflare/skills/ format unification**

**Goal:** Remove `routeSkills()` / `selectSkills()` entirely. Migrate `.kimiflare/skills/` from flat `.md` format to `SKILL.md`-inside-subdir. Simplify Skill type by removing routing-specific fields.

**Requirements:** Skills are no longer matched, budgeted, or body-injected. `.kimiflare/skills/` follows the same `SKILL.md` format as `.agents/skills/`.

**Dependencies:** U2 (catalog infrastructure must exist first)

**Files:**
- Delete: `src/skills/router.ts`
- Delete: `src/skills/router.test.ts`
- Modify: `src/skills/index.ts`
- Modify: `src/skills/loader.ts`
- Modify: `src/skills/manager.ts`
- Modify: `src/skills/types.ts`
- Modify: `src/agent/system-prompt.ts`
- Modify: `src/app.tsx`

**Approach:**
- Delete `src/skills/router.ts` and `src/skills/router.test.ts`
- Simplify `Skill` type in `types.ts`: remove `match`, `scope`, `priority`, `estimatedTokens`. Keep `name`, `description`, `body`, `filePath`, and add an `enabled` flag (still meaningful for catalog exclusion).
- Remove `SkillRoutingResult` and `SkillConflict` types entirely.
- Unify the loader: `.kimiflare/skills/` now uses the same `SKILL.md`-dir scanning as `.agents/skills/`. Flat `.md` files at the root of `.kimiflare/skills/` are ignored (with a logged warning). A migration note in the release changelog.
- In `src/skills/index.ts`, remove `selectSkills` and `routeSkills` exports. Export only `loadSkillsFromDir`, `listAllSkills`, etc.
- In `src/app.tsx`:
  - Remove the `routeSkills()` call (line ~3248), the `skillResult` handling, and the `selectedSkills` mapping
  - Replace with `listAllSkills().all` to get the full merged catalog
  - Pass the catalog to `buildSessionPrefix()` instead of `selectedSkills`
  - Remove `skillsActive` from the meta event (or repurpose to show total catalog count)
- Remove `selectedSkills` from `SystemPromptOpts`. Add `skillCatalog` or similar.
- In `buildSessionPrefix()`: replace the `skillsBlock` (which injected full body) with the `<available_skills>` XML block that lists all skills. Add behavioural instructions alongside the XML telling the model to `read` the SKILL.md at the listed location when relevant.

**Patterns to follow:**
- The XML format from Agent Skills spec (identical to pi's `formatSkillsForPrompt`)
- The existing `formatSkillsForPrompt` code in pi: `<available_skills><skill><name>...</name><description>...</description><location>...</location></skill></available_skills>`

**Test scenarios:**
- Happy path: all skills from all locations appear in XML catalog
- Happy path: flat `.md` in `.kimiflare/skills/` root is ignored (logged warning)
- Edge case: `routeSkills()` / `selectSkills()` no longer exist — import fails
- Edge case: `SkillRoutingResult` and `SkillConflict` no longer exist — import fails
- Edge case: existing `.kimiflare/skills/<name>/SKILL.md` loaded correctly
- Integration: model receives XML catalog, calls `read` on a location, gets full body
- No regression: `.kimiflare/skills/` loading still works with new format
- No regression: `MemoryConflict` — removed entirely (it was part of router)

**Verification:**
- All tests pass (existing skill tests may need updating for new type shapes)
- Router files are deleted
- `npm run typecheck` passes
- Manual: older flat `.md` files ignored; `SKILL.md`-inside-subdir loaded

---

- U4. **Dynamic AGENTS.md injection on directory change**

**Goal:** Detect when the model's working directory changes during a session (via tool-call interception) and dynamically inject any AGENTS.md files from the new directory or its ancestors that haven't yet been injected.

**Requirements:** No shell parsing, no bash monitoring. Tool-call interception — diff the execution cwd before/after each tool call.

**Dependencies:** U1 (static AGENTS.md loading provides the load + format code)

**Files:**
- Modify: `src/app.tsx`
- Create: `src/agent/context-injector.ts` (new module for dynamic injection logic)

**Approach:**
- Create `src/agent/context-injector.ts`:
  - State type: `{ lastCwd: string; injectedPaths: Set<string> }`
  - After each tool call, capture the post-call working directory
  - If it differs from `lastCwd`, walk up from new dir to find AGENTS.md files not in `injectedPaths`
  - Return content blocks to be appended to the session prefix
  - Update `injectedPaths` and `lastCwd`
- In `src/app.tsx`:
  - Add a ref for `contextInjector` state (initialized at session start with the starting cwd and paths from static loading)
  - Hook into the tool-call completion path (the turn loop after each tool result)
  - When new AGENTS.md content is found, re-build `messagesRef.current[1]` (session prefix) to include the new files
  - The re-build uses `buildSessionPrefix()` so no rendering logic is duplicated
- Edge cases:
  - First tool call: starting cwd already covered by static loading from U1
  - `cd` to sibling branch in monorepo: should pick up that branch's AGENTS.md
  - `cd` outside the project: no AGENTS.md likely exists, but should not error
  - Tool call that doesn't change directory: most of them, should be a fast no-op

**Patterns to follow:**
- How `buildSessionPrefix` is already re-executed per turn in `app.tsx` for cache-stable mode
- The walk-up logic from U1 (can share the same `loadAgentsContextFiles` or a subset)

**Test scenarios:**
- Happy path: tool call with `cd` into subdir with AGENTS.md → new content appears in next turn's system prompt
- Happy path: tool call with `cd` into subdir without AGENTS.md → no change
- Edge case: `cd` back to a dir whose AGENTS.md was already injected → no duplicate
- Edge case: `cd` to a dir outside the project → no error, no injection
- Edge case: 10 sequential `cd`s into different subdirs, each with AGENTS.md → all 10 injected over time, no duplicates
- Integration: static AGENTS.md from U1 + dynamic injection → startup paths + runtime paths both present, no overlap

**Verification:**
- Unit tests pass for context-injector logic
- Manual: verify AGENTS.md appears in system prompt after `cd` into a subdirectory that has one

---

- U5. **/skills command — support all skill locations**

**Goal:** Update `/skills` management commands to work across `.kimiflare/skills/`, `.agents/skills/`, and globals. Show location tags and shadowing status.

**Requirements:** Users can see, create, edit, delete, enable, and disable skills from any location.

**Dependencies:** U2 (discovery), U3 (unified format)

**Files:**
- Modify: `src/app.tsx` — `/skills` command handler
- Modify: `src/skills/manager.ts` — add location-aware CRUD

**Approach:**
- Update `/skills list` to group skills by location source, show enabled/disabled status, and flag shadowed skills
- Add `--agents` and `--global` flags to `/skills add` for location targeting
- Update `/skills edit` to open the highest-priority version by default
- Update `/skills delete` with `--all` flag for multi-location removal
- For `/skills enable`/`/skills disable`: exclude from catalog (this is a runtime toggle, not frontmatter modification)

**Test scenarios:**
- Happy path: `/skills list` shows skills from all locations with source tags
- Happy path: `/skills add foo` creates `.kimiflare/skills/foo/SKILL.md`
- Happy path: `/skills add foo --agents` creates `.agents/skills/foo/SKILL.md`
- Edge case: `/skills delete foo` removes only the highest-priority copy
- Edge case: `/skills delete foo --all` removes all copies
- Edge case: `/skills disable foo` removes from catalog, `/skills enable foo` restores

**Verification:**
- Manual: run each command variant, verify output matches expected

---

## System-Wide Impact

- **Interaction graph:** `buildSessionPrefix()` is the main output surface. U1 and U2 directly modify it. U4 re-triggers it dynamically. U3 changes how skills are passed in. These all converge on the same function — care needed to avoid conflicts during parallel implementation.
- **Error propagation:** AGENTS.md loading errors are non-fatal (silent skip). Skill loading errors are non-fatal (skill skipped). No new error conditions that could crash the app.
- **State lifecycle risks:** The dynamic injection (U4) adds mutable session state (`lastCwd`, `injectedPaths`). This state must survive context compaction. Track it in a ref (not in message state).
- **API surface parity:** The `<available_skills>` XML format should match the Agent Skills spec exactly so that skills are portable between tools. The `location` field must be an absolute path.
- **Unchanged invariants:** `KIMI.md` loading is unchanged. The mode system is unchanged. The intent classifier is unchanged. Tool permissions are unchanged. Session persistence is unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| U3 format migration breaks existing `.kimiflare/skills/` users | Include a one-time migration notice in the release changelog. The flat `.md` files simply stop being discovered — no data loss. Users rename them to `SKILL.md` inside a subdir. |
| U4 dynamic injection misses a directory change (e.g., tool call doesn't expose cwd) | After each tool call, also check `process.cwd()` as a fallback. If the tool execution context provides cwd, use that as primary. |
| Ancestor scanning in U2 hits a large monorepo with many `.agents/skills/` dirs | Cap at max depth 6 and max 1000 dirs. Respect `.gitignore` patterns. |
| Name collision between `.kimiflare/skills/` and `.agents/skills/` causes user confusion | Log a warning when a shadowing occurs. `/skills list` shows shadowed skills with a `SHADOWED` tag. |
| U1 walk-up to git root vs filesystem root: what if there's no `.git`? | Fall back to cwd-only. The walk-up is an optimization — no `.git` means no ancestor expectation. |

---

## Sources & References

- **Issues:** #356, #357, #358, #359, #360
- **Agent Skills spec (integration guide):** https://agentskills.io/integrate-skills
- **Agent Skills spec (format):** https://agentskills.io/specification
- **Pi skills documentation:** `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- **Pi source — skills.js:** `dist/core/skills.js` in pi package (formatSkillsForPrompt, loadSkills, loadSkillsFromDir)
