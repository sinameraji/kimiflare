# Development roadmap

A milestone-scoped plan to act on the findings in
[`agent-loop-findings.md`](./agent-loop-findings.md) and close the
gaps in [`competitor-analysis.md`](./competitor-analysis.md).

This document is the source of truth for "what should we build next."
Each milestone lists PR-sized work items with explicit references to
the relevant finding (`RF-N`), opportunity (`OP-N`), or competitor
gap (numbered 1–10 in the competitor doc).

## Progress log

Most-recent-first. When an item ships, move it here in one line so a
fresh session can pick up where the last one left off without
re-reading the full roadmap.

- **M4.5** — `TurnController` extracted from `app.tsx` — *(this PR)*.
  Hook in `src/ui/use-turn-controller.ts` owns the turn-lifecycle
  state: `busy` / `busyRef`, `supervisorRef`, `isAbortingRef`,
  `lastEscapeAtRef`, the four status-pill fields (`turnPhase`,
  `turnStartedAt`, `currentToolName`, `lastActivityAt`),
  `showReasoning`, `turnCounterRef`, and the task-tracking trio
  (`tasks` + `tasksRef`, `tasksStartedAt`, `tasksStartTokens`).
  Operations: `beginTurn()`, `endTurn()`, `clearTaskTracking()`,
  `toggleReasoning()`, `markAborting()`. Folded three duplicated
  `beginTurn` blocks, three `endTurn` blocks, and three task-reset
  blocks into single-line calls. Other-controller cleanups (permission
  ref, limit/loop refs, pending tool calls) stay at the call sites —
  they belong to M4.1 / M4.3 / M4.4 territory. `app.tsx` 3,954 →
  3,917 LOC; the headline number is small because the hook also adds
  149 LOC of consolidated state declarations, but the structural win
  is real (turn lifecycle now has one owner instead of being smeared
  across 10 useState/useRef calls and three duplicated finally blocks).
- **M4.4** — `SessionManager` extracted from `app.tsx` — merged in #448.
  Pulled load/resume/checkpoint/save state and handlers into
  `src/ui/use-session-manager.ts`. The hook owns the three identity
  refs (`sessionIdRef`, `sessionCreatedAtRef`, `sessionTitleRef`) and
  returns them so the ~20 call sites elsewhere in `app.tsx` keep
  working unchanged. The picker JSX (resume + checkpoint) stays inline
  — 20 LOC of declarative JSX not worth its own component. Pure
  refactor; resume-flow side effects (history, usage, gateway meta,
  memory recall) all preserved. New `resetSession()` helper folds the
  three null-assignments at the start of the `/clear` path into one
  call. Extracted `extractFirstUserText()` as a pure helper for the
  session-id seed text and added 7 unit tests. `app.tsx` 4,093 →
  3,954 LOC.
- **M4.3** — `ModalHost` extracted from `app.tsx` — merged in #443.
  Lifted ten modal families (limit, loop, command wizard / picker /
  delete / list, LSP wizard, theme picker, remote dashboard, inbox)
  into `src/ui/use-modal-host.ts` (state owner) and
  `src/ui/modal-host.tsx` (renderer; fullscreen `<ModalHost>` and
  inline `<ModalOverlay>`). The hook destructures with the original
  state-variable names, so the 49 setter call sites elsewhere in
  `app.tsx` did not need to change. `app.tsx` shrank 4,153 → 4,038 LOC.
  Pure refactor. Two pre-existing keybinding asymmetries spotted in
  the picker close-on-modal check and the Esc-handler modal-open
  check (each excludes a different subset of modals); both preserved
  verbatim and flagged inline for the eventual M9.10 audit. Resolver
  refs (`limitResolveRef`, `loopResolveRef`) still live in `app.tsx`
  because the agent loop's abort path reads them — `<ModalOverlay>`
  gets `onLimitResolved` / `onLoopResolved` callbacks to clear them.
- **M4.2** — `PickerController` extracted from `app.tsx` — merged in
  #432.
  Pulled the file-mention `@`, slash-command `/` state machine into
  `src/ui/use-picker-controller.ts` (~320 LOC) with a pure
  `decidePickerTransition()` core and 32 unit tests (helpers +
  transition table). `app.tsx` shrank 4,355 → 4,153 LOC. Pure refactor —
  observable behavior preserved (open/close triggers, sticky-cancel,
  selected-index clamping, modal-takeover close, lazy file loading on
  first `@`, recents-first sort). No call-site asymmetries spotted; the
  two existing pickers shared the underlying state and lifted cleanly.
- **M1.0** — Ctrl+C no longer freezes the session — *(this PR)*.
  Single-line fix: pass `exitOnCtrlC: false` to Ink's `render()` in
  `src/app.tsx`. The real root cause was Ink's built-in Ctrl+C
  handler intercepting the keystroke before `useInput` could see
  it; `useInput`'s carefully-written abort logic was dead code in
  raw mode. An earlier attempt (#426) added a SIGINT-handler guard
  at the wrong layer — it fixed a genuine but rare race for the
  fallback path and did not address the user-visible symptom; that
  PR was superseded. Manually verified end-to-end against the
  screenshot scenario.
- **M1.10** — Per-session sandbox fallback warning *(OP-10 / RF-19)*
  — merged in #425. Replaces the per-process `fallbackWarningShown`
  flag in `src/code-mode/sandbox.ts` with a per-session `Set<string>`
  keyed by `ctx.sessionId`. SDK embeddings that spawn multiple
  sessions in one process now see the warning on each new session.
- **M1.1** — Full-jitter retry backoff *(OP-1 / RF-8)* — merged in
  #425. `src/agent/client.ts` retries (both the network-error branch
  and the API-error branch) now use
  `Math.random() * (baseDelay * 2 ** attempt)` instead of
  `baseDelay * 2 ** attempt + Math.random() * 250`. Spreads
  retries across a wider window during thundering-herd scenarios.
- **M3.2 + M3.3** — LSP per-request timeout and auto-restart on
  crash — merged in #422 *(adds `LspServerConfig.timeoutMs` and
  `maxRestartAttempts`; subscribes to the connection's `exit` event;
  full-jitter exponential backoff capped at 10s, default 3 attempts;
  ignores clean exits and explicit stops; surfaces `restartAttempts`
  on `LspServerStatus`; 7 unit tests via an `LspManagerHooks` test
  seam)*.
- **M3.1** — MCP per-call timeout for tool invocations — merged in
  #421 *(wraps `client.callTool` with configurable timeout, default
  60s; adds `McpServerConfig.timeoutMs` and threads it through
  `mcpToolToSpec`; local `withTimeout` helper; 5 unit tests)*.
- **M4.1** — `PermissionController` extracted from `app.tsx` —
  merged in #419 *(app.tsx 4,393 → 4,334 LOC, hook + 11 tests added,
  pure refactor, behavior preserved including the
  `promptOnBlockedBash` init-turn asymmetry)*.
- **M0** — architecture docs landed — merged in #418
  *(agent-loop.md, agent-loop-findings.md, competitor-analysis.md,
  this file)*.

## Known blockers / urgent

User-reported, jump the queue when convenient. These should be
finished before their containing milestone is considered done.

*(None currently. RF-20 / Ctrl+C — fixed in M1.0, see progress log.)*

## Guiding principles

1. **Small PRs.** Every item below should land in one PR ≤ 500 LOC of
   net diff. If an item grows beyond that, split it.
2. **No silent regressions.** Add or extend a test next to any
   behavior change. Co-located `*.test.ts` next to source, per CLAUDE.md.
3. **Ship continuously.** Each milestone is shippable as a minor
   release. Conventional Commits (`feat(scope):`, `fix(scope):`) so
   release-please can build the changelog.
4. **Defer big bets.** The `app.tsx` breakup runs in parallel
   throughout the quarter, one extraction per fortnight. Don't try to
   do it in one heroic PR.
5. **Telemetry before optimization.** Anything that requires "we
   should make X faster" waits until M5 (structured telemetry)
   so we measure, not guess.

## Critical path

```
M0 — Branch hygiene
        │
M1 — Quick wins (10 small PRs)         ──┐
        │                                │
M2 — Typed errors & permission shape    │  Foundations for
        │                                │  everything in M3+
M3 — Reliability: timeouts, restarts   ──┘
        │
M4 ── app.tsx breakup (runs in parallel, one extraction per 2 weeks)
        │
M5 — Telemetry
        │
M6 — Competitor parity wave 1: hooks, hierarchical context, JSON output
        │
M7 — Competitor parity wave 2: subagents, auto-compaction
        │
M8 — Competitor parity wave 3: user slash commands, background bash
        │
M9 — Stretch: checkpoint compression, MCP circuit breaker, multi-label cost
```

Estimated timeline: **one calendar quarter** for M0–M5, **a second
quarter** for M6–M9. A team of 1–2 maintainers should target one
milestone per 1–2 weeks for M1–M3, then heavier work scales out.

---

## M0 — Branch hygiene & docs land *(½ day)* ✅ **DONE** *(see #418)*

**Goal:** This roadmap and its sibling docs land on `main`. Nothing
else.

**PRs:**

- ✅ **M0.1** — `docs(architecture): add agent loop reference,
  findings, competitor analysis, and roadmap` *(merged in #418)*.

**Exit criteria:** All four docs merged to `main`. ✅

---

## M1 — Quick wins *(1 week, ~10 PRs)*

**Goal:** Ten small, independent, user-visible improvements. No
shared dependencies between PRs; ideal for parallel review or
batching.

**PRs:**

- ✅ **M1.0** — `fix(app): disable Ink's built-in Ctrl+C handler so
  useInput can interrupt` *(RF-20)* — *shipped in this PR*. Real
  root cause was Ink's default `exitOnCtrlC: true` consuming the
  keystroke before `useInput` could see it; one-line fix passes
  `exitOnCtrlC: false` to `render()`. The earlier SIGINT-handler
  guard attempt (#426) was at the wrong layer and was superseded.
- ✅ **M1.1** — `fix(client): full-jitter retry backoff` *(OP-1 /
  RF-8)* — merged in #425. Both retry sites in
  `src/agent/client.ts` (network-error and API-error branches) now
  use `Math.random() * (baseDelay * 2 ** attempt)`.
- **M1.2** — `feat(session-state): size-aware artifact eviction`
  *(OP-2 / RF-9)*
  - `src/agent/session-state.ts:82–88` — evict largest among oldest
    quartile.
  - Test that capacity is reached fewer times under a mixed-size
    workload.
- **M1.3** — `feat(loop): onTruncation callback + TUI hint`
  *(OP-3 / RF-12)*
  - Add `onTruncation?(tool, rawBytes, reducedBytes, artifactId)` to
    callback surface at `loop.ts:704–708, 736–740`.
  - TUI renders inline "output truncated — `expand artifact <id>`".
- **M1.4** — `feat(client): per-call SSE idle timeout`
  *(OP-4 / RF-7)*
  - Expose `idleTimeoutMs` on `runKimi()` options.
  - Default unchanged. Document in `KIMI.md`.
- **M1.5** — `fix(tools): signal-aware grep / glob inner loops`
  *(OP-5 / RF-13, first half)*
  - `src/tools/grep.ts`: check `signal.aborted` between batches.
  - `src/tools/glob.ts`: wire `signal` into fast-glob.
  - Manual test: Ctrl+C during a large-repo grep returns within
    < 250 ms.
- **M1.6** — `feat(loop): cross-turn web-fetch tracking`
  *(OP-6 / RF-3)*
  - Lift `totalWebFetches` and `domainCounts` from per-turn locals to
    session state.
  - Cap at session-level (default 25); soft nudge.
- **M1.7** — `feat(memory): extraction error counter` *(OP-7 / RF-1)*
  - Replace bare swallow at `loop.ts:806` with `onWarning` debug
    emit + counter.
  - Add `kimiflare memory health` subcommand showing counters.
- **M1.8** — `fix(loop): sliding-window drift detection`
  *(OP-8 / RF-2)*
  - Replace decay-by-1-per-turn with a 10-turn sliding window;
    trigger at 3 high-signal memories.
- **M1.9** — `fix(loop): zero-tool-call budget check` *(OP-9 / RF-5)*
  - `loop.ts:530–574` — drop the `toolCalls.length > 0` guard.
- ✅ **M1.10** — `fix(code-mode): per-session fallback warning`
  *(OP-10 / RF-19)* — *shipped in this PR*. `fallbackWarningShown`
  boolean replaced with a `Set<sessionId>`; new sessions in the
  same process re-see the warning.

**Exit criteria:** All 10 PRs merged; one minor release cut by
release-please.

---

## M2 — Typed errors & permission shape *(1–2 weeks, 2 PRs)*

**Goal:** Foundation work that unblocks reliable retries, UI
suggestion hints, and pattern permissions. Each is one focused PR
that touches many call sites — review carefully.

**PRs:**

- **M2.1** — `refactor(tools): introduce structured ToolError`
  *(OP-12)*
  - New type: `ToolError { code, message, recoverable, suggestion? }`.
  - All tools return `ToolResult { content?, error?, … }`.
  - Loop checks `recoverable` to decide retry vs. fail-fast.
  - Migration of all 15 core tools + MCP / LSP adapters.
  - **High risk:** broad surface change. Land behind a feature flag
    in the loop (`opts.useTypedErrors`) for one release if needed.
- **M2.2** — `refactor(executor): typed askPermission return`
  *(OP-13)*
  - `askPermission` now returns `{ decision, scope: "once" | "session"
    | "pattern" }`.
  - Caller can prepare for pattern allowlists in M6.

**Exit criteria:** Both PRs merged. All existing tools migrated. No
test regressions.

---

## M3 — Reliability: timeouts, restarts, streaming reads *(1–2 weeks, 4 PRs)*

**Goal:** Close the "hangs and silent failures" class of issues.

**PRs:**

- ✅ **M3.1** — `feat(mcp): per-call timeouts` *(OP-15 / RF-16)* —
  *merged in #421*. Default 60 s per tool invocation; configurable
  per server via `McpServerConfig.timeoutMs`. On timeout, surfaces a
  labeled `Error` (`MCP request '<server>/<tool>' timed out after
  Nms`) — the structured `ToolError { code: "TIMEOUT", recoverable:
  true }` upgrade is deferred to M2.1.
- ✅ **M3.2** — `feat(lsp): per-call timeouts` *(OP-15 / RF-16)* —
  *merged in #422*. Default 10 s (existing hardcoded value, now
  configurable per server via `LspServerConfig.timeoutMs`). Threads
  into `LspConnection`.
- ✅ **M3.3** — `feat(lsp): auto-restart with backoff` *(OP-16 /
  RF-15)* — *merged in #422*. Subscribes to the connection's `exit`
  event; full-jitter exponential backoff (`500 ms * 2^attempt`,
  capped at 10 s) up to `maxRestartAttempts` (default 3, set 0 to
  disable). Clean exits (`code === 0`) and explicit `stopServer` do
  not trigger restarts. `restartAttempts` now surfaced on
  `LspServerStatus`. A `/lsp status` slash command remains to be
  built — deferred because it touches `app.tsx` and would conflict
  with M4 extractions.
- **M3.4** — `feat(tools): streaming read for large files`
  *(RF-13, second half)*
  - Stream-read past, say, 1 MB. Check `signal` between chunks.

**Exit criteria:** Hung MCP server scenario from RF-16 verified
fixed by a regression test (mock server that never responds).
M3.4 remains; M3.1–M3.3 shipped.

---

## M4 — `app.tsx` breakup *(runs in background through Q1, ~6 PRs)*

**Goal:** Reduce `src/app.tsx` from 4,393 LOC to < 1,000 LOC by
extracting six concerns, one per fortnight, each as a pure refactor
PR.

This is the **single largest velocity unlock**. Every PR in M6–M8
that touches UI assumes M4 is making steady progress.

**PRs (in suggested order, but most are independent):**

- ✅ **M4.1** — `refactor(ui): extract usePermissionController hook`
  *(merged in #419)*. Pulled the permission-prompt state machine
  into `src/ui/use-permission-controller.ts` (139 LOC) with a pure
  `decidePermission()` core and 11 unit tests. `app.tsx` shrank
  4,393 → 4,334 LOC. Pre-refactor behavior preserved, including the
  init-turn vs main-turn `promptOnBlockedBash` asymmetry. Note for
  next extraction: the wiring pattern (hook returns `{ pending,
  askPermission, hasPending, decide, denyPending, clearResolveRef }`)
  works well — reuse it for the other controllers.
- ✅ **M4.2** — `refactor(ui): extract usePickerController hook`
  *(merged in this PR)*. Pulled the file-mention `@` and slash-command
  `/` state machine into `src/ui/use-picker-controller.ts` with a pure
  `decidePickerTransition()` core and 32 unit tests. `app.tsx` shrank
  4,355 → 4,153 LOC. Pure refactor; the two pickers share state and
  lifted cleanly with no call-site asymmetries to preserve.
- ✅ **M4.3** — `refactor(ui): extract ModalHost`
  *(merged in this PR)*. State owner in
  `src/ui/use-modal-host.ts`, renderer in `src/ui/modal-host.tsx`
  (`<ModalHost>` for the 8 fullscreen modals, `<ModalOverlay>` for
  the 2 resolver overlays). Hook destructures with the original
  state-variable names so existing setter call sites don't churn.
  `app.tsx` shrank 4,153 → 4,038 LOC. Pure refactor; two pre-existing
  modal-set asymmetries (picker close-on-modal vs. Esc modal-open
  check) preserved verbatim and flagged inline for the M9.10 audit.
- ✅ **M4.4** — `refactor(ui): extract SessionManager`
  *(merged in this PR)*. Hook in `src/ui/use-session-manager.ts` owns
  the three identity refs plus picker state and the
  save/resume/checkpoint handlers. `extractFirstUserText()` extracted
  as a pure helper for the session-id seed text. `app.tsx` shrank
  4,093 → 3,954 LOC.
- ✅ **M4.5** — `refactor(ui): extract TurnController`
  *(merged in this PR)*. Hook in `src/ui/use-turn-controller.ts` owns
  busy / supervisor / phase / status / reasoning / task-tracking state
  plus `beginTurn` / `endTurn` / `clearTaskTracking` helpers. Three
  duplicated lifecycle blocks folded to one-line calls. `app.tsx`
  shrank 3,954 → 3,917 LOC.
- **M4.6** — `refactor(ui): extract InputController`
  - The 200+ line `useInput` handler split by mode (normal /
    picker / modal).

**Definition of done per PR:** No behavior change, no new tests
fail, `app.tsx` shrinks by ≥ 300 LOC.

**Exit criteria:** `wc -l src/app.tsx` returns < 1000.

---

## M5 — Structured telemetry *(1 week, 2 PRs)*

**Goal:** After this lands, the rest of the roadmap becomes data-
driven.

**PRs:**

- **M5.1** — `feat(telemetry): structured JSON logs`
  *(OP-20)*
  - Emit `{ timestamp, level, module, event, fields }` to
    `~/.config/kimiflare/logs/<date>.jsonl`.
  - All existing `console.log` / `console.warn` migrated.
  - Log rotation policy (7 days, as the existing constant suggests
    was intended).
- **M5.2** — `feat(telemetry): optional OTel export`
  *(OP-20)*
  - `KIMIFLARE_OTEL_ENDPOINT` env var → emit OTLP. No-op if unset.

**Exit criteria:** `cat ~/.config/kimiflare/logs/*.jsonl | jq` can
answer "what's the per-tool p95 latency this week" without writing
new code.

---

## M6 — Competitor parity wave 1 *(2 weeks, 4 PRs)*

**Goal:** Close the cheapest competitor gaps. Each PR is a feature,
not a refactor.

**PRs:**

- **M6.1** — `feat(hooks): user-configured lifecycle hooks`
  *(Competitor #2)*
  - Read `~/.config/kimiflare/settings.json` and
    `.kimiflare/settings.json`.
  - Events: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`,
    `Stop`, `PreCompact`.
  - Shell out with JSON on stdin; collect exit code + stdout.
  - **Depends on M2.1** (typed errors so hook failures classify
    properly).
- **M6.2** — `feat(permissions): pattern-based allowlists`
  *(Competitor #3)*
  - Patterns in `settings.json`: `"Bash(npm test:*)"`,
    `"Read(./src/**)"`, etc.
  - Match argv against globs in `executor.ts` permission gating.
  - Deny wins over allow.
  - **Depends on M2.2** (permission decision shape).
- **M6.3** — `feat(context): hierarchical CLAUDE.md / KIMI.md`
  *(Competitor #4)*
  - Walk cwd → parents → `~/.config/kimiflare/CLAUDE.md`.
  - Concatenate with provenance comments.
- **M6.4** — `feat(cli): --output-format json for print mode`
  *(Competitor #8)*
  - `{ result, usage, tool_calls, exit_code }` envelope.
  - Also `--output-format stream-json` for per-event JSON lines.

**Exit criteria:** Closing one issue from each of the four gap
categories. Document in `KIMI.md`.

---

## M7 — Competitor parity wave 2: subagents & auto-compaction *(3–4 weeks, 4 PRs)*

**Goal:** The two largest competitor gaps. Both touch the loop
deeply. **Depends on M4 being substantially complete** — both need
clean UI surfaces.

**PRs:**

- **M7.1** — `feat(supervisor): subagent primitive`
  *(Competitor #1)*
  - `Agent` tool with `subagent_type` parameter (`general`,
    `explore`, `plan` to start).
  - Each subagent gets its own context, tool allowlist, and
    callback surface.
  - Parent sees only the final report.
- **M7.2** — `feat(supervisor): parallel subagent execution`
  - Multiple `Agent` tool calls in one batch run concurrently.
- **M7.3** — `feat(supervisor): worktree isolation`
  - `isolation: "worktree"` option creates a temp git worktree per
    subagent. Auto-cleanup if no changes.
- **M7.4** — `feat(loop): auto-compaction at MAX_PROMPT_TOKENS`
  *(Competitor #6 / RF-6)*
  - At cap, summarize older turns into a compact narrative.
  - Preserve last N tool results verbatim.
  - Fall back to `BudgetExhaustedError` only if compaction fails.

**Exit criteria:** Multi-agent task ("explore X, plan Y, review Z")
completes in one session with parent context staying small.
1000-turn synthetic session does not throw `BudgetExhaustedError`.

---

## M8 — Competitor parity wave 3 *(2 weeks, 3 PRs)*

**PRs:**

- **M8.1** — `feat(commands): user-extensible slash commands`
  *(Competitor #5)*
  - `.kimiflare/commands/<name>.md` with frontmatter (`allowed_tools`,
    `model_override`) and `$ARGUMENTS` interpolation.
- **M8.2** — `feat(tools): background bash with Monitor`
  *(Competitor #9)*
  - `run_in_background: true` returns a task ID.
  - `Monitor` tool tails stdout. Notification when task completes.
- **M8.3** — `feat(ui): status line, output styles`
  *(Competitor #10)*
  - Configurable status line (branch, model, tokens-remaining).
  - "Explanatory" vs "concise" output style.

**Exit criteria:** All P0–P3 competitor gaps closed. KimiFlare's
public capability matrix matches or exceeds Claude Code's on terminal
coding-agent fundamentals.

---

## M9 — Stretch *(open-ended)*

Items here are valuable but not on the critical path. Pick up as
capacity allows.

- **M9.1** — `feat(session): delta-encoded checkpoints with zstd`
  *(OP-21)*
- **M9.2** — `feat(mcp): circuit breaker per server` *(OP-22)*
- **M9.3** — `feat(loop): per-tool quotas` *(OP-23)*
- **M9.4** — `feat(loop): cross-turn loop detection` *(OP-24)*
- **M9.5** — `feat(cost-attribution): multi-label classification`
  *(OP-25)*
- **M9.6** — `feat(code-mode): freeze API per turn` *(OP-17)*
- **M9.7** — `feat(code-mode): catch async rejections in sandbox`
  *(OP-18)*
- **M9.8** — `feat(tools): pluggable reducer registry` *(OP-11)*
- **M9.9** — `feat(session-state): artifact reducer-version stamp`
  *(OP-14 / RF-17)*
- **M9.10** — `audit: plan mode enforcement across subsystems`
  *(Competitor #7)*
- **M9.11** — `security: bash co-author injection escape audit`
  *(RF-18)*
- **M9.12** — `refactor(loop): atomic system message rebuild`
  *(RF-10)*
- **M9.13** — `fix(code-mode): cache key includes parameter schemas`
  *(RF-11)*

---

## Risk register

Per-milestone risks worth tracking:

| Milestone | Risk                                                                       | Mitigation                                                                 |
| --------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| M1        | One of the small PRs subtly changes behavior in a way tests don't catch.   | Co-locate a test with each PR. Cut a 0.x.y release after every 3–4 PRs.    |
| M2        | `ToolError` migration breaks an MCP adapter no maintainer tests.           | Feature-flag for one release; defer flag removal until field reports clean. |
| M3        | LSP auto-restart loops forever on a server that crashes on init.           | Cap restart attempts; surface failure clearly in `/lsp status`.            |
| M4        | UI extractions accidentally change keybinding semantics.                   | Manual smoke tests per extraction. Keep a checklist of every keybinding.   |
| M5        | Telemetry blows up disk usage.                                             | Rotation policy from day one. Default cap 100 MB; warn at 80 MB.           |
| M6        | Pattern permissions create a false sense of security with malformed globs. | Strict glob parser; reject ambiguous patterns at load time with a clear error. |
| M7        | Subagent context isolation has a leak (parent sees child's tool output).   | Tests that explicitly assert parent context size doesn't grow with child tool calls. |
| M8        | Background bash leaks processes on session exit.                           | Process group tracking; SIGTERM all on session end with 5s SIGKILL fallback. |

---

## Tracking & accountability

- This document is the canonical roadmap. PR descriptions should
  reference the milestone tag (e.g., `Closes M1.3`).
- Milestones are tracked as GitHub milestones with the same names.
- Each PR's body includes a checkbox for "exit criteria for this
  milestone item satisfied" — the merging maintainer ticks it.
- At the end of each milestone, the maintainer updates this file
  with a short retrospective (1 paragraph): what shipped, what
  slipped, lessons learned.
- Release-please automatically tags releases per Conventional
  Commit history; no manual version bumps.

---

## What this roadmap does *not* cover

- **Kimi model upgrades** — out of scope; tracked separately.
- **The remote / Cloud product line** (`remote/worker/`,
  `remote/agent/`) — those have their own deploy story and
  shouldn't block the main CLI roadmap.
- **GPU-side improvements** (embedding model choice, code mode
  performance) — measure after M5 lands; act when there's data.
- **Marketing & onboarding** — separate workstream.

Anything not on this list and not in M9 should get a discussion and
a finding entry before it consumes engineering time.
