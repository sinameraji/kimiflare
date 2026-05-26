# Multi-Agent Standalone Workers — Completion Plan

> **Branch:** `feat/multi-agent-standalone-workers`  
> **Date:** 2026-05-26  
> **Status:** Phase 1 (Client) DONE — Phase 2 (Server) DONE — Phase 3 (Activation) DONE  
> **PR:** #496 — all phases complete.

---

## 1. What We Have (Phase 1 — Client Side)

| File | Status | What it does |
|------|--------|--------------|
| `src/tools/spawn-worker.ts` | ✅ Done | `spawn_worker` tool. POSTs to `/worker` endpoint. Supports `mode: "plan"` and `mode: "execute"`. |
| `src/tools/executor.ts` | ✅ Done | Registered `spawnWorkerTool` in `ALL_TOOLS`. |
| `src/agent/supervisor.ts` | ✅ Done | `spawnWorkers()` (parallel batching), `synthesizeFindings()` (dedup + conflict detection), `ActiveWorker` tracking, `clearWorkers()`. |
| `src/agent/loop.ts` | ✅ Done | Added `onWorkersUpdated` callback to `AgentCallbacks`. |
| `src/agent/messages.ts` | ✅ Done | Added `WorkerResultMessage` and `WorkerFinding` types. |
| `src/config.ts` | ✅ Done | Added `workerEndpoint`, `workerBudgetUsd`, `workerMaxParallel`, `workerTimeoutMs` with env var support. |
| `src/ui/worker-list.tsx` | ✅ Done | Ink component showing active worker status with live elapsed timer. |
| `src/ui/app.tsx` | ✅ Done | Wired `onWorkersUpdated` into turn callbacks; renders `<WorkerList>` above task list. |
| `scripts/mock-worker-server.mjs` | ✅ Done | Local mock server for testing without Commute. |

**What was built in this PR:**
1. ✅ **Explicit activation mechanism** — `multi-agent-experimental` mode via Shift-Tab or `/mode`.
2. ✅ **Auto-triage gate** — workers only spawn when mode is multi-agent AND tier is `heavy`.
3. ✅ **Commute server side** — `/worker` endpoint in `remote/worker/` with plan-mode support.
4. ✅ **Integration** — wired activation + triage + spawning into the turn loop.

---

## 2. The One Decision We Just Made: Explicit Activation

We are **not** guessing when to spawn workers. We are making it explicit.

### New Mode: `multi-agent-experimental`

A fourth mode on top of `edit`, `plan`, `auto`:

| Mode | Behavior |
|------|----------|
| `edit` | Default. Prompts before mutating tools. |
| `plan` | Read-only research. Blocks writes. |
| `auto` | Auto-approves every tool call. |
| `multi-agent-experimental` | **NEW.** When active AND the user's prompt is classified as `heavy`, the coordinator automatically spawns parallel research workers instead of handling the turn locally. |

### How to Activate

1. **Shift-Tab keyboard shortcut** — cycles `edit → plan → auto → multi-agent-experimental → edit`.
2. **Slash command** — `/mode multi-agent-experimental` (or `/mode` to open the mode picker).

### The Two-Gate Rule

Both conditions must be true for workers to spawn:

1. **Mode gate:** `mode === "multi-agent-experimental"`
2. **Tier gate:** `classifyIntent(prompt).tier === "heavy"`

If mode is `multi-agent-experimental` but tier is `light` or `medium`, the turn runs **locally** as a normal turn (with a small info message: "multi-agent mode active, but task is light — running locally").

If tier is `heavy` but mode is NOT `multi-agent-experimental`, the turn runs **locally** as it does today (no change).

---

## 3. Implementation Plan

### Phase 3A: Add `multi-agent-experimental` Mode to KimiFlare Client

**Goal:** Make the mode selectable and visible in the TUI.

| # | File | Change | Lines | Notes |
|---|------|--------|-------|-------|
| 1 | `src/mode.ts` | Add `"multi-agent-experimental"` to `Mode` union and `MODES` array. Update `nextMode()` cycle. Add `modeDescription()` case. Add `systemPromptForMode()` case. | ~15 | The system prompt should tell the model: "You are in multi-agent-experimental mode. For heavy tasks, parallel research workers will be spawned automatically. Do not call spawn_worker manually — the coordinator handles it." |
| 2 | `src/commands/builtins.ts` | Update `/mode` argHint to include `multi-agent-experimental`. | ~1 | |
| 3 | `src/ui/slash-commands.ts` | Update `handleMode` to accept `multi-agent-experimental` as valid arg. | ~3 | |
| 4 | `src/ui/status.tsx` | Ensure status bar renders the new mode name (may need truncation: `multi` or `ma-exp`). | ~2 | |
| 5 | `src/ui/app.tsx` | Add `multiAgentEligible` state or derive from `mode + intentTier`. | ~5 | |

### Phase 3B: Auto-Triage Gate — Wire Spawning into Turn Loop

**Goal:** When mode is `multi-agent-experimental` AND tier is `heavy`, automatically spawn workers instead of running a normal local turn.

| # | File | Change | Lines | Notes |
|---|------|--------|-------|-------|
| 6 | `src/agent/supervisor.ts` | Add `shouldAutoSpawn(mode, tier): boolean` helper. Add `autoSpawnWorkers(prompt, context)` method that constructs `SpawnWorkerOpts[]` from a heavy prompt. | ~40 | The method should decompose a heavy prompt into 2-4 parallel research tasks. For MVP, use a simple heuristic: if the prompt mentions "and" or lists multiple topics, split on those. Future: use an LLM call to decompose. |
| 7 | `src/agent/supervisor.ts` | Add `onWorkersUpdated` callback support in `autoSpawnWorkers` (already partially there via `spawnWorkers`). | ~5 | |
| 8 | `src/ui/app.tsx` | In `processMessage`, after `classifyIntent()`, check `modeRef.current === "multi-agent-experimental" && classification.tier === "heavy"`. If true, call `supervisorRef.current.autoSpawnWorkers()` and skip the normal `runAgentTurn()` path. | ~25 | Need to handle the case where workers are spawning: show info message, render `WorkerList`, and when workers complete, synthesize findings and present them to the user. |
| 9 | `src/ui/app.tsx` | After workers complete, append a system message with synthesized findings to `messagesRef.current`, then optionally run a local turn to present the results to the user. | ~20 | This ensures the user sees a coherent summary, not raw JSON. |
| 10 | `src/ui/app.tsx` | If mode is `multi-agent-experimental` but tier is NOT heavy, show an info message and proceed with normal local turn. | ~5 | |

### Phase 3C: Commute Server Side (Remote Worker)

**Goal:** Build the `/worker` endpoint that receives a mission brief, runs a KimiFlare agent, and returns structured JSON.

| # | File | Change | Lines | Notes |
|---|------|--------|-------|-------|
| 11 | `remote/worker/src/index.ts` | Add `/worker` POST endpoint. Parse payload, validate `mode`, `task`, `budget`. Return 400 on invalid input. | ~60 | Use Hono router. |
| 12 | `remote/worker/src/index.ts` | Add `/worker/:id/cancel` endpoint (optional for MVP, but nice). | ~15 | |
| 13 | `remote/worker/src/agent.ts` | **New file.** Lightweight agent runner. Reuses existing KimiFlare code: builds system prompt, runs `runAgentTurn` with read-only tools only (for `mode: "plan"`). | ~100 | Must enforce plan mode: filter `ALL_TOOLS` to exclude write/edit/bash. |
| 14 | `remote/worker/src/plan-mode.ts` | **New file.** Tool filter: given `ALL_TOOLS`, returns only read-safe tools. | ~30 | Same logic as `isBlockedInPlanMode()` in `src/mode.ts`. |
| 15 | `remote/worker/src/artifact.ts` | **New file.** Git helpers: `createBranch()`, `commit()`, `push()`. | ~60 | For `mode: "execute"`. Uses `node:child_process` to run git commands. |
| 16 | `remote/worker/src/github.ts` | **New file.** `createPullRequest()` using GitHub REST API. | ~50 | For `mode: "execute"`. Needs `GITHUB_TOKEN` env var. |
| 17 | `remote/worker/src/index.ts` | Wire execute mode: after plan completes, if `mode === "execute"`, create branch, apply changes, commit, push, open PR. | ~40 | |
| 18 | `remote/worker/wrangler.toml` | Add Durable Object or plain Worker binding. For MVP, a stateless Worker is fine. | ~10 | |
| 19 | `remote/worker/package.json` | Ensure all dependencies are listed. | ~5 | |

### Phase 3D: Integration & Polish

| # | File | Change | Lines | Notes |
|---|------|--------|-------|-------|
| 20 | `src/tools/spawn-worker.ts` | Update `callWorkerEndpoint` to handle HTTP errors gracefully (retry once on 5xx). | ~15 | |
| 21 | `src/agent/supervisor.ts` | In `synthesizeFindings()`, add a tie-breaker: if two workers conflict, prefer the one with higher `confidence`. | ~10 | |
| 22 | `src/ui/worker-list.tsx` | Add a "Synthesizing..." state after all workers complete but before findings are presented. | ~10 | |
| 23 | `src/config.ts` | Add `multiAgentEnabled` boolean flag (default `false`). Only show `multi-agent-experimental` in mode cycle if this is `true`. | ~5 | This hides the experimental mode from casual users until they opt in via config or env var. |
| 24 | `docs/plans/multi-agent-standalone-workers-plan.md` | Update progress summary. Mark Phase 3 items as done. | ~20 | |

---

## 4. Testing Plan

### Local Testing (No Commute)

```bash
# Terminal 1 — mock server
node scripts/mock-worker-server.mjs

# Terminal 2 — KimiFlare TUI with multi-agent mode enabled
KIMIFLARE_WORKER_ENDPOINT=http://localhost:9999 KIMIFLARE_MULTI_AGENT_ENABLED=1 npm run dev
```

In the TUI:
1. Press Shift-Tab until mode shows `multi-agent-experimental`.
2. Send a **light** prompt: `"What is 2+2?"` → should run locally, show info message.
3. Send a **heavy** prompt: `"Research OAuth2 best practices, testing strategies, and migration path for our auth refactor"` → should spawn 3 workers, show `WorkerList`, then synthesize findings.

### Commute Testing (Full End-to-End)

```bash
# Deploy worker
cd remote/worker && wrangler deploy

# Run KimiFlare with deployed endpoint
KIMIFLARE_WORKER_ENDPOINT=https://commute.your-account.workers.dev/worker npm run dev
```

Test the full flow:
1. Switch to `multi-agent-experimental` mode.
2. Send a heavy research prompt.
3. Verify 3 parallel workers run and return structured JSON.
4. Verify coordinator synthesizes findings into a coherent plan.
5. (Optional) Test execute mode: spawn executor worker, verify branch + PR creation.

---

## 5. File-by-File Checklist

### KimiFlare Client (this repo)

- [x] `src/mode.ts` — add `multi-agent-experimental` mode
- [x] `src/commands/builtins.ts` — update `/mode` command help
- [x] `src/ui/slash-commands.ts` — accept new mode in `handleMode`
- [x] `src/ui/status.tsx` — render new mode in status bar
- [x] `src/ui/app.tsx` — wire auto-triage gate into `processMessage`
- [x] `src/agent/supervisor.ts` — add `autoSpawnWorkers()` and prompt decomposition
- [x] `src/config.ts` — add `multiAgentEnabled` flag
- [x] `src/tools/spawn-worker.ts` — add retry logic
- [x] `src/ui/worker-list.tsx` — add synthesizing state

### Commute Server (`remote/worker/`)

- [x] `remote/worker/src/index.ts` — `/worker` endpoint
- [x] `remote/worker/src/worker-handler.ts` — lightweight agent runner via Workers AI
- [x] `remote/worker/src/types.ts` — add `WORKER_API_KEY` and `ACCOUNT_ID` to Env

### Docs

- [x] `docs/plans/multi-agent-standalone-workers-plan.md` — update progress
- [x] `docs/plans/multi-agent-standalone-workers-completion-plan.md` — this file, mark sections done as we go

---

## 6. Success Criteria

- [ ] User can activate `multi-agent-experimental` mode via Shift-Tab or `/mode multi-agent-experimental`.
- [ ] When mode is active and prompt is `heavy`, parallel research workers spawn automatically.
- [ ] When mode is active but prompt is `light`/`medium`, turn runs locally with an info message.
- [ ] Worker results are synthesized into a coherent plan presented to the user.
- [ ] Commute server `/worker` endpoint accepts plan tasks and returns structured JSON.
- [ ] Commute server `/worker` endpoint accepts execute tasks and creates branch + PR.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Prompt decomposition is naive (splits on "and") | MVP heuristic is acceptable. Future: use LLM to decompose. |
| Commute server not deployed yet | Mock server covers local testing. Deploy Commute before merging PR. |
| User forgets they are in multi-agent mode | Status bar clearly shows mode. System prompt reminds model. |
| Heavy prompt classification false positives | Tier gate is conservative. User can always switch back to `edit` mode. |
| Cost explosion from auto-spawn | `$1/worker` budget enforced. Max 3 parallel by default. |

---

*Plan written by KimiFlare on branch `feat/multi-agent-standalone-workers`*
*Co-authored-by: kimiflare <kimiflare@proton.me>*
