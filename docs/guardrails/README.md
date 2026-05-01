# AI Development Guardrails for Kimiflare

> **Purpose:** This directory contains the governance framework that AI coding agents must follow when modifying the kimiflare codebase. These guardrails are designed to be read and evaluated by both human reviewers and automated PR review agents.
>
> **Scope:** Every pull request that touches `src/`, `bin/`, `feedback-worker/`, or `docs/` must be evaluated against these guardrails.
>
> **Last updated:** 2026-04-27

---

## Table of Contents

1. [Build & Runtime Safety](#1-build--runtime-safety)
2. [Token Efficiency & Cost Control](#2-token-efficiency--cost-control)
3. [Agent Loop Safety](#3-agent-loop-safety)
4. [Data Integrity & Persistence](#4-data-integrity--persistence)
5. [TUI/UX Stability](#5-tuiux-stability)
6. [Security & Privacy](#6-security--privacy)
7. [Integration Consistency](#7-integration-consistency)
8. [Testing & Verification](#8-testing--verification)
9. [Architecture & Design Principles](#9-architecture--design-principles)
10. [How to Use This Document](#10-how-to-use-this-document)

---

## 1. Build & Runtime Safety

### 1.1 TypeScript Strictness
- **Rule:** All code must compile under `tsc --noEmit` with zero errors.
- **Rule:** `noUncheckedIndexedAccess` is enabled — every array/object index access must be guarded or use non-null assertion (`!`) with justification.
- **Rule:** `noImplicitOverride` is enabled — overridden methods must use the `override` keyword.
- **Rule:** `isolatedModules` is enabled — no cross-file type dependencies that require full type-checking to resolve.
- **Acceptance Criteria:** `npm run typecheck` passes cleanly on every PR.

### 1.2 ESM & Import Conventions
- **Rule:** All imports must use `.js` extensions, even for `.ts`/`.tsx` files (TypeScript `moduleResolution: Bundler`).
- **Rule:** All Node.js built-ins must use the `node:` prefix (e.g., `node:fs/promises`, not `fs/promises`).
- **Rule:** No CommonJS `require()` or `module.exports` — ESM only.
- **Acceptance Criteria:** `npm run build` produces a valid `dist/` and `bin/kimiflare.mjs`.

### 1.5 CLI Entry Point Preservation
- **Rule:** Bare `kimiflare` (no args, no subcommand) must enter the interactive TUI — never print commander help and exit.
- **Rule:** Any PR that adds a `program.command(...)` subcommand must also ensure the root command has an explicit `.action(() => {})` (or equivalent) before `program.parse()`. Commander auto-prints help when subcommands exist and no root action is defined, which silently kills the TUI.
- **Acceptance Criteria:** Running `node bin/kimiflare.mjs` in a TTY must reach `main()`. In a non-TTY context the process must exit with the "interactive mode requires a TTY" message (proves the entry point was reached, not commander help). Regression precedent: v0.20.0 shipped this bug; see Appendix A.

### 1.3 Runtime Error Prevention
- **Rule:** Every `JSON.parse()` must be wrapped in `try/catch` or validated with a schema guard.
- **Rule:** Every `await` on a potentially failing operation (file I/O, network, DB) must have error handling.
- **Rule:** No unhandled promise rejections — `void` prefix is acceptable only for truly fire-and-forget operations (telemetry, background cleanup).
- **Rule:** AbortSignal must be propagated through all async call chains that support it.
- **Acceptance Criteria:** No new `throw` statements without corresponding error handling in the call stack.

### 1.4 File Size & Memory Limits
- **Rule:** `read` tool refuses files > 2MB.
- **Rule:** `write`/`edit` tools should warn on files > 100KB.
- **Rule:** Image encoding refuses files > 5MB.
- **Rule:** Web fetch refuses responses > 1MB.
- **Acceptance Criteria:** New file I/O operations must have explicit size guards.

---

## 2. Token Efficiency & Cost Control

### 2.1 Prompt Cache Stability
- **Rule:** The static system prompt prefix must be byte-for-byte identical across all turns in a session.
- **Rule:** The session prefix must only change when mode, tools, or KIMI.md content changes — not on every turn.
- **Rule:** Code Mode TypeScript API generation must be deterministic (sorted keys, stable JSDoc rendering) and cached by tool list hash.
- **Rule:** No volatile data (timestamps, random IDs, unordered iteration) may appear in cache-stable prefixes.
- **Acceptance Criteria:** `cacheDiagnostics.cacheHitRatio` should not regress. New features must include cache impact analysis.

### 2.2 Context Window Management
- **Rule:** Auto-compaction must fire when messages cross 80K tokens or 12 turns, regardless of feature flags.
- **Rule:** Compiled context (heuristic compaction) and LLM summarizer (`/compact`) must both be available as fallback paths.
- **Rule:** Image content must be dropped from message history after N turns (default 2, configurable).
- **Rule:** Reasoning content must be stripped from historical assistant messages (keep only last 1 by default).
- **Acceptance Criteria:** A 50-turn session must not exceed 200K tokens in the prompt.

### 2.3 Tool Output Reduction
- **Rule:** All tool outputs must pass through the reducer before reaching the model, except explicitly whitelisted commands (diff-style git commands).
- **Rule:** Reducer config defaults must not be relaxed without explicit cost justification:
  - `bash`: max 40 lines, 4000 chars, dedupe consecutive lines
  - `grep`: max 50 lines, 3 matches per file, 200 chars per line
  - `read`: max 60 outline lines, 200 slice lines, 30 preview lines
  - `web_fetch`: max 2000 chars, 500 heading chars
- **Rule:** Diff-style git commands (`git show`, `git diff`, `git log -p`, `git format-patch`, `git stash show -p`) must bypass the bash reducer to preserve line-level meaning.
- **Acceptance Criteria:** Tool output byte counts must be logged in cost-debug JSONL. No regression in `toolSavingsPct`.

### 2.4 LLM Call Minimization
- **Rule:** Internal/plumbing tasks must use the small model (`@cf/meta/llama-4-scout-17b-16e-instruct` by default), not Kimi K2.6.
- **Rule:** Deterministic operations (topic key normalization, simple transforms) must not use any LLM call.
- **Rule:** Memory write pipeline must batch operations where possible.
- **Rule:** No speculative LLM calls — only call the model when the result is needed for the next turn.
- **Acceptance Criteria:** New features must document expected LLM call count per user turn.

### 2.5 Cost Visibility
- **Rule:** Every turn's token usage must be tracked in `usage-tracker.ts`.
- **Rule:** Status bar must show session cost and token count.
- **Rule:** `/cost` command must return accurate USD breakdown.
- **Acceptance Criteria:** Cost tracking must not drift > 5% from Cloudflare billing dashboard.

---

## 3. Agent Loop Safety

### 3.1 Anti-Loop Guardrails
- **Rule:** The agent loop must detect repeated identical tool calls (same name + stable-stringified args) within a sliding window of 8 calls.
- **Rule:** On the 3rd identical call, inject a synthetic error: `"Loop detected: you have called {tool} with the same arguments multiple times in a row. Consider a different approach."`
- **Rule:** The loop detector must not block legitimate retries with different args.
- **Rule:** Pattern-based detection for `web_fetch`: 5+ fetches within any 8-call window, or 3+ fetches from the same domain, triggers a warning (not a hard stop).
- **Acceptance Criteria:** Merge-conflict resolution scenarios must not exceed 10 tool iterations.

### 3.2 Iteration Limits
- **Rule:** Hard cap of 50 tool iterations per turn.
- **Rule:** Budget self-assessment: after every 3 tool calls, inject a system message prompting the agent to assess whether the next call is worth more than what it already has.
- **Rule:** Soft budget warning at 5 calls (routine questions), hard budget warning at 15 calls (substantial questions). These are warnings, not hard stops — the agent can override by justifying the next call.
- **Rule:** On hitting the 50-call limit, inject a graceful pause system message ("Paused after 50 tool calls. Say 'go on' to continue.") so the agent retains context.
- **Rule:** Bash timeout default 120s, max 600s.
- **Rule:** Code Mode sandbox timeout 30s, memory limit 128MB.
- **Acceptance Criteria:** No user-visible hang beyond configured timeouts.

### 3.3 Permission Model
- **Rule:** Mutating tools (`write`, `edit`, `bash`) must require user permission in `edit` mode.
- **Rule:** `plan` mode must block all mutating tools except read-only bash commands.
- **Rule:** Read-only bash whitelist must be explicit and validated per segment (pipes and `&&` chains allowed if all segments are read-only).
- **Rule:** `auto` mode must auto-approve but still log all tool calls.
- **Acceptance Criteria:** Permission modal must render correctly with diff preview for `write`/`edit`.

### 3.4 Error Recovery
- **Rule:** The model must not retry the exact same failed tool call blindly.
- **Rule:** JSON parse errors in tool arguments must return a clear error message, not crash.
- **Rule:** API 400 errors with "invalid escaped character" must pop the offending message and suggest `/clear`.
- **Acceptance Criteria:** Error messages must be actionable for the model.

### 3.5 Deliverable-Driven Agents (Multi-Agent)
- **Rule:** The Research Agent must produce a structured Research Brief (DECISION, FINDINGS, RECOMMENDATION, CONFIDENCE, OPEN QUESTIONS, RISKS) before considering its work complete.
- **Rule:** The Research Agent stops when the named decision can be made from its findings, not when it has exhausted all sources.
- **Rule:** The `hand_off` tool allows an agent to signal completion and request a hand-off to another agent. The orchestrator must detect `hand_off` calls and trigger automatic hand-off.
- **Rule:** Hand-off summaries must preserve the agent's deliverable (Brief, Implementation Notes, etc.) rather than replacing it with a lossy synthesis.
- **Rule:** Agents must not address the human user with imperatives ("you need to", "you should", "start by"). Their audience is the next agent in the pipeline.
- **Acceptance Criteria:** Research Agent must produce a Brief within 15 tool calls for routine questions; must call `hand_off` when complete.

---

## 4. Data Integrity & Persistence

### 4.1 Session Persistence
- **Rule:** Session files must include `messages`, `sessionState`, and `artifactStore`.
- **Rule:** Artifact store serialization must truncate to 50KB per artifact (matching in-memory cap).
- **Rule:** Session resume must restore artifact store via `deserializeArtifactStore()`.
- **Rule:** Session pruning must respect retention policy: 30 days max age, 100 files max count.
- **Acceptance Criteria:** `/resume` must restore recall functionality for archived artifacts.

### 4.2 Memory Database
- **Rule:** SQLite schema must include migration path for new columns (see `migrateV1()` pattern).
- **Rule:** WAL mode must be enabled (`journal_mode = WAL`).
- **Rule:** Cleanup must run on startup: drop memories > 90 days, deduplicate by cosine similarity ≥ 0.95, enforce max 1000 entries per repo.
- **Rule:** Tasks category must be excluded from vector search (searchable only via FTS).
- **Acceptance Criteria:** DB operations must not block the main thread for > 100ms.

### 4.3 Config Backward Compatibility
- **Rule:** New config fields must have sensible defaults.
- **Rule:** Config file must be chmod 600.
- **Rule:** Unknown config fields must be ignored, not cause crashes.
- **Acceptance Criteria:** Upgrading from v0.20 to v0.26 must not require config regeneration.

---

## 5. TUI/UX Stability

### 5.1 Event Management
- **Rule:** Chat events must be capped at 500 (`MAX_EVENTS`).
- **Rule:** Visual compaction must collapse old turns into a placeholder, keeping last 4 turns visible.
- **Rule:** Streaming assistant updates must be batched at ~60fps (16ms flush interval) to reduce React re-render churn.
- **Acceptance Criteria:** 100-turn session must not cause TUI lag or memory growth.

### 5.2 Static Rendering
- **Rule:** `Static` component from Ink must be used for finalized events.
- **Rule:** Static items must have stable keys to prevent React reconciliation issues.
- **Acceptance Criteria:** No missing user messages or duplicate rendering.

### 5.3 Theme & Accessibility
- **Rule:** All themes must use truecolor hex codes, not ANSI 256-color codes.
- **Rule:** Contrast must be legible on Terminal.app (avoid `dimColor` on low-contrast combinations).
- **Rule:** Theme picker must support live preview without closing on arrow keys.
- **Acceptance Criteria:** All 6 built-in themes must pass WCAG AA contrast on black/white backgrounds.

### 5.4 Input Handling
- **Rule:** Paste detection threshold: ≥200 chars or ≥1 newline.
- **Rule:** History navigation (up/down) must preserve draft input.
- **Rule:** Queue items must be deletable individually.
- **Acceptance Criteria:** No input loss on rapid key presses.

---

## 6. Security & Privacy

### 6.1 Path Safety
- **Rule:** All user-provided paths must be resolved via `resolvePath()` which blocks `..` traversal.
- **Rule:** `isPathOutside()` must be used before any file operation outside cwd.
- **Rule:** Custom command loader must reject files outside the commands directory.
- **Acceptance Criteria:** No file read/write outside the project directory without explicit user permission.

### 6.2 Bash Safety
- **Rule:** Bash commands run via `bash -lc` with cwd set explicitly.
- **Rule:** Co-author injection (`Co-authored-by: kimiflare <kimiflare@proton.me>`) must only apply to git commit-creating commands, not commands that only move HEAD (`git checkout`, `git reset`, etc.).
- **Rule:** Timeout must be enforced via `AbortController` + `spawn` kill.
- **Acceptance Criteria:** `rm -rf /` must be blocked by plan mode and require permission in edit mode.

### 6.3 Secret Redaction
- **Rule:** Memory content must be redacted via `redactSecrets()` before storage.
- **Rule:** API tokens must never appear in logs, session files, or memory DB.
- **Acceptance Criteria:** `grep -r "apiToken" ~/.local/share/kimiflare/` must return only the config file.

### 6.4 Model ID Validation
- **Rule:** Model IDs must match `/^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/`.
- **Rule:** Invalid model IDs must throw `KimiApiError` with 400 status, not make network requests.
- **Acceptance Criteria:** Path traversal via model string (`../../../etc/passwd`) must be rejected.

### 6.5 Sanitization
- **Rule:** All strings entering JSON or SSE must be sanitized for lone UTF-16 surrogates (`sanitizeString()`).
- **Rule:** Tool arguments must be validated via `validateToolArguments()` before being stored in message history.
- **Acceptance Criteria:** No `JSON.parse` errors from model-generated content.

---

## 7. Integration Consistency

### 7.1 MCP Server Lifecycle
- **Rule:** MCP tools must be unregistered before re-registering on reload.
- **Rule:** MCP connection failures must be non-fatal — log error, continue without that server.
- **Rule:** MCP tool names must be prefixed with `mcp_{serverName}_{toolName}`.
- **Acceptance Criteria:** `/mcp reload` must not leak old tool registrations.

### 7.2 AI Gateway Headers
- **Rule:** Gateway headers (`cf-aig-cache-ttl`, `cf-aig-skip-cache`, etc.) must only be sent when gateway is configured.
- **Rule:** Gateway metadata must be limited to 5 entries and stable-stringified.
- **Acceptance Criteria:** Direct Workers AI mode must not send gateway headers.

### 7.3 Workers AI API
- **Rule:** Retry logic must only retry on 5xx and known retryable codes (3040 capacity error).
- **Rule:** Max 5 retry attempts with exponential backoff (500ms * 2^attempt + jitter).
- **Rule:** `x-session-affinity` and `X-Session-ID` headers must be sent for cache stability.
- **Acceptance Criteria:** 99% of requests succeed within 3 attempts.

### 7.4 SSE Parsing
- **Rule:** SSE parser must handle line splits across chunk boundaries, multi-line data, CRLF/LF, and ignored events.
- **Rule:** Malformed SSE chunks must be skipped, not crash the stream.
- **Acceptance Criteria:** Streaming must survive 1MB+ responses without dropping events.

---

## 8. Testing & Verification

### 8.1 Test Coverage Requirements
- **Rule:** Every new tool must have a unit test in `src/tools/{tool}.test.ts`.
- **Rule:** Every new agent loop feature must have a test in `src/agent/{feature}.test.ts`.
- **Rule:** Reducer changes must include before/after byte count assertions.
- **Acceptance Criteria:** `npm test` must pass with 0 failures.

### 8.2 Cost Regression Testing
- **Rule:** Changes to prompt construction must include `cacheDiagnostics` verification.
- **Rule:** Changes to tool output reduction must include `toolStats` verification.
- **Rule:** New LLM call sites must document expected token count.
- **Acceptance Criteria:** Cost-debug JSONL must show no regression in `promptTotalApproxTokens` for standard benchmark prompts.

### 8.3 Integration Testing
- **Rule:** Session save/resume must be tested end-to-end.
- **Rule:** Memory cleanup/backfill must be tested with mock DB.
- **Rule:** MCP tool registration must be tested with mock transport.
- **Acceptance Criteria:** No manual TUI smoke test should reveal regressions.

---

## 9. Architecture & Design Principles

### 9.1 Explicit-Only Memory
- **Rule:** Agent memory writes must only occur via explicit `memory_remember` tool calls — no auto-extraction from conversation.
- **Rule:** Memory reads at session start and compaction time are allowed (surfacing existing explicit memories).
- **Acceptance Criteria:** No surveillance-like behavior — user must consciously choose to remember.

### 9.2 Feature Flag Hygiene
- **Rule:** New features must be gated behind explicit flags (env vars or config), defaulting to off until proven stable.
- **Rule:** Feature flags must be documented in `KIMI.md` and help menu.
- **Rule:** Flags must be removable once the feature is stable (deprecation path).
- **Acceptance Criteria:** `compiledContext`, `codeMode`, `memoryEnabled` all follow this pattern.

### 9.3 Determinism
- **Rule:** Any generated content that affects prompt caching must be deterministic (sorted keys, stable iteration order).
- **Rule:** `stableStringify()` must be used for all JSON that enters the prompt or cache key.
- **Acceptance Criteria:** Two identical sessions must produce identical cache hit ratios.

### 9.4 Graceful Degradation
- **Rule:** Every optional subsystem (memory, MCP, gateway, code mode) must degrade gracefully when unavailable.
- **Rule:** Core functionality (read, edit, write, bash, agent loop) must work with zero optional dependencies.
- **Acceptance Criteria:** `kimiflare` must start and answer simple prompts even if SQLite, isolated-vm, or MCP are missing.

---

## 10. How to Use This Document

### For Human Reviewers
1. Check the PR diff against each relevant section above.
2. Flag any violation with the section number (e.g., "Violates 2.1.3 — introduces non-deterministic key ordering").
3. Require test updates for any modified guardrail.

### For Automated PR Review Agents
1. Parse the PR diff and identify touched files.
2. Load the relevant guardrail sections (e.g., `src/agent/loop.ts` changes → check sections 1, 2, 3, 7).
3. Evaluate each rule against the diff:
   - **PASS:** Rule is satisfied or not applicable.
   - **WARN:** Rule may be violated — requires human review.
   - **FAIL:** Rule is clearly violated — block PR.
4. Output a structured report with section references and acceptance criteria checks.

### Example Automated Report Format

```markdown
## Guardrail Evaluation for PR #XXX

### 1. Build & Runtime Safety
- [PASS] 1.1 TypeScript strictness — no new `any` types introduced.
- [WARN] 1.3 Runtime error prevention — new `JSON.parse()` at line 45 without `try/catch`.

### 2. Token Efficiency
- [FAIL] 2.1.2 Session prefix includes timestamp — breaks cache stability.
  - **File:** `src/agent/system-prompt.ts:78`
  - **Fix:** Move timestamp to dynamic suffix.

### 3. Agent Loop Safety
- [PASS] 3.1 Anti-loop — loop signature uses `stableStringify()`.
```

---

## Appendix A: Known Sharp Edges (Historical Bugs)

These are past failures that informed the guardrails above. New code must not reintroduce these patterns.

| Bug | Root Cause | Guardrail Section |
|-----|-----------|-------------------|
| Context window blowup (424K → 262K) | Auto-compaction gated behind `compiledContext` flag (default off) | 2.2.1 |
| Merge conflict loop (12 `git show` variants) | Bash reducer deduped diff lines, model couldn't see conflict | 2.3.4, 3.1 |
| TUI missing user messages | `Static` component key instability caused React reconciliation drops | 5.2 |
| Status bar cost drift | Intern's token count work didn't account for cached tokens | 2.5 |
| Plan mode allowed `git commit` | Bash whitelist didn't distinguish commit-creating vs HEAD-moving | 3.3, 6.2 |
| Memory write cost explosion | Verification + topic + hypotheticals all used Kimi K2.6 | 2.4.1 |
| Code Mode cache misses | TypeScript API regenerated non-deterministically every turn | 2.1.3 |
| Artifact store lost on resume | `ArtifactStore` not persisted in session file | 4.1.1 |
| Co-author on `git checkout` | Co-author injection applied to all git commands | 6.2 |
| Theme picker closed on arrows | `useInput` handler didn't filter arrow keys | 5.3 |
| Ctrl+C hung the app | Global SIGINT handler conflicted with Ink's handler | 3.4 |
| Memory growth in long sessions | Images and reasoning content never stripped from history | 2.2.2, 2.2.3 |
| Invalid JSON 400 loops | Model generated malformed JSON, no validation before retry | 3.4 |
| Bare `kimiflare` printed help instead of TUI (v0.20.0, recurred on `feat/cost-attribution`) | Adding a `program.command(...)` subcommand without an explicit root `.action(() => {})` makes commander auto-print help and skip `main()` | 1.5 |

---

## Appendix B: Quick Reference — File → Guardrail Sections

| File Pattern | Primary Sections |
|-------------|------------------|
| `src/agent/loop.ts` | 1, 2, 3, 7 |
| `src/agent/client.ts` | 1, 6, 7 |
| `src/agent/system-prompt.ts` | 2, 9 |
| `src/agent/compaction.ts` | 2, 4 |
| `src/agent/compact.ts` | 2, 4 |
| `src/agent/session-state.ts` | 4 |
| `src/tools/*.ts` | 1, 2, 3, 6 |
| `src/tools/reducer.ts` | 2 |
| `src/memory/*.ts` | 2, 4, 6, 9 |
| `src/ui/*.tsx` | 1, 5 |
| `src/app.tsx` | 1, 3, 4, 5 |
| `src/config.ts` | 4, 6 |
| `src/mode.ts` | 3, 6 |
| `src/pricing.ts` | 2 |
| `src/usage-tracker.ts` | 2 |
| `feedback-worker/*` | 6, 7 |

---

*This document is a living specification. Propose changes via PR with justification referencing empirical cost or quality data.*
