# Multi-Agent Standalone Workers — Development Plan

> **Branch:** `feat/multi-agent-standalone-workers`  
> **Date:** 2026-05-24  
> **Status:** Phase 1 (KimiFlare client) DONE — Phase 2 (Commute server) NOT STARTED

---

## Progress Summary

### ✅ DONE — KimiFlare Client Side

| File | What was done |
|------|---------------|
| `src/tools/spawn-worker.ts` | **NEW** — `spawn_worker` tool. POSTs to `/worker` endpoint. Supports `mode: "plan"` (research) and `mode: "execute"` (write + PR). |
| `src/tools/executor.ts` | Registered `spawnWorkerTool` in `ALL_TOOLS`. |
| `src/agent/supervisor.ts` | Added `spawnWorkers()` (parallel batching with `workerMaxParallel`), `synthesizeFindings()` (dedup + conflict detection), `ActiveWorker` tracking, `clearWorkers()`. |
| `src/agent/loop.ts` | Added `onWorkersUpdated` callback to `AgentCallbacks`. |
| `src/agent/messages.ts` | Added `WorkerResultMessage` and `WorkerFinding` types. |
| `src/config.ts` | Added `workerEndpoint`, `workerBudgetUsd`, `workerMaxParallel`, `workerTimeoutMs` with env var support (`KIMIFLARE_WORKER_*`). |
| `src/ui/worker-list.tsx` | **NEW** — Ink component showing active worker status (running/completed/failed) with live elapsed timer. |
| `src/ui/app.tsx` | Wired `onWorkersUpdated` into turn callbacks; renders `<WorkerList>` above task list. |
| `scripts/mock-worker-server.mjs` | **NEW** — Local mock server for testing without Commute. Returns fake structured results after 1.5s delay. |

### ⬜ NOT DONE — Commute Server Side

The Commute server (`~/kimiflare-web` or wherever the remote worker lives) needs:

| File | What needs to be built |
|------|------------------------|
| `remote/worker/src/index.ts` | Add `/worker` endpoint: accepts task JSON, runs agent, returns structured JSON. |
| `remote/worker/src/agent.ts` | Lightweight agent runner for worker mode (reuses existing KimiFlare code). |
| `remote/worker/src/plan-mode.ts` | Enforce plan mode: disable write/edit/bash mutations. |
| `remote/worker/src/artifact.ts` | Git branch creation, commit, push helpers (execute mode only). |
| `remote/worker/src/github.ts` | PR creation via GitHub API (execute mode only). |
| `remote/worker/wrangler.toml` | Add Durable Object bindings for worker isolation. |

### ⬜ NOT DONE — Phase 3 Polish

- **Auto-triage** — coordinator automatically detecting "heavy" tasks and spawning workers without the user/model explicitly asking. Currently the model must choose to call `spawn_worker`.
- Worker result caching (avoid re-researching same topics).
- Cost attribution per worker in the usage tracker.
- Fallback to local subprocess if Commute is unavailable.
- Real end-to-end test with 3 parallel research workers against a live endpoint.

---

## Architecture

```
User Request → Coordinator (local KimiFlare TUI)
                    │
                    ▼ (parallel, async)
        ┌─────────────────────────────┐
        │   Spawn N Research Workers  │  ← remote Commute instances
        │   (read-only plan mode)     │
        └─────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   [Worker A]  [Worker B]  [Worker C]
   (OAuth2     (Auth.ts    (Test gaps)
    research)   patterns)
        │           │           │
        └───────────┴───────────┘
                    │
                    ▼
        Coordinator synthesizes findings
        into unified execution plan
                    │
                    ▼
        Spawn Executor Worker (remote)
        ├─ Pull latest main
        ├─ Create feature branch
        ├─ Execute plan (write mode)
        ├─ Commit & push
        └─ Open PR via GitHub API
```

---

## Worker Lifecycle

### 3.1 Spawn

Coordinator calls Commute API with:

```json
{
  "mode": "plan",
  "task": "Research OAuth2 best practices for TypeScript Express apps. Focus on PKCE, refresh token rotation, and session management.",
  "context": "We are refactoring auth in a TypeScript CLI tool that uses Cloudflare Workers AI. Current auth is basic API-key based. We want OAuth2 for GitHub integration.",
  "budget": { "maxCostUsd": 1.0 },
  "outputFormat": "structured",
  "tools": "read-only",
  "model": "@cf/moonshotai/kimi-k2.6"
}
```

### 3.2 Execution

Worker runs as full KimiFlare instance:
- Loads `KIMI.md` from repo root automatically
- Has access to memory, LSP, MCP, web search, file read
- **Plan mode enforced** — no write/edit/bash mutations possible
- Uses full Kimi K2.6 model
- Self-limits to ~$1 cost ceiling

### 3.3 Return

Worker returns structured JSON:

```json
{
  "workerId": "worker-a-7f3d9",
  "status": "completed",
  "task": "Research OAuth2 best practices...",
  "findings": [
    {
      "topic": "PKCE Flow",
      "summary": "PKCE is mandatory for public clients and recommended for all OAuth2 flows per RFC 7636.",
      "confidence": "high",
      "sources": ["RFC 7636", "auth0.com/docs"],
      "relevance": "critical"
    }
  ],
  "recommendations": [
    "Use @octokit/auth-oauth-app for GitHub OAuth",
    "Implement refresh token rotation with 30-day expiry"
  ],
  "filesRead": ["src/auth.ts", "src/config.ts"],
  "webSources": ["https://auth0.com/docs/..."],
  "costUsd": 0.34,
  "tokensUsed": 45200,
  "reasoning": "..."
}
```

---

## Coordinator Logic

### 4.1 When to Spawn Workers

The coordinator's triage system should detect "heavy" tasks:

| Signal | Action |
|--------|--------|
| User says "research X and Y and Z" | Spawn 3 parallel researchers |
| Task involves >3 distinct domains | Spawn domain specialists |
| User explicitly says "get multiple opinions" | Spawn N workers with same task |
| Large refactor touching >5 files | Research phase → execution phase |

**Current state:** Auto-triage is NOT implemented. The model must explicitly call `spawn_worker`. The `classifyIntent()` function in `src/intent/classify.ts` already computes a tier (`light`/`medium`/`heavy`) — this could be extended to auto-trigger worker spawning when `tier === "heavy"` and the prompt mentions multiple distinct research topics.

### 4.2 Synthesis

Coordinator receives all worker outputs and:
1. Deduplicates findings
2. Resolves conflicts (e.g., Worker A says "use library X", Worker B says "use library Y")
3. Produces unified execution plan
4. Decides whether to execute locally or spawn executor worker

**Current state:** `synthesizeFindings()` in `src/agent/supervisor.ts` implements steps 1 and 2 (conflict detection). It does NOT auto-resolve conflicts — it flags them for the user/coordinator to decide.

### 4.3 Executor Worker

If remote execution is chosen:

```json
{
  "mode": "execute",
  "plan": "<synthesized execution plan>",
  "branchName": "feat/oauth2-refactor",
  "baseBranch": "main",
  "prTitle": "Refactor auth to OAuth2 with PKCE",
  "prBody": "<generated from findings>"
}
```

Executor:
1. Pulls latest `main`
2. Creates branch `feat/oauth2-refactor`
3. Executes plan (write mode enabled)
4. Commits with conventional commit message
5. Pushes to origin
6. Opens PR via GitHub API

**Current state:** The `spawn_worker` tool accepts `mode: "execute"` and forwards `branchName`, `baseBranch`, `prTitle`, `prBody` to the endpoint. The server side must implement the actual git/GitHub operations.

---

## Implementation Breakdown

### KimiFlare (this repo) — DONE ✅

| File | Change | Lines | Status |
|------|--------|-------|--------|
| `src/agent/supervisor.ts` | `spawnWorkers()`, `synthesizeFindings()`, `ActiveWorker` | ~120 | ✅ Done |
| `src/agent/loop.ts` | `onWorkersUpdated` callback | ~5 | ✅ Done |
| `src/tools/executor.ts` | Register `spawnWorkerTool` | ~2 | ✅ Done |
| `src/tools/spawn-worker.ts` | **New** — tool implementation | ~150 | ✅ Done |
| `src/config.ts` | Worker config fields | ~10 | ✅ Done |
| `src/ui/app.tsx` | Wire `WorkerList` into TUI | ~15 | ✅ Done |
| `src/ui/worker-list.tsx` | **New** — worker status component | ~80 | ✅ Done |
| `src/agent/messages.ts` | `WorkerResultMessage` type | ~25 | ✅ Done |
| `scripts/mock-worker-server.mjs` | **New** — local test server | ~80 | ✅ Done |

**Total: ~487 lines new/changed in KimiFlare**

### Commute (`~/kimiflare-web`) — NOT STARTED ⬜

| File | Change | Lines | Status |
|------|--------|-------|--------|
| `remote/worker/src/index.ts` | Add `/worker` endpoint | ~150 | ⬜ Not started |
| `remote/worker/src/agent.ts` | **New** — lightweight agent runner | ~100 | ⬜ Not started |
| `remote/worker/src/plan-mode.ts` | Enforce plan mode | ~50 | ⬜ Not started |
| `remote/worker/src/artifact.ts` | Git branch creation, commit, push | ~80 | ⬜ Not started |
| `remote/worker/src/github.ts` | PR creation via GitHub API | ~60 | ⬜ Not started |
| `remote/worker/wrangler.toml` | Durable Object bindings | ~20 | ⬜ Not started |

**Total: ~460 lines new/changed in Commute (estimated)**

### Shared / Protocol — DONE ✅

| Concern | Decision | Status |
|---------|----------|--------|
| Auth | Commute API key passed via `X-Worker-Api-Key` header | ✅ |
| Transport | HTTPS POST to Commute `/worker` endpoint | ✅ |
| Payload | JSON in, JSON out | ✅ |
| Timeout | 5 minutes per worker (configurable via `workerTimeoutMs`) | ✅ |
| Cancellation | Coordinator can POST `/worker/:id/cancel` | ⬜ Not implemented |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Workers are remote (Commute)** | Avoids laptop crash with 3-4 parallel Node processes; leverages existing infrastructure |
| **Workers use full K2.6** | Research quality is critical; no model downgrade |
| **Workers run in plan mode** | Prevents accidental mutations; enforces read-only research |
| **Workers return structured JSON** | Enables programmatic synthesis by coordinator |
| **Executor creates branch + PR** | Keeps main safe; follows GitHub flow |
| **No shared context buffer** | Eliminates the sync hell that killed previous attempts |
| **Coordinator decides parallelism** | Not automatic for every task; only when triage signals "heavy" |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Worker hangs / never returns | 5-minute timeout; coordinator treats as failed |
| Workers conflict in findings | Synthesis step explicitly resolves conflicts |
| Cost explosion (4× API calls) | $1/worker budget; coordinator can limit N workers |
| Executor worker breaks main | Branch + PR means main is never directly touched |
| Commute downtime | Fallback to local subprocess mode (Phase 3) |
| Git auth issues | Executor uses GitHub App token or PAT stored in Commute secrets |

---

## Phases

### Phase 1: Research Workers (MVP) — KimiFlare Client DONE ✅

- [x] KimiFlare: Add `spawn_worker` tool
- [x] KimiFlare: Coordinator synthesis logic (`synthesizeFindings`)
- [x] KimiFlare: TUI worker status display (`WorkerList`)
- [x] KimiFlare: Worker config (`workerEndpoint`, `workerBudgetUsd`, etc.)
- [x] Mock server for local testing
- [ ] Commute: Add `/worker` endpoint with plan mode ← **NEXT AGENT START HERE**
- [ ] End-to-end test: 3 research workers on a sample task

### Phase 2: Executor Worker

- [ ] Commute: Add execute mode with git branch + PR
- [ ] KimiFlare: `execute_plan` tool (or reuse `spawn_worker` with `mode: "execute"`)
- [ ] Integration test: full flow from request to PR

### Phase 3: Polish

- [ ] Auto-triage: coordinator spawns workers automatically on heavy tasks
- [ ] Worker result caching (avoid re-research)
- [ ] Cost attribution per worker
- [ ] Fallback to local subprocess if Commute unavailable

---

## Handoff Notes for Next Agent

1. **The KimiFlare client side is complete and type-checked.** All new code has JSDoc comments. Tests pass (`npm test` → 657 pass).

2. **The next piece is the Commute server side.** You need to build the `/worker` endpoint that:
   - Accepts a JSON payload matching `SpawnWorkerArgs` (see `src/tools/spawn-worker.ts`)
   - Runs a KimiFlare agent in plan mode (no write tools)
   - Returns a `WorkerResultMessage` (see `src/agent/messages.ts`)
   - For `mode: "execute"`, also handles git branch creation, commit, push, and PR opening

3. **To test locally without Commute:** Run `node scripts/mock-worker-server.mjs` in one terminal, then `KIMIFLARE_WORKER_ENDPOINT=http://localhost:9999 npm run dev` in another. In the TUI, type: `spawn_worker mode=plan task="Research OAuth2 best practices"`

4. **Auto-triage is not wired.** The model must explicitly call `spawn_worker`. If you want to implement auto-triage, look at `classifyIntent()` in `src/intent/classify.ts` — it already returns a `tier`. You could extend the turn start logic in `src/agent/loop.ts` or `src/app.tsx` to automatically call `supervisor.spawnWorkers()` when `tier === "heavy"` and the prompt mentions multiple research topics.

5. **The `spawnWorkers()` method in `TurnSupervisor` is designed for programmatic use.** It is NOT currently called from anywhere in the codebase. The tool (`spawn_worker`) and the supervisor method are separate entry points. If you want the tool to use the supervisor's batching logic, refactor `spawn-worker.ts` to call `supervisor.spawnWorkers()` instead of making a single fetch.

6. **Conflict resolution in `synthesizeFindings()` only flags conflicts.** It does not pick a winner. A future improvement could use confidence scores or a tie-breaker LLM call.

---

## Open Questions

1. Should the coordinator expose worker findings to the user in real-time, or only after synthesis?
2. Should workers have access to the coordinator's conversation history, or only the mission brief?
3. How do we handle workers that ask clarifying questions? (Current plan: workers must complete autonomously; if they need input, they fail and coordinator asks user.)
4. Should we support "worker-of-workers" — a worker spawning sub-workers? (Proposed: no, max 1 level.)

---

## Success Criteria

- [ ] A user can say "Research OAuth2, testing strategies, and migration path for our auth refactor" and get 3 parallel research reports
- [ ] Coordinator synthesizes into a coherent execution plan
- [ ] Executor worker creates a branch, implements changes, and opens a PR
- [ ] Total cost is transparent and under budget
- [ ] Main branch is never directly modified by workers

---

*Plan updated by KimiFlare on branch `feat/multi-agent-standalone-workers`*
