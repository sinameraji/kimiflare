# M7.1 — Subagent Primitive with Orchestration

> **Branch:** `feat/m7-subagent-primitive`
> **Status:** In progress.
> **Authoritative plan** for the M7.1 work. Self-contained so any agent
> reading this can pick up mid-stream without re-running the design
> conversation. Related planning docs are listed in the
> [Related plans](#related-plans) section.

## Goal

Add a subagent primitive to KimiFlare that lets the model decompose
heavy tasks into child agent invocations with isolated context, while
respecting the existing supervisor / tier / mode architectures and
slotting cleanly into the existing memory DB, telemetry, and artifact
infrastructure (no parallel logging system).

## Non-goals for this PR

- M7.2 parallel `Promise.all` over `Agent` calls (~50 LOC follow-up).
- M7.3 worktree isolation.
- Streaming child reasoning to parent UI in real-time.
- Auto-routing (model still has to call `Agent` itself).

## Architecture summary

Three integration points that constrain the design:

1. **Supervisor.** Strictly one-at-a-time turn execution
   (`src/agent/supervisor.ts:39-42`). Subagent fan-out lives *inside*
   the parent `runAgentTurn`, not in a second supervisor.
   Ctrl+C / abort cascades for free via `AbortScope` parent-child tree.
2. **Tier.** `light` / `medium` / `heavy` from
   `src/intent/classify.ts`. Controls whether the `Agent` tool is
   registered for the turn:
   - `light` — not registered (cost floor > benefit).
   - `medium` — `Agent(explore, …)` only, single-shot, no plan tools.
   - `heavy` — full primitive: `Agent`, `plan_set`, `plan_update`.
3. **Mode.** `plan` / `edit` / `auto` from `src/mode.ts`. A child can
   never have looser mode than its parent. Plan-mode parent → child's
   tool list runs through `isBlockedInPlanMode` after subagent-type
   filter. Per-tool-type allowlists are intersected, never widened.

## Roles (orchestration)

- **Orchestrator** = the parent's `runAgentTurn`, augmented to read the
  load-bearing plan state. Owns the AbortScope tree and dispatches
  children. No separate orchestrator class.
- **Workers** = subagent `runAgentTurn` invocations with isolated
  messages, filtered tools, shared memory + skills DB, scaled-down
  budgets (25 iter / 60k tokens).
- **Verifier** = the parent's next iteration after a child returns.
  No separate verifier role.

Collaboration model: **shared-nothing message passing.** Siblings never
talk to each other. The parent embeds prior child reports into later
child prompts if needed. The parent's plan is the contract.

## Empowering structure, bounded by graceful ceilings

Option A locked: plan tools are load-bearing — the loop reads plan
state for natural termination — but never cripple the agent.

| Ceiling | Value | Behavior |
|---|---|---|
| Subagents per turn | 8 | 9th `Agent` call returns typed `ToolError` "fanout cap reached". |
| Subagents per session | 25 | Same, harder boundary. |
| Tool iterations per turn | 50 (existing) | Existing throw, unchanged. |
| Wall-clock per turn (soft) | 5 min | Inject system message: "5 minutes elapsed. Plan state: [X done, Y pending]. Synthesize the best answer from completed work." |
| Wall-clock per turn (hard) | 10 min | Hard abort + graceful TUI prompt via `LimitModal` pattern. |
| Subagent depth | 2 | Child cannot call `Agent` past depth 2. |

When ceilings fire and need user input, reuse the existing
`LimitModal` pattern (`src/ui/limit-modal.tsx`,
`onToolLimitReached` plumbing in `src/agent/loop.ts:446-459`,
`setLimitModal` in `src/app.tsx:1481-1484`). Generic over decision
type — pass custom `title`, `description`, `items`.

## Telemetry & persistence — slot into what exists

No new logging systems. Each existing store has a natural home:

| Store | Where | What we add |
|---|---|---|
| `cost-debug.jsonl` (`src/cost-debug.ts`) | append-only telemetry, child gets own entries by sessionId | optional `parentSessionId` field |
| `usage.json` (`src/usage-tracker.ts`) | per-session cost; child has own entry | optional `parentSessionId` so `/cost` rolls children under parent |
| `~/.config/kimiflare/logs/<date>.jsonl` (file sink, M5.1) | structured logs | emit `subagent.start` / `subagent.complete` / `subagent.aborted` |
| Memory DB (`src/memory/db.ts`) | `source_session_id` already partitions per child | no schema change |
| Session storage (`src/sessions.ts`) | parent session message history records child's *summary* tool result naturally | no change |
| `ArtifactStore` (`src/agent/session-state.ts`) | full child transcript stored as new artifact type | add `subagent_transcript` to `ArtifactType` union; reuse `expand_artifact` tool — no new recall tool |
| Memory extractors (`src/memory/extractors.ts`) | post-hoc on tool results | add 5th extractor for `Agent` tool — child summary → `event` memory, `topicKey: child_summary_${task_id}` |

**Child sessionId convention** = `${parent}.sub${idx}` — deterministic,
load-bearing for partitioning across all stores.

## What gets cloned vs. shared vs. fresh

| Resource | Strategy | Why |
|---|---|---|
| `sessionId` | Fresh: `${parent}.sub${idx}` | Partitions module-level Maps (drift, web-fetch, memory-error counters) |
| `messages` | Fresh: system + `[{role: user, content: prompt}]` | Whole isolation point |
| `tools` | `(parent.tools) ∩ (subagent_type preset) ∩ (mode allowlist)` | Never widen |
| `memoryManager`, `skillsDb` | **Shared** | Memories are durable; subagents contribute back |
| `ArtifactStore`, `ToolArtifactStore` | Fresh (own executor instance) | Child's `expand_artifact` shouldn't return parent's stuff |
| `AbortScope` | Child of parent turn scope via `createChild()` | Free cascade |
| `accountId`, `apiToken`, `model`, `gateway`, `cloud*` | Shared | Same account |
| `maxToolIterations` / `maxInputTokens` | Independent: 25 iter / 60k tokens | Bounded budget |
| `askPermission` | **Forwarded to parent** with child-id prefix in UI | Single consistent permission stream |
| `callbacks` | Mostly suppressed; forward `onWarning`, `onToolWillExecute`, `onTruncation` with child-id tag | UI shows "Agent(explore) running…" without spamming |

## Session health (Tier 1 self-awareness)

Long sessions slow exponentially due to (a) cache hit rate collapse,
(b) larger prefill cost, (c) reasoning × input size. Tier 1 from the
design conversation goes in this PR; Tiers 2 and 3 (consent prompt
and auto-routing-to-child) are follow-ups pending real session data.

Implementation: small `src/agent/health.ts` module computing turn
health at turn end from existing telemetry signals (`durationMs`,
`cacheDiagnostics.cacheHitRatio`, `promptTotalApproxTokens`, tier
baseline). Diagnosis = `healthy` / `context_bloat` / `cache_collapse`.
When non-healthy, inject a single-line system message into the next
turn's context: "Note: this session is running ~Nx slower than
baseline. Consider whether the next task needs full history." Model
sees it. UI surfaces a subtle hint.

Explicit guardrail: heavy-tier turns are never auto-context-shed.
Quality regression is impossible to fully prevent but never invisible.

## Files

**New:**
- `src/subagents/presets.ts` — registry of `general`, `explore`, `plan`
  subagent types with tool filters + defaults.
- `src/agent/subagent.ts` — `runSubagentTurn(parentCtx, args)` wrapping
  `runAgentTurn` with child config.
- `src/tools/agent.ts` — the `Agent` tool definition.
- `src/tools/plan.ts` — `plan_set` and `plan_update` tools that the
  loop reads (not just narrative like `tasks_set`).
- `src/agent/health.ts` — Tier 1 session health diagnosis.
- Tests for each.

**Modified:**
- `src/agent/loop.ts` — read plan state for natural turn termination,
  wall-clock ceiling, inject health hint at turn end.
- `src/cost-debug.ts` — add optional `parentSessionId`.
- `src/usage-tracker.ts` — add optional `parentSessionId` to session
  record.
- `src/agent/session-state.ts` — add `subagent_transcript` to
  `ArtifactType` union.
- `src/memory/extractors.ts` — add `Agent` tool result extractor.
- `src/tools/executor.ts` — conditional tool registration based on tier.
- `src/app.tsx` — render subagent event as collapsible block; pass tier
  to executor; add new `LimitModal` invocations for wall-clock and
  fanout ceilings.

## Test priorities (the things that bite)

1. Mode enforcement: parent in `plan` mode → child's tool list filtered
   through `isBlockedInPlanMode` before dispatch.
2. `askPermission` flows through parent's controller with child-id
   prefix in the UI prompt.
3. AbortScope cascade: parent Ctrl+C kills in-flight child within ~50ms.
4. Depth cap: child cannot call `Agent` past depth 2 (typed error).
5. Fanout cap: 9th `Agent` call returns typed error.
6. Wall-clock soft warning: system message injected at 5min.
7. Wall-clock hard cap: `LimitModal` invoked at 10min with
   continue/synthesize/stop options.
8. Plan natural termination: heavy turn ends only when plan tasks are
   all terminal AND model emits no further tool calls.
9. Telemetry partition: child's `cost-debug` entries carry
   `parentSessionId`.
10. Memory extractor: `Agent` tool result produces an `event` memory
    with deterministic topic key.
11. Artifact storage: full child transcript retrievable via existing
    `expand_artifact`.
12. Tier gating: `light`-tier turn does not include `Agent` in its tool
    list; `medium` includes only `Agent(explore, …)`.

## Implementation order

Commits land roughly in this order. Each row records the commit SHA
once shipped.

| # | Subject | Status | Commit |
|---|---|---|---|
| 1 | Subagent type presets + tool filtering | ✅ done | `bb4e142` |
| 2 | `runSubagentTurn` helper + `Agent` tool registration | pending | — |
| 3 | Plan tools (`plan_set` / `plan_update`) load-bearing in loop | pending | — |
| 4 | Mode + tier-gated tool registration | pending | — |
| 5 | Wall-clock ceiling + graceful `LimitModal` integration | pending | — |
| 6 | Telemetry: `parentSessionId` in cost-debug + usage-tracker | pending | — |
| 7 | Artifact: `subagent_transcript` type + transcript persistence | pending | — |
| 8 | Memory extractor for `Agent` tool result | pending | — |
| 9 | Session health diagnosis (Tier 1) | pending | — |
| 10 | UI: collapsible subagent event in app.tsx | pending | — |
| 11 | Tests across all the above | pending | — |

## Related plans

- `docs/plans/adaptive-agent-routing.md` — covers intent
  classification (Phase 3), tier-gated code mode (Phase 4), and
  parallel research agents (Phase 5). This M7.1 plan supersedes the
  Phase 5 "Parallel Research Agents" sketch with a more complete
  orchestration model; the Phase 3/4 work it builds on is already
  shipped.
- `docs/architecture/agent-loop-findings.md` RF-6 — `MAX_PROMPT_TOKENS`
  hard error; this PR's wall-clock ceiling pairs with it (RF-6's fix
  is the auto-compaction in M7.4, separate).
- `docs/architecture/development-roadmap.md` M7.4 — auto-compaction at
  `MAX_PROMPT_TOKENS`, intentionally NOT in this PR.

## Open follow-ups (track separately, don't expand scope here)

- **M7.2** — Parallel subagent execution (`Promise.all`).
- **M7.3** — Worktree isolation.
- **M7.4** — Auto-compaction (RF-6 fix).
- **M7.5** — Session health Tier 2 (consent prompt) and Tier 3
  (auto-route to fresh-context child). Pending real cost-debug data
  to tune thresholds.
- **M4 continued** — Streaming child reasoning to parent UI needs the
  app.tsx breakup to be further along.
