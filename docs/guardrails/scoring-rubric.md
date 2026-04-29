# Automated PR Review Scoring Rubric

> **Purpose:** Machine-readable scoring criteria for an AI agent or GitHub Action to evaluate PRs against the guardrails.
>
> **Usage:** Each rule is scored 0–3. A PR must score ≥ 2 on all critical rules and average ≥ 2.5 overall to pass.

---

## Scoring Scale

| Score | Meaning |
|-------|---------|
| 3 — **Exceeds** | Not only satisfies the rule but includes tests, documentation, or measurable improvement. |
| 2 — **Meets** | Satisfies the rule with no concerns. |
| 1 — **Partial** | Attempts to satisfy the rule but has gaps or risks. |
| 0 — **Fails** | Clearly violates the rule or introduces regression. |
| N/A | Rule does not apply to this PR's scope. |

---

## Critical Rules (Must Score ≥ 2)

These rules are non-negotiable. A score of 0 or 1 blocks the PR.

### CRIT-1: TypeScript Compiles
- **Source:** Guardrail 1.1
- **Check:** `npm run typecheck` exits 0.
- **Auto-check:** ✅ Yes — CI command.
- **Scoring:**
  - 3: Adds new strict types, removes existing `any`.
  - 2: Compiles cleanly, no new type looseness.
  - 1: Compiles but introduces `as` casts or `// @ts-ignore`.
  - 0: Fails `tsc --noEmit`.

### CRIT-2: Tests Pass
- **Source:** Guardrail 8.1
- **Check:** `npm test` exits 0.
- **Auto-check:** ✅ Yes — CI command.
- **Scoring:**
  - 3: Adds tests for new code with >80% branch coverage.
  - 2: All existing tests pass; new code has at least smoke tests.
  - 1: Tests pass but new code is untested.
  - 0: Tests fail or CI broken.

### CRIT-3: Build Succeeds
- **Source:** Guardrail 1.2
- **Check:** `npm run build` produces valid `dist/` and `bin/kimiflare.mjs`.
- **Auto-check:** ✅ Yes — CI command.
- **Scoring:**
  - 3: Build output size decreases or stays flat.
  - 2: Builds successfully.
  - 1: Builds with warnings.
  - 0: Build fails.

### CRIT-4: No Path Traversal
- **Source:** Guardrail 6.1
- **Check:** No new file operations without `resolvePath()` or `isPathOutside()` guards.
- **Auto-check:** ⚠️ Partial — static analysis via grep.
- **Scoring:**
  - 3: New file ops use both resolve and guard, with tests.
  - 2: Uses existing safe path utilities.
  - 1: Uses path operations but no obvious traversal bug.
  - 0: Raw `fs.readFile(userInput)` or similar.

### CRIT-5: No Secret Leakage
- **Source:** Guardrail 6.3
- **Check:** No new logging of credentials, tokens, or config values.
- **Auto-check:** ⚠️ Partial — grep for `apiToken`, `apiKey`, `password` in diff.
- **Scoring:**
  - 3: Adds redaction for new sensitive fields.
  - 2: No new secret exposure.
  - 1: Refactors near secrets but doesn't add exposure.
  - 0: Logs or stores credentials in plain text.

### CRIT-6: Cache Stability Preserved
- **Source:** Guardrail 2.1
- **Check:** No new volatile data in system prompt or tool definitions.
- **Auto-check:** ⚠️ Partial — requires semantic review.
- **Scoring:**
  - 3: Improves cache hit ratio (measured).
  - 2: No change to cache-stable prefixes.
  - 1: Adds data to prompt but argues it's necessary.
  - 0: Adds timestamps, random IDs, or unordered data to cache-stable sections.

### CRIT-7: CLI Entry Point Reaches TUI
- **Source:** Guardrail 1.5
- **Check:** Bare `kimiflare` invocation must enter `main()` (the TUI), not print commander help. If the diff adds a `program.command(...)` subcommand, it must also add or preserve a root `program.action(() => {})` before `program.parse()`.
- **Auto-check:** ✅ Yes — `grep -E 'program\.command\(' src/index.tsx` triggers a required check for `program.action(` in the same file. Smoke: `node bin/kimiflare.mjs </dev/null` must exit with the "interactive mode requires a TTY" message, not the commander `Usage:` block.
- **Scoring:**
  - 3: Adds a subcommand AND a regression test that asserts bare invocation reaches `main()`.
  - 2: Adds a subcommand with the root `.action()` preserved; or no CLI surface change.
  - 1: Adds a subcommand with the root `.action()` preserved but no smoke test.
  - 0: Adds a subcommand without a root `.action()` — bare `kimiflare` will print help and exit (v0.20.0 / `feat/cost-attribution` regression).

---

## High-Priority Rules (Average Must Be ≥ 2)

### HP-1: Token Efficiency
- **Source:** Guardrail 2
- **Check:** No relaxation of reducer defaults; no new unmeasured LLM calls.
- **Auto-check:** ⚠️ Partial — grep for reducer config changes, new `runKimi` calls.
- **Scoring:**
  - 3: Reduces tokens per turn (measured via cost-debug).
  - 2: No regression in token count.
  - 1: Slight increase with justification.
  - 0: Significant increase without measurement.

### HP-2: Agent Loop Safety
- **Source:** Guardrail 3
- **Check:** No removal of loop guardrails; no new infinite-loop risks.
- **Auto-check:** ⚠️ Partial — grep for `while (true)`, `for (;;)`, recursion.
- **Scoring:**
  - 3: Adds new guardrail or improves loop detection.
  - 2: No change to loop safety.
  - 1: Adds iteration without clear bound.
  - 0: Removes loop guardrails or adds unbounded recursion.

### HP-3: Graceful Degradation
- **Source:** Guardrail 9.4
- **Check:** Optional subsystems fail non-fatally.
- **Auto-check:** ⚠️ Partial — grep for `throw` in optional init paths.
- **Scoring:**
  - 3: Adds graceful fallback for new optional dependency.
  - 2: Existing degradation paths preserved.
  - 1: New dependency without fallback.
  - 0: Hard failure on missing optional component.

### HP-4: Data Integrity
- **Source:** Guardrail 4
- **Check:** Schema migrations, serialization, and retention policies respected.
- **Auto-check:** ⚠️ Partial — grep for `ALTER TABLE`, schema changes.
- **Scoring:**
  - 3: Adds migration with backward compatibility and tests.
  - 2: No schema changes; or changes are additive with defaults.
  - 1: Schema change without migration.
  - 0: Breaking schema change without backward compatibility.

### HP-5: TUI Stability
- **Source:** Guardrail 5
- **Check:** No new unbounded state growth; event keys are stable.
- **Auto-check:** ⚠️ Partial — grep for `new Map()`, `new Set()`, array pushes without bounds.
- **Scoring:**
  - 3: Fixes existing TUI memory leak or adds bounds.
  - 2: No new unbounded growth.
  - 1: Adds state without explicit cap.
  - 0: Adds obvious memory leak or breaks Static rendering.

---

## Standard Rules (Tracked, Not Blocking)

### STD-1: Documentation
- **Source:** Guardrail 9.2
- **Check:** New features documented in help menu, KIMI.md, or guardrails.
- **Scoring:**
  - 3: Updates all relevant docs including guardrails.
  - 2: Updates KIMI.md or help menu.
  - 1: Code comments only.
  - 0: No documentation.

### STD-2: Determinism
- **Source:** Guardrail 9.3
- **Check:** Generated content uses `stableStringify()` and sorted iteration.
- **Scoring:**
  - 3: Adds determinism where it was missing.
  - 2: Preserves existing determinism.
  - 1: Uses iteration without explicit sorting.
  - 0: Introduces non-deterministic output that affects caching.

### STD-3: Error Handling
- **Source:** Guardrail 1.3, 3.4
- **Check:** New async operations have `try/catch` or `.catch()`.
- **Scoring:**
  - 3: Adds structured error types and recovery paths.
  - 2: Basic try/catch present.
  - 1: Some paths unhandled.
  - 0: Naked awaits on fallible operations.

### STD-4: Test Quality
- **Source:** Guardrail 8
- **Check:** Tests are meaningful, not just coverage padding.
- **Scoring:**
  - 3: Tests verify behavior, not just execution.
  - 2: Tests cover happy path and one error case.
  - 1: Tests exist but are shallow.
  - 0: No tests for new code.

---

## Scoring Worksheet Template

```markdown
## PR Guardrail Scorecard

| Rule | Score | Notes |
|------|-------|-------|
| CRIT-1 TypeScript | 2 | Compiles cleanly |
| CRIT-2 Tests | 3 | Added 4 new tests |
| CRIT-3 Build | 2 | No size change |
| CRIT-4 Path Safety | 2 | Uses resolvePath |
| CRIT-5 Secrets | 2 | No new exposure |
| CRIT-6 Cache | 1 | Adds model name to prefix — justified |
| HP-1 Tokens | 2 | No regression |
| HP-2 Loop Safety | 2 | No change |
| HP-3 Degradation | 2 | Fallback present |
| HP-4 Data Integrity | N/A | No schema changes |
| HP-5 TUI | 2 | No new unbounded state |
| STD-1 Docs | 2 | Updated KIMI.md |
| STD-2 Determinism | 2 | stableStringify used |
| STD-3 Errors | 2 | try/catch present |
| STD-4 Test Quality | 3 | Branch coverage 85% |

**Critical Average:** 2.17 / 3 (PASS — all ≥ 2 except CRIT-6 at 1, needs human review)
**High-Priority Average:** 2.00 / 3 (PASS)
**Standard Average:** 2.25 / 3 (PASS)
**Overall Average:** 2.14 / 3 (PASS with CRIT-6 warning)
```

---

## Automated Check Commands

Run these in CI or locally for quick validation:

```bash
# Critical auto-checks
npm run typecheck        # CRIT-1
npm test                 # CRIT-2
npm run build            # CRIT-3

# Partial auto-checks (grep-based)
grep -n "readFile\|writeFile\|readdir" src/**/*.ts | grep -v "resolvePath" | grep -v "test"  # CRIT-4
grep -n "apiToken\|apiKey\|password" src/**/*.ts | grep -v "config.ts" | grep -v "test"      # CRIT-5
grep -n "new Date()\|Math.random()\|crypto.randomUUID()" src/agent/system-prompt.ts          # CRIT-6
grep -n "while (true)\|for (;;)\|while (!done)" src/agent/loop.ts                             # HP-2
grep -n "throw " src/app.tsx | grep -v "AbortError" | grep -v "KimiApiError"                   # HP-3
```

---

*Update this rubric when new guardrail sections are added. Version bump the rubric alongside the guardrails README.*
