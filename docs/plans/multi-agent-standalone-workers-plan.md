# Multi-Agent Standalone Workers — Development Plan

> **Branch:** `feat/multi-agent-standalone-workers`  
> **Date:** 2026-05-24  
> **Status:** Design Complete — Ready for Implementation

---

## 1. Vision

Replace the failed shared-buffer multi-agent attempts with a **standalone worker model**. Each worker is a fully independent KimiFlare agent instance (remote, via Commute) that receives a mission brief, executes in read-only plan mode, and returns structured findings. The coordinator synthesizes findings and spawns an executor worker that writes to a sandboxed git branch and opens a PR.

**Key principle:** Workers are not sharded context — they are separate agent instances with their own full 250K context windows, tool access, and reasoning capabilities.

---

## 2. Architecture

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

## 3. Worker Lifecycle

### 3.1 Spawn

Coordinator calls Commute API (or local subprocess) with:

```json
{
  "mode": "plan",
  "task": "Research OAuth2 best practices for TypeScript Express apps. Focus on PKCE, refresh token rotation, and session management.",
  "context": "We are refactoring auth in a TypeScript CLI tool that uses Cloudflare Workers AI. Current auth is basic API-key based. We want OAuth2 for GitHub integration.",
  "budget": { "maxCostUsd": 1.0 },
  "outputFormat": "structured",
  "tools": "all",
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

Worker returns structured JSON to stdout (or via callback):

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
  "webSources": ["https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-proof-key-for-code-exchange-pkce"],
  "costUsd": 0.34,
  "tokensUsed": 45200,
  "reasoning": "..."
}
```

---

## 4. Coordinator Logic

### 4.1 When to Spawn Workers

The coordinator's triage system should detect "heavy" tasks:

| Signal | Action |
|--------|--------|
| User says "research X and Y and Z" | Spawn 3 parallel researchers |
| Task involves >3 distinct domains | Spawn domain specialists |
| User explicitly says "get multiple opinions" | Spawn N workers with same task |
| Large refactor touching >5 files | Research phase → execution phase |

### 4.2 Synthesis

Coordinator receives all worker outputs and:
1. Deduplicates findings
2. Resolves conflicts (e.g., Worker A says "use library X", Worker B says "use library Y")
3. Produces unified execution plan
4. Decides whether to execute locally or spawn executor worker

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

---

## 5. Implementation Breakdown

### 5.1 KimiFlare (this repo) — ~400-600 lines

| File | Change | Lines |
|------|--------|-------|
| `src/agent/supervisor.ts` | Add `spawnWorkers()` and `synthesizeFindings()` | ~120 |
| `src/agent/loop.ts` | Add worker orchestration hooks in turn loop | ~80 |
| `src/tools/executor.ts` | Add `spawn_worker` tool definition | ~40 |
| `src/tools/spawn-worker.ts` | **New** — tool implementation: calls Commute API or local subprocess | ~150 |
| `src/config.ts` | Add `workerEndpoint`, `workerBudgetUsd` config | ~30 |
| `src/ui/app.tsx` | Show worker status spinners / progress | ~100 |
| `src/agent/messages.ts` | Add `WorkerResultMessage` type | ~20 |
| `src/models/registry.ts` | Ensure worker model is always K2.6 | ~10 |

**Total: ~550 lines new/changed in KimiFlare**

### 5.2 Commute (`~/kimiflare-web`) — ~300-500 lines

| File | Change | Lines |
|------|--------|-------|
| `remote/worker/src/index.ts` | Add `/worker` endpoint: accepts task JSON, runs agent, returns structured JSON | ~150 |
| `remote/worker/src/agent.ts` | **New** — lightweight agent runner for worker mode (reuses existing code) | ~100 |
| `remote/worker/src/plan-mode.ts` | Enforce plan mode: disable write tools | ~50 |
| `remote/worker/src/artifact.ts` | Git branch creation, commit, push helpers | ~80 |
| `remote/worker/src/github.ts` | PR creation via GitHub API | ~60 |
| `remote/worker/wrangler.toml` | Add Durable Object bindings for worker isolation | ~20 |

**Total: ~460 lines new/changed in Commute**

### 5.3 Shared / Protocol

| Concern | Decision |
|---------|----------|
| Auth | Commute API key passed via `X-Worker-Api-Key` header |
| Transport | HTTPS POST to Commute `/worker` endpoint |
| Payload | JSON in, JSON out |
| Timeout | 5 minutes per worker (configurable) |
| Cancellation | Coordinator can POST `/worker/:id/cancel` |

---

## 6. Key Design Decisions

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

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Worker hangs / never returns | 5-minute timeout; coordinator treats as failed |
| Workers conflict in findings | Synthesis step explicitly resolves conflicts |
| Cost explosion (4× API calls) | $1/worker budget; coordinator can limit N workers |
| Executor worker breaks main | Branch + PR means main is never directly touched |
| Commute downtime | Fallback to local subprocess mode (Phase 2) |
| Git auth issues | Executor uses GitHub App token or PAT stored in Commute secrets |

---

## 8. Phases

### Phase 1: Research Workers (MVP)
- [ ] Commute: Add `/worker` endpoint with plan mode
- [ ] KimiFlare: Add `spawn_worker` tool
- [ ] KimiFlare: Coordinator synthesis logic
- [ ] End-to-end test: 3 research workers on a sample task

### Phase 2: Executor Worker
- [ ] Commute: Add execute mode with git branch + PR
- [ ] KimiFlare: Add `execute_plan` tool that spawns executor
- [ ] Integration test: full flow from request to PR

### Phase 3: Polish
- [ ] TUI worker status display
- [ ] Worker result caching (avoid re-research)
- [ ] Cost attribution per worker
- [ ] Fallback to local subprocess if Commute unavailable

---

## 9. Open Questions

1. Should the coordinator expose worker findings to the user in real-time, or only after synthesis?
2. Should workers have access to the coordinator's conversation history, or only the mission brief?
3. How do we handle workers that ask clarifying questions? (Current plan: workers must complete autonomously; if they need input, they fail and coordinator asks user.)
4. Should we support "worker-of-workers" — a worker spawning sub-workers? (Proposed: no, max 1 level.)

---

## 10. Success Criteria

- [ ] A user can say "Research OAuth2, testing strategies, and migration path for our auth refactor" and get 3 parallel research reports
- [ ] Coordinator synthesizes into a coherent execution plan
- [ ] Executor worker creates a branch, implements changes, and opens a PR
- [ ] Total cost is transparent and under budget
- [ ] Main branch is never directly modified by workers

---

*Plan written by KimiFlare on branch `feat/multi-agent-standalone-workers`*
