# Multi-Agent Standalone Workers — Completion Plan

> **Branch:** `feat/multi-agent-standalone-workers`  
> **Date:** 2026-05-27  
> **Status:** Phase 1 (Client) DONE — Phase 2 (Server) PARTIAL — Phase 3 (Activation) DONE  
> **PR:** #496 — merged to `main` at `830de47`

---

## Commit History

| Commit | Description |
|--------|-------------|
| `2f0c193` | **feat(multi-agent): implement standalone worker client side** — `spawn_worker` tool, supervisor orchestration, `WorkerList` UI, mock server, config fields. |
| `410cd28` | **feat(multi-agent): add multi-agent-experimental mode to client** — fourth mode, mode picker gating, status bar, slash commands, `multiAgentEnabled` flag. |
| `6ea3d90` | **feat(multi-agent): wire auto-triage gate into turn loop** — `autoSpawnWorkers()`, two-gate check (mode + tier), synthesizing state. |
| `bd1fbe1` | **feat(multi-agent): add /worker endpoint to remote worker** — Hono route, `worker-handler.ts`, plan-mode via Workers AI direct call. |
| `a3ee7e4` | **feat(multi-agent): polish — retry, tie-breaker, synthesizing state, docs** — retry logic in `spawn-worker.ts`, tie-breaker in `synthesizeFindings()`, `isSynthesizing` UI state. |
| `830de47` | **Merge branch 'main' into feat/multi-agent-standalone-workers** — resolved `src/config.ts` conflict (kept persisted-config pre-reading + worker fields). |

---

## 1. What We Have (Phase 1 — Client Side)

| File | Status | What it does |
|------|--------|--------------|
| `src/tools/spawn-worker.ts` | ✅ Done | `spawn_worker` tool. POSTs to `/worker` endpoint. Supports `mode: "plan"` and `mode: "execute"`. Retry on 5xx (1 attempt). |
| `src/tools/executor.ts` | ✅ Done | Registered `spawnWorkerTool` in `ALL_TOOLS`. |
| `src/agent/supervisor.ts` | ✅ Done | `spawnWorkers()` (parallel batching), `synthesizeFindings()` (dedup + conflict detection + tie-breaker), `autoSpawnWorkers()`, `ActiveWorker` tracking, `clearWorkers()`. |
| `src/agent/loop.ts` | ✅ Done | Added `onWorkersUpdated` callback to `AgentCallbacks`. |
| `src/agent/messages.ts` | ✅ Done | Added `WorkerResultMessage` and `WorkerFinding` types. |
| `src/config.ts` | ✅ Done | Added `workerEndpoint`, `workerBudgetUsd`, `workerMaxParallel`, `workerTimeoutMs`, `multiAgentEnabled` with env var support. Merged with main's persisted-config pre-reading. |
| `src/ui/worker-list.tsx` | ✅ Done | Ink component showing active worker status with live elapsed timer and "Synthesizing..." state. |
| `src/ui/app.tsx` | ✅ Done | Wired `onWorkersUpdated` into turn callbacks; renders `<WorkerList>` above task list. Two-gate auto-triage in `processMessage`. |
| `scripts/mock-worker-server.mjs` | ✅ Done | Local mock server for testing without Commute. |

**What was built in this PR:**
1. ✅ **Explicit activation mechanism** — `multi-agent-experimental` mode via Shift-Tab (gated by `multiAgentEnabled`) or `/mode`.
2. ✅ **Auto-triage gate** — workers only spawn when mode is multi-agent AND tier is `heavy`.
3. ✅ **Coordinator synthesis** — findings deduplicated, conflicts detected, tie-broken by confidence, presented to user.
4. ⚠️ **Commute server side** — `/worker` endpoint exists in `remote/worker/` but plan mode is a single Workers AI call (not a real agent loop), and execute mode is unimplemented.

---

## 2. The One Decision We Made: Explicit Activation

We are **not** guessing when to spawn workers. We made it explicit.

### New Mode: `multi-agent-experimental`

A fourth mode on top of `edit`, `plan`, `auto`:

| Mode | Behavior |
|------|----------|
| `edit` | Default. Prompts before mutating tools. |
| `plan` | Read-only research. Blocks writes. |
| `auto` | Auto-approves every tool call. |
| `multi-agent-experimental` | **NEW.** When active AND the user's prompt is classified as `heavy`, the coordinator automatically spawns parallel research workers instead of handling the turn locally. Hidden unless `multiAgentEnabled` is `true`. |

### How to Activate

1. **Config or env var** — set `"multiAgentEnabled": true` in `~/.config/kimiflare/config.json` or `KIMIFLARE_MULTI_AGENT_ENABLED=1`.
2. **Shift-Tab keyboard shortcut** — cycles `edit → plan → auto → multi-agent-experimental → edit` (skips if not enabled).
3. **Slash command** — `/mode multi-agent-experimental` (or `/mode` to open the mode picker).

### The Two-Gate Rule

Both conditions must be true for workers to spawn:

1. **Mode gate:** `mode === "multi-agent-experimental"`
2. **Tier gate:** `classifyIntent(prompt).tier === "heavy"`

If mode is `multi-agent-experimental` but tier is `light` or `medium`, the turn runs **locally** as a normal turn (with a small info message: "multi-agent mode active, but task is light — running locally").

If tier is `heavy` but mode is NOT `multi-agent-experimental`, the turn runs **locally** as it does today (no change).

---

## 3. Implementation Status

### Phase 3A: Add `multi-agent-experimental` Mode to KimiFlare Client — ✅ DONE

| # | File | Change | Commit |
|---|------|--------|--------|
| 1 | `src/mode.ts` | Added `"multi-agent-experimental"` to `Mode` union and `MODES` array. Updated `nextMode()` cycle. Added `modeDescription()` and `systemPromptForMode()` cases. | `410cd28` |
| 2 | `src/commands/builtins.ts` | Updated `/mode` argHint to include `multi-agent-experimental`. | `410cd28` |
| 3 | `src/ui/slash-commands.ts` | Updated `handleMode` to accept `multi-agent-experimental` as valid arg. | `410cd28` |
| 4 | `src/ui/status.tsx` | Renders new mode name in status bar (truncated to "multi-agent"). | `410cd28` |
| 5 | `src/ui/mode-picker.tsx` | Filters out `multi-agent-experimental` unless `multiAgentEnabled` is true. | `410cd28` |
| 6 | `src/config.ts` | Added `multiAgentEnabled` boolean flag (default `false`). | `410cd28` |

### Phase 3B: Auto-Triage Gate — Wire Spawning into Turn Loop — ✅ DONE

| # | File | Change | Commit |
|---|------|--------|--------|
| 7 | `src/agent/supervisor.ts` | Added `autoSpawnWorkers(prompt, context)` that decomposes a heavy prompt into 2-4 parallel research tasks via heuristic splitting. | `6ea3d90` |
| 8 | `src/ui/app.tsx` | In `processMessage`, after `classifyIntent()`, checks two-gate rule. If true, calls `supervisorRef.current.autoSpawnWorkers()` and skips normal `runAgentTurn()`. | `6ea3d90` |
| 9 | `src/ui/app.tsx` | After workers complete, appends synthesized findings as a system message to `messagesRef.current`, then runs a local turn to present results. | `6ea3d90` |
| 10 | `src/ui/app.tsx` | If mode is multi-agent but tier is not heavy, shows info message and proceeds with normal local turn. | `6ea3d90` |

### Phase 3C: Commute Server Side (`remote/worker/`) — ⚠️ PARTIAL

| # | File | Change | Status | Commit |
|---|------|--------|--------|--------|
| 11 | `remote/worker/src/index.ts` | Added `/worker` POST endpoint. Parses payload, validates `mode`, `task`. | ✅ Done | `bd1fbe1` |
| 12 | `remote/worker/src/worker-handler.ts` | **New file.** Handles auth, request validation, dispatches to `runPlanWorker()`. | ✅ Done | `bd1fbe1` |
| 13 | `remote/worker/src/worker-handler.ts` | `runPlanWorker()` — calls Workers AI directly with a structured JSON system prompt. Returns `WorkerResponse`. | ✅ Done | `bd1fbe1` |
| 14 | `remote/worker/src/types.ts` | Added `WORKER_API_KEY` and `ACCOUNT_ID` to `Env`. | ✅ Done | `bd1fbe1` |
| 15 | `remote/worker/src/worker-handler.ts` | **Execute mode** — branch creation, commit, push, PR opening. | ❌ NOT DONE | — |
| 16 | `remote/worker/src/worker-handler.ts` | **Real agent loop** — plan mode should run a full agent turn with read-only tools (file read, web search, grep), not a single LLM call. | ❌ NOT DONE | — |
| 17 | `remote/worker/src/worker-handler.ts` | **Plan-mode tool enforcement** — filter tool set to exclude write/edit/bash. Currently moot because there is no tool loop. | ❌ NOT DONE | — |

**Current behavior of `/worker`:**
- `mode: "plan"` → single Workers AI call with structured JSON prompt. No file reading, no web search, no tool loop. The LLM hallucinates findings based on its training data.
- `mode: "execute"` → returns HTTP `501` with error `"Execute mode is not yet implemented in the remote worker."`

### Phase 3D: Integration & Polish — ✅ DONE

| # | File | Change | Commit |
|---|------|--------|--------|
| 18 | `src/tools/spawn-worker.ts` | Added retry logic (1 retry on 5xx). Better error messages. | `a3ee7e4` |
| 19 | `src/agent/supervisor.ts` | Added tie-breaker in `synthesizeFindings()`: prefers higher `confidence` on conflict. | `a3ee7e4` |
| 20 | `src/ui/worker-list.tsx` | Added "Synthesizing..." state after all workers complete but before findings are presented. | `a3ee7e4` |
| 21 | `src/app.tsx` | Added `isSynthesizing` state, wired into `WorkerList`. | `a3ee7e4` |

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
KIMIFLARE_WORKER_ENDPOINT=https://commute.your-account.workers.dev/worker KIMIFLARE_MULTI_AGENT_ENABLED=1 npm run dev
```

Test the full flow:
1. Switch to `multi-agent-experimental` mode.
2. Send a heavy research prompt.
3. Verify 3 parallel workers run and return structured JSON.
4. Verify coordinator synthesizes findings into a coherent plan.
5. (Optional) Test execute mode: spawn executor worker, verify branch + PR creation. **← NOT YET POSSIBLE**

---

## 5. File-by-File Checklist

### KimiFlare Client (this repo)

- [x] `src/mode.ts` — add `multi-agent-experimental` mode
- [x] `src/commands/builtins.ts` — update `/mode` command help
- [x] `src/ui/slash-commands.ts` — accept new mode in `handleMode`
- [x] `src/ui/status.tsx` — render new mode in status bar
- [x] `src/ui/mode-picker.tsx` — gate mode behind `multiAgentEnabled`
- [x] `src/ui/app.tsx` — wire auto-triage gate into `processMessage`
- [x] `src/agent/supervisor.ts` — add `autoSpawnWorkers()` and prompt decomposition
- [x] `src/agent/supervisor.ts` — add tie-breaker in `synthesizeFindings()`
- [x] `src/config.ts` — add `multiAgentEnabled` flag + worker config fields
- [x] `src/tools/spawn-worker.ts` — add retry logic
- [x] `src/ui/worker-list.tsx` — add synthesizing state

### Commute Server (`remote/worker/`)

- [x] `remote/worker/src/index.ts` — `/worker` endpoint
- [x] `remote/worker/src/worker-handler.ts` — request handler, auth, validation
- [x] `remote/worker/src/worker-handler.ts` — plan mode via Workers AI direct call
- [x] `remote/worker/src/types.ts` — add `WORKER_API_KEY` and `ACCOUNT_ID` to Env
- [ ] `remote/worker/src/worker-handler.ts` — **real agent loop with read-only tools**
- [ ] `remote/worker/src/worker-handler.ts` — **plan-mode tool enforcement**
- [ ] `remote/worker/src/worker-handler.ts` — **execute mode (branch, commit, push, PR)**

### Docs

- [x] `docs/plans/multi-agent-standalone-workers-plan.md` — development plan
- [x] `docs/plans/multi-agent-standalone-workers-completion-plan.md` — this file

---

## 6. Success Criteria

- [x] User can activate `multi-agent-experimental` mode via Shift-Tab or `/mode multi-agent-experimental` (when enabled).
- [x] When mode is active and prompt is `heavy`, parallel research workers spawn automatically.
- [x] When mode is active but prompt is `light`/`medium`, turn runs locally with an info message.
- [x] Worker results are synthesized into a coherent plan presented to the user.
- [x] Commute server `/worker` endpoint accepts plan tasks and returns structured JSON.
- [ ] Commute server `/worker` endpoint runs a **real agent with read-only tools** in plan mode (not a single LLM call).
- [ ] Commute server `/worker` endpoint accepts execute tasks and creates branch + PR.

---

## 7. What's Next (Future Work)

1. **Real agent loop in plan mode** — Instead of a single Workers AI call, the worker should run a full `runAgentTurn` with a filtered tool set (read-only). This requires porting or reusing KimiFlare's agent loop inside the Cloudflare Worker (or running it in a Durable Object with more CPU time).
2. **Plan-mode tool enforcement** — Filter `ALL_TOOLS` to exclude `write`, `edit`, `bash`, `browser_fetch`, and `mcp_*` tools. Currently irrelevant because there is no tool loop.
3. **Execute mode** — Implement git branch creation, commit, push, and PR opening. Needs `GITHUB_TOKEN` env var and git binary access (may require a containerized agent rather than a pure Worker).
4. **Cost tracking per worker** — The worker currently estimates cost at `$0.00`. Real cost attribution requires parsing Workers AI usage headers or Gateway logs.
5. **Worker cancellation** — `/worker/:id/cancel` endpoint is not implemented.

---

*Last updated: 2026-05-27 after merge of `feat/multi-agent-standalone-workers` into `main` at `830de47`.*
