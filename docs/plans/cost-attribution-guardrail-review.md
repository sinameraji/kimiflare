# Guardrail Evaluation: Cost Attribution Plan (#196)

> Evaluated against `docs/guardrails/README.md` and `docs/guardrails/scoring-rubric.md`
> Date: 2026-04-29
> Plan: `docs/plans/cost-attribution.md`

---

## Scorecard

| Rule | Score | Notes |
|------|-------|-------|
| CRIT-1 TypeScript | 2 | New strict types (TaskCategory union, report interfaces). No `any`. |
| CRIT-2 Tests | 2 | Plan includes unit tests for heuristic, report, renderer, reconcile, llm-classifier. Fixtures defined. |
| CRIT-3 Build | 2 | New files in `src/cost-attribution/`, additive changes to existing files. No build risk. |
| CRIT-4 Path Safety | 2 | Reads from known data dirs (`~/.local/share/kimiflare/`). No user-provided paths in file ops. |
| CRIT-5 Secrets | 2 | No new credential logging. Classification reads session content but doesn't persist externally. |
| CRIT-6 Cache Stability | 2 | Classification is post-hoc (lazy on `kimiflare cost`). Does not touch agent loop prompts or prefixes. |
| HP-1 Token Efficiency | 2 | LLM fallback ~30% of sessions, ~200 tokens each, cheap model. Documented and justified. |
| HP-2 Agent Loop Safety | 2 | Lazy classification avoids loop entirely. Optional eager hook (v2) must not block — flagged below. |
| HP-3 Graceful Degradation | 3 | Opt-in gated. Falls back to heuristic if LLM fails. Local-only mode if Cloudflare unavailable. |
| HP-4 Data Integrity | 2 | Additive schema changes (optional fields on SessionUsage, CostDebugEntry). No migration needed. |
| HP-5 TUI Stability | N/A | `cost` is a CLI subcommand, not TUI. No new Ink state. |
| STD-1 Documentation | 1 | Plan is thorough but KIMI.md and help menu updates not yet specified. Must be added before merge. |
| STD-2 Determinism | 2 | Heuristic rules are deterministic. LLM results cached. Signals in cost-debug are rule-based. |
| STD-3 Error Handling | 2 | Plan mentions try/catch for file I/O and API calls. Implementation must be verified. |
| STD-4 Test Quality | 2 | Tests cover happy path + error cases. Fixtures for all 22 categories planned. |

**Critical Average:** 2.00 / 3 (PASS — all ≥ 2)
**High-Priority Average:** 2.20 / 3 (PASS)
**Standard Average:** 1.75 / 3 (WARN — STD-1 at 1, needs KIMI.md/help menu update)
**Overall Average:** 2.07 / 3 (PASS with STD-1 warning)

---

## Detailed Section-by-Section Review

### 1. Build & Runtime Safety ✅

**1.1 TypeScript Strictness** — PASS
- New types use strict unions (`TaskCategory = "reading-source-code" | ...`), interfaces with optional fields.
- `noUncheckedIndexedAccess`: Plan accesses `cost-debug.jsonl` entries and `usage.json` sessions. Implementation must guard array accesses or use `!` with justification.
- **Action required:** Ensure `heuristic.ts` handles empty session files gracefully.

**1.2 ESM & Import Conventions** — PASS
- New files will use `.js` extensions and `node:` prefix per project convention.

**1.3 Runtime Error Prevention** — PASS with note
- `JSON.parse()` on `usage.json` and `cost-debug.jsonl` must be wrapped in `try/catch`.
- File I/O (`readFile`, `readdir`) on `sessions/` and data dir must have error handling.
- **Action required:** Verify all `await readFile()` calls in `src/cost-attribution/*.ts` have try/catch.

**1.4 File Size & Memory Limits** — PASS
- Session files are already bounded by existing retention (30 days, 100 files max).
- `cost-debug.jsonl` has rotation at 5MB.
- No new unbounded file reads.

---

### 2. Token Efficiency & Cost Control ✅

**2.1 Prompt Cache Stability** — PASS
- The feature is **entirely post-hoc**. Classification runs on `kimiflare cost`, not during the agent loop.
- No changes to `system-prompt.ts`, `agent/loop.ts` prompt construction, or tool definitions.
- The optional "eager" hook (mentioned as future) must not be implemented in v1 without cache impact analysis.
- **Action required:** Do not add eager classification in Phase 1. Keep it lazy only.

**2.2 Context Window Management** — PASS
- No changes to message history, compaction, or context window.

**2.3 Tool Output Reduction** — PASS
- No changes to reducer config or tool output handling.

**2.4 LLM Call Minimization** — PASS with note
- **2.4.1:** LLM fallback uses cheap model (Llama-4-Scout). ✅
- **2.4.3:** No speculative calls — only on `kimiflare cost` invocation. ✅
- **2.4.4:** Expected call count documented: ~30% of sessions, ~200 tokens each, ~$0.0002/session. ✅
- **Concern:** If user has 200 unclassified sessions and runs `kimiflare cost`, that's ~60 LLM calls at once. Could be slow and cost ~$0.01. Acceptable but should show progress indicator.

**2.5 Cost Visibility** — PASS
- Integrates with existing `usage-tracker.ts` cost data. No duplicate tracking.
- Reconciliation with Cloudflare ground truth is explicitly planned.

---

### 3. Agent Loop Safety ✅

**3.1 Anti-Loop Guardrails** — PASS
- No changes to agent loop or tool call patterns.

**3.2 Iteration Limits** — PASS
- No new loops in agent path.
- Classification loop (iterating sessions) must have bounded iteration.

**3.3 Permission Model** — PASS
- `kimiflare cost` is read-only. No mutating operations.

**3.4 Error Recovery** — PASS
- LLM classifier must handle malformed JSON responses gracefully (return heuristic result as fallback).

---

### 4. Data Integrity & Persistence ✅

**4.1 Session Persistence** — PASS
- Reads session files but does not modify them.

**4.2 Memory Database** — PASS
- No SQLite schema changes. Classification data lives in `usage.json`.

**4.3 Config Backward Compatibility** — PASS
- `costAttribution?: boolean` is optional with implicit default `false`.
- Unknown fields are already ignored by existing config loader.
- **Action required:** Ensure `loadConfig()` doesn't crash on `costAttribution: true` from future versions.

---

### 5. TUI/UX Stability — N/A

- `kimiflare cost` is a standalone CLI command (like `kimiflare --version`). It does not run the TUI.
- No Ink components, no event management, no streaming.

---

### 6. Security & Privacy ✅

**6.1 Path Safety** — PASS
- Reads from `sessionsDir()` and `usageDir()` — both use known paths under `~/.local/share/kimiflare/`.
- No user-provided paths in file operations.

**6.2 Bash Safety** — PASS
- `git diff --name-status` is used for heuristic signals. This is read-only.
- **Action required:** Ensure `git diff` runs in `session.cwd` only, with timeout.

**6.3 Secret Redaction** — PASS with note
- Classification reads session messages and tool results. These may contain secrets.
- **Action required:** Classification summaries must not include raw file contents or tool outputs. Only category labels and one-line summaries are stored.
- **Action required:** Do not log full session messages in classification error paths.

**6.4 Model ID Validation** — PASS
- No new model IDs introduced. LLM fallback reuses existing model infrastructure.

**6.5 Sanitization** — PASS
- No new JSON/SSE parsing paths.

---

### 7. Integration Consistency ✅

**7.1 MCP Server Lifecycle** — PASS
- No MCP changes.

**7.2 AI Gateway Headers** — PASS
- Reconciliation may use gateway data but doesn't send new headers.

**7.3 Workers AI API** — PASS
- LLM fallback uses existing `runKimi()` or similar client function. Retry logic inherited.

**7.4 SSE Parsing** — PASS
- No new SSE parsing.

---

### 8. Testing & Verification ✅

**8.1 Test Coverage** — PASS with note
- Plan specifies tests for heuristic, report, renderer, reconcile, llm-classifier.
- **Action required:** Add test for config opt-in gating (command fails gracefully when disabled).
- **Action required:** Add test for schema backward compatibility (old `usage.json` without category fields loads fine).

**8.2 Cost Regression Testing** — PASS
- No changes to prompt construction or tool reduction.

**8.3 Integration Testing** — PASS with note
- **Action required:** End-to-end test: create session → run `kimiflare cost --week` → verify category assigned.

---

### 9. Architecture & Design Principles

**9.1 Explicit-Only Memory** — PASS
- Classification is telemetry, not memory. No auto-extraction. No surveillance.

**9.2 Feature Flag Hygiene** — PASS with action
- `costAttribution` is gated, defaults off. ✅
- **Action required:** Must be documented in `KIMI.md` and help menu before merge. (STD-1 warning)
- **Action required:** Add deprecation path comment: "Once stable for 2 releases, consider defaulting to true."

**9.3 Determinism** — PASS
- Heuristic rules are deterministic (tool name + file extension + bash command pattern).
- LLM fallback results are cached permanently.
- `signals` in cost-debug are deterministic.

**9.4 Graceful Degradation** — PASS (Exceeds)
- Feature is entirely optional. When disabled: zero impact.
- When enabled but LLM fails: falls back to heuristic.
- When Cloudflare API fails: shows local-only with explanation.
- When no sessions exist: shows empty report.

---

## Flagged Issues (Must Fix Before Implementation)

### 🔴 HIGH: STD-1 Documentation Gap
**Guardrail:** 9.2 — Feature flags must be documented in `KIMI.md` and help menu.
**Issue:** Plan does not specify updates to `KIMI.md` or `src/ui/help-menu.tsx`.
**Fix:** Add to plan:
- Update `KIMI.md` with `costAttribution` config field
- Update `src/ui/help-menu.tsx` with `kimiflare cost` command description
- Update `src/config.ts` JSDoc for the new field

### 🟡 MEDIUM: 6.3 Secret Redaction in Classification
**Guardrail:** 6.3 — Memory content must be redacted before storage.
**Issue:** LLM classifier prompt includes "First user message: <first 300 chars>" and "Files modified". These could contain secrets.
**Fix:**
- Truncate first user message to 200 chars (already planned)
- Do not include file contents in LLM prompt — only file names and tool counts
- One-line summary must be generated from category + file names, not raw content
- Add `redactSecrets()` pass over any text sent to LLM classifier

### 🟡 MEDIUM: 1.3 Error Handling on File I/O
**Guardrail:** 1.3 — Every `await` on potentially failing operation must have error handling.
**Issue:** Plan reads `sessions/` directory and individual session files. A corrupted session file should not crash the entire report.
**Fix:**
- Wrap `readFile` for session files in `try/catch`
- Skip unreadable sessions with a warning (don't crash)
- Wrap `JSON.parse` on session files

### 🟡 MEDIUM: 2.4 Batch LLM Calls
**Guardrail:** 2.4 — No speculative LLM calls.
**Issue:** 200 unclassified sessions × 30% fallback rate = 60 LLM calls on first run. This is not speculative (user explicitly ran `kimiflare cost`), but could be slow.
**Fix:**
- Add progress indicator in terminal ("Classifying session 12/60...")
- Consider batching or concurrency limit (max 5 parallel LLM calls)
- Document expected first-run time in help text

### 🟢 LOW: 4.3 Config Default
**Guardrail:** 4.3.1 — New config fields must have sensible defaults.
**Issue:** `costAttribution?: boolean` defaults to `undefined` which is falsy. This is fine, but explicit default is clearer.
**Fix:** In `loadConfig()`, explicitly default to `false`:
```ts
costAttribution: cfg.costAttribution ?? false,
```

---

## Verdict

**PASS with 4 required fixes before implementation:**

1. Add KIMI.md + help menu documentation for the feature flag and command
2. Add secret redaction to LLM classifier prompt
3. Add error handling (try/catch) for all session file reads
4. Add progress indicator and concurrency limit for batch LLM classification

No critical or high-priority guardrail violations. The plan is architecturally sound and aligns with existing patterns.
