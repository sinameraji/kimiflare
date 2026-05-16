# Agent loop — red flags and opportunities

Companion to [`agent-loop.md`](./agent-loop.md). Everything here is grounded
in the code as it exists on the branch that introduced this document; line
numbers will drift, but the underlying patterns are stable enough that a
quick `rg` should re-locate any item.

Each entry: short title, code reference, why it matters, suggested effort
(**S** = ≤ 1 day, **M** = a few days, **L** = a week or more of focused
work).

> Context for prioritization: ~14k weekly NPM downloads and 145+ GitHub
> stars at time of writing. We are past the "personal toy" phase — the
> long tail of users notices roughness that wouldn't matter at 100 DL/wk.

---

## Red flags

### RF-1 — Fire-and-forget memory extraction swallows errors (S → M)

`src/agent/loop.ts:752–810`, error swallowed at `:806`.

Memory extraction after each tool result is intentionally async and
non-blocking, but the error path is a bare swallow with no logging, no
counter, and no retry. If extraction is failing systemically (bad embedding
endpoint, DB lock, schema mismatch), we never know. Visibility comes only
from "memory recall is empty."

**Fix:** route extraction errors through `onWarning` (already in the
callback surface) at debug level; add a per-session error counter exposed
in `/cost` or a `/memory health` subcommand.

### RF-2 — Drift accumulator decays as fast as it fires (S)

`DRIFT_THRESHOLD = 5` at `src/agent/loop.ts:138`, decay −1 per turn at turn
end (~`loop.ts:825`).

The `onKimiMdStale()` signal is meant to nudge users to refresh `KIMI.md`
once a session has drifted. With a 5-event threshold and a 1-per-turn
decay, it almost never fires on long sessions — the accumulator hovers
near zero. The result is a feature that exists in code but rarely surfaces
in the UI.

**Fix:** either drop the decay to 0.5/turn (rounded fractional accumulator)
or change the trigger to a sliding window (e.g., 3 high-signal memories
in 10 turns).

### RF-3 — Web-fetch spiral guardrail is per-turn only (S)

`src/agent/loop.ts:609–666`.

The `MAX_WEB_FETCH_PER_TURN = 5` and `WEB_FETCH_DOMAIN_THRESHOLD = 2`
counters reset every turn. An agent that splits a research spiral across
three turns can re-fetch the same domain ~15 times. Cheap to abuse.

**Fix:** lift `totalWebFetches` and `domainCounts` to session state. Add a
soft session cap (e.g., 25 fetches before a "synthesize what you have"
nudge).

### RF-4 — Anti-loop signature is sensitive to nonces (M)

`src/agent/loop.ts:584–607`, signature = `name + stableStringify(args)`.

If a tool's args contain a timestamp, request ID, or any non-deterministic
field, two semantically identical calls produce different signatures and
the guardrail never fires. Affects bash with `--date=now`, MCP tools that
pass correlation IDs, any tool that mints a UUID internally before
hashing.

**Fix:** allow each `ToolSpec` to declare a `signatureKey(args)` projector
that strips known nonce fields. Default falls back to current behavior.

### RF-5 — Budget exhaustion only triggers when tools were called (S)

`src/agent/loop.ts:530–574`. The condition is
`cumulativePromptTokens >= maxInputTokens && toolCalls.length > 0`.

A turn that ends with zero tool calls bypasses budget enforcement. In
practice agents do sometimes emit long pure-text turns past the cap.

**Fix:** evaluate budget on every iteration end; let the no-tools case
short-circuit straight to `BudgetExhaustedError` instead of an extra
synthesis turn.

### RF-6 — `MAX_PROMPT_TOKENS = 240_000` hard error (S)

`src/agent/loop.ts:157, 455–459`. Throws if the local estimate exceeds the
cap.

The estimator's accuracy isn't independently verified anywhere in the
repo. If the estimate is conservative we throw early; if it's permissive
we still hit the 256k Kimi context limit at the API. Either way, a hard
throw at the loop boundary is a worse UX than a compaction prompt.

**Fix:** at the cap, try one round of message compaction (drop oldest
tool results, keep their artifacts) before throwing.

### RF-7 — SSE idle timeout is global (S)

`src/agent/client.ts:254`, default 60_000 ms.

Cold Workers AI inferences on first-token-after-tool-use can exceed 60 s
under load. There is no per-call override and no exponential extend on
first-byte.

**Fix:** expose `idleTimeoutMs` on the call options. Bonus: once the first
data byte arrives, drop the idle timeout to 30 s — the model is alive.

### RF-8 — Retry backoff has weak jitter (S) — ✅ shipped (M1.1)

`src/agent/client.ts:116`, `500 * 2^attempt + random(0..250)`.

Under a thundering herd (e.g., a Cloudflare incident affecting Workers
AI), all clients retry on nearly identical schedules. The ±250 ms jitter
window is too narrow at the larger waits.

**Fix:** full-jitter backoff: `random(0, 500 * 2^attempt)`.

**Status:** Applied to both retry sites (network-error branch and
API-error branch including rate-limit handling) in `src/agent/client.ts`.

### RF-9 — Artifact eviction is age-only (S)

`src/agent/session-state.ts:82–88`.

LRU-by-timestamp ignores artifact size. Evicting one 200 KB artifact
frees more headroom than evicting five 5 KB ones, but the policy will
prefer the latter.

**Fix:** size-weighted LRU: pick the oldest item whose size would
materially relieve pressure (e.g., evict the largest among the oldest
quartile).

### RF-10 — In-place mutation of `opts.messages` during skill rebuild (M)

`src/agent/loop.ts:248–272`.

The system message is mutated in place. If skill selection partially
succeeds and a downstream step fails, the messages array is left in a
hybrid state. Hard to reason about during error recovery and during
checkpoint capture.

**Fix:** snapshot messages, build the new system message into a local,
swap atomically. Guarantees the array is always in one of two known
states.

### RF-11 — Code-mode API cache key ignores parameter schemas (S)

`src/agent/loop.ts:293–328`. Cache key is `stableStringify(opts.tools)`,
which includes tool names but is otherwise a simple identity hash.

If a tool's parameter schema changes mid-session (e.g., user enables a new
LSP capability that widens the rename payload), the cached generated API
is stale. Code-mode-generated TS still compiles, but the runtime args may
mismatch.

**Fix:** include each tool's parameter schema digest in the cache key.

### RF-12 — Tool output truncation is silent to the UI (S)

`src/agent/loop.ts:704–708, 736–740`.

The truncation banner (`[truncated: N chars omitted]`) appears in the
model-facing message but nothing surfaces to the user. They cannot tell
that important grep matches or bash output disappeared without
re-running. The artifact store has the raw bytes — the UI just doesn't
know.

**Fix:** emit a `onTruncation(tool, rawBytes, reducedBytes, artifactId)`
callback; render an inline hint in the TUI ("output truncated — use
`expand artifact <id>` to view full").

### RF-13 — Sync FS tools don't honor `ctx.signal` (M)

`src/tools/read.ts`, `write.ts`, `edit.ts`, `glob.ts`, `grep.ts`.

`AbortScope` propagates correctly to bash and the network tools, but the
file-system tools never check `ctx.signal`. A grep over a large monorepo
or a recursive glob can block Ctrl+C for many seconds. The user
experience is "the TUI is frozen."

**Fix:** in grep, check `signal.aborted` between batches. In glob, wire
fast-glob's `signal` option (already supported upstream). In read on
large files, switch to a streaming read that checks the signal between
chunks. Edit and write are usually fast enough that a check-at-start is
sufficient.

### RF-14 — `src/app.tsx` is a 4,393-line god component (L)

Single `App()` function with ~60 hooks managing session, pickers,
modals, permissions, checkpoints, remote, theming, tasks, reasoning view,
input handling, and slash commands. Every change touches risk for every
other feature. Tests can only smoke-test the whole tree.

**Fix:** progressive extraction. Start with the isolated pieces (already
co-located but inlined):

1. `PermissionController` — modal + decision threading.
2. `PickerController` — file/mention/slash pickers share an underlying
   state machine.
3. `ModalHost` — limit, loop, command, LSP, theme, remote, inbox modals.
4. `SessionManager` — load, resume, checkpoint, save.
5. `TurnController` — supervisor wiring + status pills + reasoning view.
6. `AppRoot` — what remains.

After each extraction, the diff against `app.tsx` should shrink and the
new module should ship with its own tests. Track this as a quarter-long
effort, not a single PR.

### RF-15 — LSP `restartAttempts` is dead state (S) — ✅ shipped in #422

`src/lsp/manager.ts`. The field exists but is never incremented. There is
no auto-restart for crashed language servers; the session just shows the
server as "crashed" and stops offering its tools.

**Fix:** on `exit` with non-zero code, requeue start with exponential
backoff up to N attempts (e.g., 3). Surface attempts in `/lsp status`.

**Status:** Auto-restart with full-jitter exponential backoff (default
3 attempts, capped at 10s) landed in #422 as M3.3. `restartAttempts`
is now populated and surfaced on `LspServerStatus`. The `/lsp status`
slash-command surface itself remains to be built — deferred to avoid
conflict with the M4 `app.tsx` extractions.

### RF-16 — MCP and LSP tool calls have no per-call timeout (M) — ✅ shipped in #421 and #422

`src/mcp/manager.ts`, `src/lsp/manager.ts`.

A hung MCP server (slow upstream API, stuck stdio) blocks the agent turn
indefinitely. The session-level abort can still fire, but the loop sits
waiting on the tool call result until then.

**Fix:** per-tool `timeoutMs` (default 30–60 s for MCP, 10 s for most LSP
operations). Surface as a `ToolError` so the loop can recover the turn.

**Status:** MCP per-call timeout (default 60s) landed in #421 as
M3.1; LSP per-request timeout (default 10s) landed in #422 as M3.2.
Both configurable per server via `timeoutMs`. The structured
`ToolError` surface is still pending (M2.1) — for now timeouts
surface as plain labeled `Error` messages flattened to
`ToolResult.content`.

### RF-17 — Resume after reducer-config change can misread artifacts (M)

`src/agent/session-state.ts` + `src/tools/reducer.ts`.

Artifact contents include reduction hints (e.g., grep "first 50 lines /
3 matches per file"). Upgrading the reducer config changes the semantics
of that hint but the artifact text doesn't carry the version. A resumed
session may show stale framing.

**Fix:** stamp each artifact with `{ reducerName, reducerVersion }`. On
resume, if the version doesn't match, either re-reduce from raw (if
present) or annotate the artifact as "reduced under an older config."

### RF-18 — Bash co-author injection builds shell strings via regex (M)

`src/tools/bash.ts`, `injectCoauthor()` (~lines 103–142 in the version
this doc was written against).

Forty lines of regex matching plus string assembly to add a `Co-authored-by:`
trailer. The shell-escape story for the name and email is not obvious.
If the inputs ever come from a user-controlled source without prior
sanitization, this is a footgun.

**Fix:** assemble the trailer with parameter-style escaping (or a known-
good escape helper) rather than template strings; add a unit test with
adversarial inputs (`"`, `$`, `;`, backticks).

### RF-19 — `isolated-vm` → `node:vm` fallback warning fires once per process (S) — ✅ shipped (M1.10)

`src/code-mode/sandbox.ts`, `fallbackWarningShown` flag.

When the sandbox quietly downgrades from isolate to `node:vm`, the
warning is printed once per process. New sessions in the same process
(common when embedded via SDK) never see it. Users may not realize
they're outside a true sandbox.

**Fix:** track per session, not per process. Re-emit on each session
start that uses code mode.

**Status:** Boolean flag replaced with a `Set<sessionId>` keyed off
`ctx.sessionId`. New sessions in the same process now see the
warning.

### RF-20 — Ctrl+C race between `useInput` and SIGINT handler leaves TUI half-dead (S)

`src/app.tsx:1508` (useInput Ctrl+C branch) and `src/app.tsx:1613`
(SIGINT handler installed at `app.tsx:646`).

User-reported, long-standing. Symptom: pressing Ctrl+C during a busy
turn leaves the TUI in an in-between state where typed characters
still print to the screen but Enter does not submit. The session
appears usable but is broken.

Root cause: a Ctrl+C from the terminal sends **both** the raw byte
(captured by Ink's `useInput`) **and** the SIGINT signal (caught by
Node's `process.on("SIGINT")`). Both handlers fire:

1. `useInput` fires first (`app.tsx:1530`): sets
   `isAbortingRef.current = true`, kills the supervisor, aborts the
   scope. The reset of `isAbortingRef.current` back to `false` lives
   in the turn's `finally` block, which has not run yet.
2. A microtask later, the SIGINT handler fires (`app.tsx:1613`). It
   sees `isAborting === true`, so the
   `if (busyRef.current && activeScopeRef.current && !isAbortingRef.current)`
   branch at `1635` is **false**. It falls through to the
   `else if (!hadPerm && !hadLimit)` branch at `1645` — both of those
   were already drained by `useInput` — and calls `exit()`.

`exit()` runs while Ink's render tree is mid-cleanup; the UI tears
down halfway. Escape doesn't have this problem because Escape doesn't
trigger SIGINT.

**Fix:** add a one-line guard at the top of `sigintHandlerRef.current`:

```ts
if (isAbortingRef.current) {
  logger.info("sigint:handler:already-aborting");
  return; // useInput is handling it
}
```

This also leaves the fallback case (raw mode disabled, useInput
doesn't fire) working — in that case `isAborting` is still `false`
when the SIGINT handler runs and it does its dance correctly.

Tracked as M1.0 in the development roadmap.

---

## Opportunities

### Quick wins (S — pick most of these up in a week)

- **OP-1.** Full-jitter retry backoff (fix for RF-8).
- **OP-2.** Size-aware artifact eviction (fix for RF-9).
- **OP-3.** `onTruncation` callback + TUI hint (fix for RF-12).
- **OP-4.** Per-call SSE idle timeout knob (fix for RF-7).
- **OP-5.** `signal.aborted` checks inside grep/glob/read inner loops
  (fix for RF-13, first half).
- **OP-6.** Cross-turn `webFetchHistory` (fix for RF-3).
- **OP-7.** Memory extraction error counter + `/memory health` surface
  (fix for RF-1).
- **OP-8.** Sliding-window drift detection (fix for RF-2).
- **OP-9.** Zero-tool-call budget check (fix for RF-5).
- **OP-10.** Re-emit isolated-vm fallback warning per session
  (fix for RF-19).

### Medium investments (M)

- **OP-11.** Pluggable reducer registry. Replace the switch-on-name in
  `reducer.ts` with `registerReducer(toolName, fn)`. Lets MCP and skill-
  defined tools bring their own reductions. Pairs with RF-12.
- **OP-12.** Structured `ToolError { code, message, recoverable,
  suggestion }`. Today tool errors are strings shoved into the result
  content. A typed envelope unblocks reliable retry policies, lets the UI
  render "try X" hints, and lets the loop decide whether to back off vs.
  fail.
- **OP-13.** Permission decision returns `{ decision, cached }`. Today
  the loop cannot tell whether a permission was one-time or session-wide
  (the callback returns just the decision, the executor decides the
  caching separately). Pairs with the security audit story.
- **OP-14.** Artifact reducer-version stamp (fix for RF-17).
- **OP-15.** Per-call timeouts for MCP and LSP (fix for RF-16).
- **OP-16.** LSP auto-restart with exponential backoff (fix for RF-15).
- **OP-17.** Code-mode API freeze per turn. Generate the API once at turn
  start, hash it, and ensure all `execute_code` calls in the turn see the
  same snapshot. Eliminates RF-11.
- **OP-18.** Capture top-level async rejections in the sandbox via
  `.catch()` around the wrapper IIFE. Today rejected promises silently
  vanish.

### Bigger bets (L — quarter-scale)

- **OP-19.** Break up `app.tsx` (RF-14). This is the single largest
  velocity unlock. Until this happens, every UI change carries
  disproportionate review and regression risk. Sequence it as six
  extractions over a quarter, each shipping behind a no-op refactor PR.
- **OP-20.** Structured JSON telemetry. Emit `{ timestamp, level, module,
  event, fields }` to `~/.config/kimiflare/logs/` and optionally to a
  user-configured Datadog / Honeycomb / OpenTelemetry collector. Per-tool
  timing, retry attempts, truncation deltas, memory recall hit-rate,
  budget headroom — all queryable. Today this kind of analysis requires
  parsing session JSONs after the fact.
- **OP-21.** Delta-encoded session checkpoints with zstd. Today each
  checkpoint is a full snapshot; 1,000-turn sessions are unwieldy. Delta
  + compression should bring typical sessions to a few hundred KB and
  unlock much longer sessions without checkpoint storms.
- **OP-22.** Circuit breaker for MCP servers. After N consecutive
  failures from a single server, disable its tools for a cool-off and
  notify the user. Today a flaky MCP server poisons every turn until the
  user manually disables it.
- **OP-23.** Quotas / budgets per tool (e.g., max bash calls per turn,
  max bytes written per session). Complements the existing token budget
  and the web-fetch guardrail.
- **OP-24.** Cross-turn loop detection. Today the loop signature window
  is per-turn (`recentToolCalls`). Lifting it to session state catches
  the "same investigation, three turns running" pattern that current
  guardrails miss.
- **OP-25.** Multi-label cost attribution. The current classifier picks
  one category per turn. Tagging tokens into a category mix (e.g., 60 %
  feature, 40 % docs) matches reality better and improves the `/cost`
  report.

---

## Suggested ordering

A pragmatic next-quarter plan, balanced for risk and impact:

1. **Sprint 1 (week 1):** OP-1 through OP-10 — the quick wins. Each is a
   small, well-bounded PR.
2. **Sprint 2 (week 2–3):** OP-12 (structured `ToolError`) and OP-13
   (permission decision shape). These unblock cleaner code in subsequent
   sprints.
3. **Sprint 3 (week 4–5):** OP-15, OP-16 (timeouts + LSP auto-restart),
   plus the RF-13 second half (proper streaming read).
4. **Background, parallelizable:** start OP-19 (`app.tsx` breakup). Aim
   for one extraction every two weeks.
5. **Sprint 6 (week 8+):** OP-20 (structured telemetry). After this
   ships, the rest of the roadmap becomes data-driven.
6. **Stretch goals:** OP-21 (session checkpoint compression), OP-24
   (cross-turn loop detection). Both require schema or protocol changes;
   schedule alongside a release-please minor.

This roadmap leaves untouched: protocol-level changes (e.g., a Kimi v2 API
migration), GPU-side improvements (embedding model choice), and the
remote/Cloud product line. Those belong in separate documents.
