---
title: Quick Wins — Fix Build, Types, Tests, and Add Qlty Gate
 type: refactor
status: active
date: 2026-05-08
deepened: 2026-05-08
origin: code-overhaul-review (Section 2 quick wins: Steps 1–5)
---

# Quick Wins — Fix Build, Types, Tests, and Add Qlty Gate

## Overview

The kimiflare codebase has a broken build (`npm run build` fails), a broken type-check (`tsc --noEmit` emits 12 errors), 3 failing tests, and no quality gate (no ESLint, Prettier, or qlty). These are all high-impact, low-effort fixes that unblock development and satisfy the constitutional qlty mandate in `~/AGENTS.md`.

This plan targets the five "DO FIRST" items from the full audit's impact/effort matrix.

---

## Problem Frame

- **Build failure**: `tsup` bundles `playwright-core` and `isolated-vm` (both should be external), causing esbuild resolution errors.
- **Type errors**: `@types/proper-lockfile` is missing; `isolated-vm` has no type declarations (optional dep, not installed); `coauthor` type drifts between `boolean` (config) and `{name, email}` (ToolContext); `sandbox.test.ts` mocks use stale types.
- **Test failures**: `sandbox.test.ts` fails because mocks expect old `coauthor: boolean` and wrong `PermissionAsker` return type; `browser.test.ts` is non-hermetic (requires Playwright browser binaries).
- **No quality gate**: `~/AGENTS.md` mandates qlty as the default repo-level quality gate. This repo has none.

---

## Requirements Trace

- R1. `npm run build` must pass cleanly.
- R2. `npm run typecheck` must pass with zero errors.
- R3. `npm test` must pass with zero failures.
- R4. The repo must have a runnable qlty configuration with at least TypeScript ESLint and Prettier plugins.
- R5. No behavioral changes — these are purely build/test/quality fixes.

---

## Scope Boundaries

- No refactoring of `app.tsx` decomposition (deferred to follow-up plan).
- No upgrade of `diff` 7→9 (breaking change, separate plan).
- No upgrade of `commander` 12→14 (low impact, deferred).
- No new subsystem tests (out of scope for quick wins).
- No removal of the `kimiflare` self-dependency (may be intentional for a workspace pattern — verify before acting).

### Deferred to Follow-Up Work

- Decompose `app.tsx` into coordinators: separate plan after quick wins.
- Upgrade `diff` from 7.0.0 to 9.0.0 (DoS vulnerability, requires diff API audit).
- Add missing subsystem tests (memory, LSP, MCP, remote).
- Evaluate TypeScript 5.9.3 stability downgrade.

---

## Context & Research

### Relevant Code and Patterns

- `src/config.ts` — declares `coauthor?: boolean` in `KimiConfig`, but callers in `src/index.tsx:300` and `src/app.tsx:1730` transform it to `{name, email}` before passing to `runAgentTurn`.
- `src/tools/registry.ts:8` — `ToolContext` expects `coauthor?: { name: string; email: string }`.
- `src/agent/loop.ts:51` — `AgentTurnOpts` expects `coauthor?: { name: string; email: string }`.
- `src/code-mode/sandbox.test.ts` — mocks use `coauthor: false` (boolean), wrong `PermissionAsker` return type (`Promise<boolean>` vs `Promise<PermissionDecision>`), and a partial `ToolExecutor` mock.
- `src/tools/browser.test.ts` — expects `browserFetchTool` to catch a Playwright import error, but `playwright` is installed as a devDependency; the real failure is `chromium.launch()` missing browser binaries.
- `tsup.config.ts` — `external` array omits `playwright-core` and `isolated-vm`.
- `src/code-mode/sandbox.ts:121,144` — dynamic imports of `isolated-vm` fail typecheck when the package is not installed.

### External References

- qlty CLI: installed at `/Users/huy/.qlty/bin/qlty` (system install, not npm). Use direct binary invocation.

---

## Key Technical Decisions

1. **Unify `coauthor` at the seam, not the config**: Keep `KimiConfig.coauthor` as `boolean` (user-facing), but resolve it to the object form immediately after `loadConfig()`. All downstream types (`AgentTurnOpts`, `ToolContext`) already expect the object. Fix the test mocks to match.
2. **Shim `isolated-vm` types, don't install the package**: It's an optional native dependency that requires compilation. A 2-line `src/types/isolated-vm.d.ts` is the minimal fix.
3. **Mock `playwright` import in browser test**: Use `node:test`'s `mock.module` (Node 20+) to make the `playwright` import throw, so the graceful-error path is exercised hermetically.
4. **qlty init + manual plugin selection**: `qlty init` auto-detects. Add `@qlty/typescript-eslint` and `prettier` explicitly. Wire a pre-commit hook after initial config is committed.

---

## Open Questions

### Resolved During Planning

- **Should we install `isolated-vm`?** No — it's an optional native dep that fails on many platforms. The code already has a fallback to `node:vm`. We only need types to pass typecheck.
- **Should we fix `coauthor` in config.ts or in tests?** Fix both: config loading should produce consistent types, and tests must match the actual interface.
- **Qlty or ESLint+Prettier directly?** Qlty — mandated by `~/AGENTS.md`. It's already installed system-wide.

### Deferred to Implementation

- **Exact qlty rule overrides**: Tuned after initial `qlty init` output is visible.
- **Pre-commit hook method**: Decided after qlty config is in place (Git 2.54 config hooks vs Husky).

---

## Output Structure

No new directories beyond standard outputs:

```
src/
  types/
    isolated-vm.d.ts          ← new shim
.qlty/
  qlty.toml                   ← generated by qlty init, then tweaked
package.json                  ← modified
package-lock.json             ← modified (npm install)
tsconfig.json                 ← modified (if needed for types path)
```

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Fix coauthor   │────▶│  Fix build +    │────▶│  Fix tests      │
│  type drift     │     │  type errors    │     │  (3 failures)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────┐
                    │  Add qlty gate  │
                    │  (eslint + fmt) │
                    └─────────────────┘
                                 │
                                 ▼
                    ┌─────────────────┐
                    │  Verify all     │
                    │  green          │
                    └─────────────────┘
```

---

## Implementation Units

- U1. **Fix coauthor type mismatch across config, loop, registry, and tests**

**Goal:** Eliminate type errors where `coauthor` is `boolean` in config/tests but `{ name: string; email: string }` in runtime contracts.

**Requirements:** R2, R3

**Dependencies:** None

**Files:**

- Modify: `src/config.ts`
- Modify: `src/code-mode/sandbox.test.ts`
- Modify: `src/tools/registry.ts` (if type adjustment needed)
- Test: `src/code-mode/sandbox.test.ts` (verify passes after fix)

**Approach:**

1. In `config.ts`, the `KimiConfig` interface keeps `coauthor?: boolean` (user-facing), but `loadConfig()` should resolve it to a normalized internal shape at load time. However, to minimize blast radius: leave `KimiConfig` as-is and instead fix the callers and tests.
2. Actually, the simplest correct fix: `config.ts` already returns `coauthor` as boolean. `index.tsx` and `app.tsx` already transform `boolean → object` inline. The only places typing is wrong are:
   - `sandbox.test.ts` mock `ctx` uses `coauthor: false` where `ToolContext` expects `{name, email} | undefined`
   - `sandbox.test.ts` `mockExecutor` is missing required `ToolExecutor` fields
   - `sandbox.test.ts` `mockAskPermission` returns `Promise<boolean>` where `PermissionDecision` union is expected
3. Fix the test mocks to match real types.
4. Verify `AgentTurnOpts` and `ToolContext` types are consistent (they already are — `coauthor?: {name, email}`).

**Execution note:** Start by running `npm run typecheck` to capture all coauthor-related errors. Fix test mocks first (fastest signal). Then verify no other files need changes.

**Patterns to follow:**

- Existing mock patterns in `src/tools/executor.test.ts` for `ToolExecutor` construction.
- Existing `PermissionAsker` mock in `src/agent/loop.test.ts`.

**Test scenarios:**

- **Happy path**: `sandbox.test.ts` compiles and passes after mock type fixes.
- **Edge case**: Verify `coauthor: undefined` in `ToolContext` is accepted (bash tool skips injection).
- **Integration**: `npm run typecheck` shows zero errors in `code-mode/` directory.

**Verification:**

- `npx tsc --noEmit src/code-mode/sandbox.test.ts` passes
- `npm test -- src/code-mode/sandbox.test.ts` passes

---

- U2. **Fix typecheck errors for missing type declarations**

**Goal:** Resolve all `tsc --noEmit` errors from missing `@types/proper-lockfile` and missing `isolated-vm` declarations.

**Requirements:** R2

**Dependencies:** U1 (for clean test signal)

**Files:**

- Create: `src/types/isolated-vm.d.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json` (if types path needs inclusion)

**Approach:**

1. Install `@types/proper-lockfile` as devDependency (`npm install -D @types/proper-lockfile`).
2. Create `src/types/isolated-vm.d.ts` with `declare module "isolated-vm";`.
3. Verify `tsconfig.json` includes `src/types/**/*.d.ts` (it already includes `src/**/*`, so this should work).

**Patterns to follow:**

- Existing `src/types/playwright.d.ts` for type declarations pattern.

**Test scenarios:**

- **Happy path**: `npm run typecheck` passes with zero errors.
- **Edge case**: `npm run typecheck` still passes when `isolated-vm` is not installed (optional dep).

**Verification:**

- `npm run typecheck` exits 0

---

- U3. **Fix build failure by marking optional/native deps as external**

**Goal:** `npm run build` passes without esbuild resolution errors.

**Requirements:** R1

**Dependencies:** U2

**Files:**

- Modify: `tsup.config.ts`

**Approach:**

1. Add `playwright-core` to `external` array in `tsup.config.ts`.
2. Add `isolated-vm` to `external` array in `tsup.config.ts`.
3. Re-run `npm run build` to verify.

**Patterns to follow:**

- Existing `external` array already lists `ink`, `react`, `commander`, etc.

**Test scenarios:**

- **Happy path**: `npm run build` completes with zero errors.
- **Edge case**: Build output `dist/` does not contain bundled `playwright-core` or `isolated-vm` code.

**Verification:**

- `npm run build` exits 0
- `grep -r "playwright-core\|isolated-vm" dist/ || true` shows no bundled references

---

- U4. **Fix non-hermetic browser test**

**Goal:** `src/tools/browser.test.ts` passes without requiring Playwright browser binaries to be installed.

**Requirements:** R3

**Dependencies:** U3 (for clean build signal)

**Files:**

- Modify: `src/tools/browser.test.ts`

**Approach:**

1. The test currently expects `browserFetchTool.run()` to return a "Playwright is not installed" message.
2. But `playwright` IS installed (devDependency). The import succeeds, and then `chromium.launch()` fails because browser binaries are missing.
3. Use `node:test`'s `mock.module()` (Node 20+) or `mock.fn()` to make the `playwright` import throw during this test, forcing the graceful-error path.
4. Alternative if mocking is problematic: check for browser binary existence at test start and skip with a descriptive message, then add a second mocked path.
5. Preferred: Mock the import. This makes the test hermetic and fast.

**Execution note:** If `mock.module()` proves unstable in Node 20's test runner, fall back to verifying the current error path and adjusting the assertion to match what actually happens when binaries are missing (the error from `chromium.launch`). Document the fallback choice.

**Patterns to follow:**

- Existing mock patterns in `src/agent/client.test.ts` where `globalThis.fetch` is mocked.

**Test scenarios:**

- **Happy path**: Browser tool returns helpful "not installed" message when `playwright` import throws.
- **Error path**: Browser tool returns helpful message when `playwright` is installed but `chromium.launch` fails (fallback coverage).
- **Integration**: Test runs in <200ms and does not touch filesystem outside `/tmp`.

**Verification:**

- `npm test -- src/tools/browser.test.ts` passes
- Test completes without downloading browser binaries

---

- U5. **Initialize qlty with TypeScript ESLint and Prettier**

**Goal:** Repository has a runnable, configured qlty quality gate.

**Requirements:** R4

**Dependencies:** U1–U4 (quality gate should run on clean code, not failing code)

**Files:**

- Create: `.qlty/qlty.toml`
- Modify: `.gitignore` (if qlty generates cache dirs)
- Modify: `package.json` (optional: add `lint`/`format` scripts)

**Approach:**

1. Run `qlty init` in repo root. This auto-detects TypeScript, React, and Node.
2. Manually verify/adjust `.qlty/qlty.toml`:
   - Enable `@qlty/typescript-eslint` with `recommended` rules.
   - Enable `prettier` for formatting.
   - Disable any rules that conflict with existing patterns (e.g., if `import/extensions` rule conflicts with Node ESM `.js` extensions).
3. Run `qlty check` to see initial findings. Fix any obvious true positives in the touched files (not the whole codebase — that's follow-up work).
4. Document intentionally disabled rules if any.
5. Add npm scripts to `package.json`: `"lint": "qlty check"`, `"format": "qlty fmt"`.

**Execution note:** Do NOT fail this unit because qlty finds issues in untouched legacy code. The goal is a configured gate, not a fully green lint run across the entire repo. Document the delta.

**Patterns to follow:**

- `~/AGENTS.md` qlty mandate: "Every code repo must use qlty as the default repo-level quality gate."

**Test scenarios:**

- **Happy path**: `qlty check` runs without configuration errors.
- **Integration**: `npm run lint` executes successfully (may report findings, but exits cleanly or with documented overrides).
- **Edge case**: `qlty fmt` formats a file correctly (test on one intentionally misformatted file).

**Verification:**

- `qlty check` executes and produces output
- `qlty fmt` executes without error
- Config is committed and documented

---

## System-Wide Impact

- **package.json changes**: New devDependency `@types/proper-lockfile`. No runtime dep changes.
- **tsup.config.ts changes**: Two new externals. No behavior change — only bundling rules.
- **tsconfig.json**: No changes expected (already includes `src/**/*`, which covers `.d.ts`). Verify.
- **No changes to app behavior**: R5 is strict — these are build/test/config fixes only.
- **Qlty introduction**: First enforcement gate. May surface existing lint issues. Policy: fix only touched files during this work; bulk cleanup is follow-up.

---

## Risks & Dependencies

| Risk                                                              | Mitigation                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@types/proper-lockfile` does not exist on npm                    | Already verified: package exists. If install fails, create a 2-line `.d.ts` shim instead.     |
| `mock.module()` in Node 20's test runner is experimental/unstable | Fallback: adjust test to match actual `chromium.launch` error when binaries are missing.      |
| qlty init produces config incompatible with ESM `.js` imports     | After init, manually review and disable conflicting `@qlty/typescript-eslint` rules.          |
| Fixing test mocks reveals deeper type issues                      | Run `npm run typecheck` after each unit. Stop and reassess if error count grows unexpectedly. |

---

## Documentation / Operational Notes

- After qlty is initialized, document the `lint` and `format` npm scripts in the README's "Development" section (minimal update, or defer to follow-up).
- The `kimiflare` self-dependency in `package.json` was noted but intentionally NOT fixed in this plan — verify intent before removing.

---

## Sources & References

- **Origin document:** Code-overhaul-review Section 2 (quick wins matrix)
- Related audit: `docs/plans/2026-05-08-001-feat-audit-p0-pi-mono-ports-plan.md`
- AGENTS.md mandate: `~/AGENTS.md` qlty enforcement rule
- Test skills loaded: `/test-systematically`, `/tdd-methodology`
