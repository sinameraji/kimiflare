# Parallel Research Agents — Implementation Plan

> **Status:** Ready for implementation  
> **Branch:** `feat/parallel-research-agents`  
> **Date:** 2026-05-23  
> **Author:** kimiflare  
> **Co-author:** sinameraji

---

## 1. Executive Summary

Build a multi-agent research system where KimiFlare's coordinator (local TUI) spawns N parallel research agents in Cloudflare Sandboxes via the Commute Worker. Each agent is a **full KimiFlare instance** running in **plan mode** (read-only), using the **full Kimi-K2.6 model**, with full LSP and MCP capabilities. Agents work on forked Artifacts repos, return structured findings, and the coordinator synthesizes results before sequential execution.

**Key principle:** Reuse everything. Don't reinvent wheels. Commute already has Sandboxes, Artifacts, SessionDOs, and headless agents. Kimiflare already has print mode, plan mode, and the agent loop. We wire them together.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  LOCAL: KimiFlare TUI (Coordinator)                                 │
│  ───────────────────────────────────                                │
│  User: "Refactor auth to use JWT"                                   │
│                                                                     │
│  1. Coordinator classifies as "heavy" → triggers parallel research  │
│  2. Calls `spawn_research_agents(plan)` tool                        │
│  3. POST https://commute-worker/orchestrate                         │
│                                                                     │
│  4. Polls GET /orchestrate/:id/status                               │
│  5. Receives findings as tool result                                │
│  6. Synthesizes → decides execution approach                        │
│  7. Sequential execution (or spawns executor agent)                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTPS
┌─────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE: Commute Worker (kimiflare-commute)                     │
│  ─────────────────────────────────────────────                      │
│  Existing: Auth, GitHub OAuth, SessionDO, Sandbox, Artifacts        │
│                                                                     │
│  NEW: OrchestratorDO (Durable Object)                               │
│  - POST /orchestrate → creates OrchestratorDO                       │
│  - GET  /orchestrate/:id/status → polls agent statuses              │
│  - GET  /orchestrate/:id/results → returns aggregated findings      │
│                                                                     │
│  OrchestratorDO lifecycle:                                          │
│  1. Receives { repo, agents[], githubToken, credentials }           │
│  2. Forks Artifacts repo N times (one per agent)                    │
│  3. Creates N SessionDOs (reuses existing SessionDO class)          │
│  4. Each SessionDO → Sandbox → KimiFlare headless agent             │
│  5. Collects JSON results as agents complete                        │
│  6. Stores aggregated results, marks orchestration complete         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  N PARALLEL SANDBOXES (Cloudflare Sandbox)                          │
│  ─────────────────────────────────────────                          │
│  Each sandbox runs:                                                 │
│                                                                     │
│  kimiflare --print "<task>" \                                       │
│    --mode plan \           ← CRITICAL: read-only, no mutations      │
│    --json-output \         ← NEW: structured output                 │
│    --max-cost-cents 100 \  ← $1.00 hard ceiling per agent           │
│    --max-iterations 20     ← prevent runaway research               │
│                                                                     │
│  Agent capabilities (full KimiFlare):                               │
│  - Full Kimi-K2.6 model                                             │
│  - Full tool set: read, grep, glob, lsp_*, web_fetch, memory_*      │
│  - Full LSP (if configured in credentials)                          │
│  - Full MCP (if configured in credentials)                          │
│  - Full triage system (agent decides its own approach)              │
│  - Full memory (recall + remember)                                  │
│  - Own Artifacts fork (isolated from other agents)                  │
│                                                                     │
│  Output: Structured JSON to stdout                                  │
│  {                                                                  │
│    "type": "final_report",                                          │
│    "agentId": "auth-flow",                                          │
│    "status": "complete",                                            │
│    "findings": {                                                    │
│      "filesRead": [...],                                            │
│      "keyFindings": [...],                                          │
│      "relationships": [...],                                        │
│      "openQuestions": [...]                                         │
│    },                                                               │
│    "usage": { "promptTokens": 1234, "completionTokens": 567 },      │
│    "toolCallsMade": 8,                                              │
│    "durationMs": 45000                                              │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Why This Design

### 3.1 Why Commute (Not a Separate Worker)

Commute already has:
- ✅ GitHub OAuth + user auth
- ✅ Artifacts integration (import, fork, tokens)
- ✅ Sandbox spawning (`getSandbox`)
- ✅ SessionDO (session lifecycle, progress tracking)
- ✅ Headless agent (`remote/agent/src/remote-agent.ts`)
- ✅ KimiFlare installation in sandbox
- ✅ Config injection (Cloudflare credentials)

Adding orchestration to Commute is **~200 lines** vs. building a new worker from scratch (**~2000+ lines**).

**Guardrail:** The `/orchestrate` endpoints are additive. Commute's existing `/setup`, `/progress`, `/verify`, WebSocket terminal all continue working unchanged.

### 3.2 Why Plan Mode for Research Agents

Plan mode already exists in Kimiflare and enforces:
- `write` tool → blocked
- `edit` tool → blocked  
- `bash` with mutations → blocked
- Only `read`, `grep`, `glob`, `lsp_*`, `web_fetch`, `memory_*` allowed

We don't need new permission logic. Just pass `--mode plan` to print mode.

### 3.3 Why Full Kimi-K2.6 for All Agents

Research quality is critical. No compromises on model capability. Coordinator, workers, and eventual executor all use `@cf/moonshotai/kimi-k2.6`.

### 3.4 Why Artifacts Forking

Each agent gets its own fork:
- Agents can read the full codebase
- Agents cannot interfere with each other
- Forks are cheap (git refs, not full copies)
- Forks auto-delete after orchestration completes

---

## 4. Implementation Phases

### Phase 1: KimiFlare Print Mode Enhancements (~150 LOC)

**Goal:** Add flags to print mode so it can be used as a headless research worker.

**Files:**
- `src/index.tsx` — add CLI flags
- `src/agent/loop.ts` — support structured output callback

**Changes:**

```typescript
// src/index.tsx — new flags
.option("--json-output", "output structured JSON instead of human-readable text")
.option("--mode <mode>", "run mode: interactive (default), print, rpc, plan")
.option("--max-cost-cents <n>", "hard cost ceiling in cents; exits when exceeded")
.option("--max-iterations <n>", "max tool calls before forced completion")
.option("--worker-id <id>", "worker identifier for correlation")
.option("--parent-session <id>", "parent session ID for correlation")
```

```typescript
// New behavior in print mode when --json-output is set:
// 1. Suppress human-readable streaming output
// 2. Collect all tool results into structured findings
// 3. On completion, output single JSON object to stdout
// 4. Exit code 0 = success, 1 = error, 42 = budget exhausted
```

**Plan mode enforcement:**
When `--mode plan` is passed to print mode:
- Override config mode to `plan`
- Inject system prompt hint: "You are in plan mode. You may only read and research. You cannot write, edit, or execute mutating commands."
- Executor blocks mutating tools regardless of `--dangerously-allow-all`

---

### Phase 2: KimiFlare Coordinator Tool (~200 LOC)

**Goal:** New tool `spawn_research_agents` that the coordinator calls.

**Files:**
- `src/tools/spawn-research-agents.ts` — new tool implementation
- `src/tools/executor.ts` — register in ALL_TOOLS
- `src/config.ts` — add `commuteWorkerUrl` config

**Tool spec:**

```typescript
export const spawnResearchAgentsTool: ToolSpec<{
  plan: {
    agents: Array<{
      id: string;
      task: string;
      focusAreas?: string[];  // optional file paths or directories
    }>;
    repo: { owner: string; name: string };
    githubToken?: string;
  };
}> = {
  name: "spawn_research_agents",
  needsPermission: true,  // user must approve spawning remote agents
  description: `...`,
  parameters: { ... },
  async run(args, ctx): Promise<ToolOutput> {
    // 1. Load config for commuteWorkerUrl, credentials
    // 2. POST /orchestrate to Commute Worker
    // 3. Poll /orchestrate/:id/status every 5s
    // 4. Render progress in TUI: "Research: 2/3 agents complete"
    // 5. On completion, GET /orchestrate/:id/results
    // 6. Return findings as structured JSON
  }
};
```

**TUI integration:**
- Status line shows: `🔬 Research: 3 agents active (auth-flow ✅, db-schema 🔄, tests ✅)`
- User can interrupt — sends abort signal to OrchestratorDO, which cancels pending agents

---

### Phase 3: Commute OrchestratorDO (~300 LOC)

**Goal:** New Durable Object that manages parallel agent lifecycle.

**Files:**
- `remote/worker/src/orchestrator-do.ts` — new file
- `remote/worker/src/index.ts` — add `/orchestrate` endpoints
- `remote/worker/wrangler.toml` — add OrchestratorDO binding

**OrchestratorDO interface:**

```typescript
export class OrchestratorDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private agents: Map<string, AgentState> = new Map();
  private status: "running" | "complete" | "error" | "cancelled" = "running";

  async fetch(request: Request): Promise<Response> {
    // Routes:
    // POST /start  → start orchestration
    // GET  /status → get current status
    // GET  /results → get final results
    // POST /cancel → abort all agents
  }

  private async startOrchestration(body: OrchestrationRequest): Promise<void> {
    // 1. Fork Artifacts repo for each agent
    // 2. Create SessionDO for each agent
    // 3. Trigger each SessionDO to run headless agent
    // 4. Start polling loop for completion
  }

  private async pollAgentCompletion(): Promise<void> {
    // Every 5s, check each agent's status
    // When all complete, synthesize and store results
  }
}
```

**OrchestrationRequest schema:**

```typescript
interface OrchestrationRequest {
  repo: { owner: string; name: string };
  agents: Array<{
    id: string;
    task: string;
    focusAreas?: string[];
  }>;
  githubToken: string;
  accountId: string;
  apiToken: string;
  model?: string;  // default: @cf/moonshotai/kimi-k2.6
  maxCostCentsPerAgent?: number;  // default: 100
  maxIterationsPerAgent?: number;  // default: 20
}
```

**SessionDO modifications (minimal):**
- Add `POST /run-headless` endpoint to SessionDO
- Accepts: `{ prompt, mode: "plan", jsonOutput: true, maxCostCents, maxIterations }`
- Runs: `kimiflare --print "<prompt>" --mode plan --json-output ...`
- Returns: agent's JSON output

---

### Phase 4: Agent Result Synthesis (~100 LOC)

**Goal:** Coordinator receives findings and synthesizes them.

**In `spawn_research-agents.ts`:**

```typescript
// After collecting all agent results:
const synthesisPrompt = `
You are the coordinator. Three research agents have investigated different aspects of a task.
Here are their findings:

${results.map(r => `### Agent: ${r.agentId}\n${JSON.stringify(r.findings, null, 2)}`).join('\n\n')}

Synthesize these findings into a coherent plan for execution. Identify:
1. Key insights across all agents
2. Conflicts or contradictions
3. Gaps that need more research
4. Recommended execution approach
`;

// Return synthesis as tool result
return { content: JSON.stringify({ synthesis, rawFindings: results }), ... };
```

**Note:** The synthesis happens in the coordinator's next turn, not in the tool itself. The tool returns raw findings; the LLM synthesizes naturally.

---

### Phase 5: Executor Agent (Future — Not in Initial PR)

**Goal:** After research, spawn an executor agent that creates a PR.

**Not in initial implementation.** The coordinator can execute sequentially locally first. Once parallel research is proven, add:

```typescript
// New tool: spawn_executor_agent
const spawnExecutorAgentTool: ToolSpec<{
  task: string;
  synthesis: string;
  branchName: string;
}> = {
  name: "spawn_executor_agent",
  // Spawns ONE agent in a Sandbox with write access
  // Agent creates branch, makes changes, pushes to Artifacts
  // Commute Worker creates PR via GitHub API
};
```

---

## 5. File-by-File Change List

### KimiFlare (this repo) — ~450 lines

| File | Change | LOC |
|------|--------|-----|
| `src/index.tsx` | Add `--json-output`, `--mode plan`, `--max-cost-cents`, `--max-iterations`, `--worker-id`, `--parent-session` flags | +40 |
| `src/index.tsx` | `runPrintMode()` — handle `--json-output` mode | +60 |
| `src/agent/loop.ts` | Add `onStructuredOutput?` callback; emit final JSON | +30 |
| `src/tools/spawn-research-agents.ts` | **New file** — tool implementation | +120 |
| `src/tools/executor.ts` | Register `spawn_research_agents` in ALL_TOOLS | +5 |
| `src/config.ts` | Add `commuteWorkerUrl?: string` | +10 |
| `src/ui/chat.ts` | Render research progress events | +30 |
| `src/app.tsx` | Wire up research progress to status line | +40 |
| `docs/plans/parallel-research-agents-implementation.md` | This document | +250 |

### Commute (`~/kimiflare-web`) — ~500 lines

| File | Change | LOC |
|------|--------|-----|
| `remote/worker/src/orchestrator-do.ts` | **New file** — OrchestratorDO class | +200 |
| `remote/worker/src/index.ts` | Add `/orchestrate` POST, `/orchestrate/:id/status` GET, `/orchestrate/:id/results` GET, `/orchestrate/:id/cancel` POST | +80 |
| `remote/worker/src/session-do.ts` | Add `/run-headless` endpoint | +60 |
| `remote/worker/src/types.ts` | Add OrchestratorDO types | +40 |
| `remote/worker/wrangler.toml` | Add `ORCHESTRATOR_DO` binding | +5 |
| `remote/agent/src/remote-agent.ts` | Support `--json-output`, `--mode plan`, `--max-cost-cents`, `--max-iterations` | +80 |
| `remote/agent/src/remote-agent.ts` | Output structured JSON on completion | +40 |

**Total: ~950 lines across both repos.**

---

## 6. Cost Model

| Component | Cost |
|-----------|------|
| OrchestratorDO (coordination) | Negligible (no LLM calls) |
| Each research agent | $0.00–$1.00 (capped at $1.00) |
| 3 parallel research agents | $0.00–$3.00 |
| Coordinator synthesis | One extra LLM call (~$0.10–$0.50) |
| **Total per heavy task** | **~$0.50–$3.50** |

Compare to sequential research: one agent might spend $2.00–$5.00 exploring slowly. Parallel agents cap at $3.00 and finish 2–3× faster.

---

## 7. Security & Guardrails

### 7.1 Plan Mode Enforcement

Research agents **must** run in plan mode. Enforcement layers:

1. **CLI flag:** `--mode plan` passed to print mode
2. **System prompt:** "You are in plan mode. You cannot write, edit, or execute mutating commands."
3. **Executor:** `plan` mode blocks `write`, `edit`, and mutating `bash` regardless of `--dangerously-allow-all`
4. **Sandbox:** Artifacts fork can be read-only (optional)

### 7.2 Cost Ceiling

Each agent has a hard cost ceiling:
- `--max-cost-cents 100` = $1.00
- Tracked via `cf-aig-metadata` or local token counting
- When exceeded: agent outputs `{ status: "budget_exhausted", partialFindings: ... }` and exits

### 7.3 Iteration Limit

Each agent has a max tool-call limit:
- `--max-iterations 20` (default)
- Prevents runaway research spirals
- When hit: agent synthesizes partial findings and exits

### 7.4 Timeout

OrchestratorDO enforces a global timeout:
- Default: 10 minutes per agent
- When hit: OrchestratorDO cancels pending agents, returns partial results

### 7.5 User Approval

`spawn_research_agents` tool has `needsPermission: true`:
- TUI shows: "Spawn 3 remote research agents? Estimated cost: $0.50–$3.00"
- User must approve before any agents are spawned

---

## 8. UX Flow

### 8.1 Happy Path

```
User: Refactor auth to use JWT

TUI:  🔬 This looks like a heavy task. I'll spawn 3 research agents
      to investigate different aspects. Estimated cost: $0.50–$3.00.
      
      Approve? [Y/n]

User: Y

TUI:  🔬 Research: 3 agents active
      auth-flow    🔄  Reading src/auth.ts...
      db-schema    🔄  Searching for user tables...
      tests        ✅  Complete (8 files read)

[5 seconds later]

TUI:  🔬 Research: 2/3 complete
      auth-flow    ✅  Complete (12 files read)
      db-schema    🔄  Checking migrations...
      tests        ✅  Complete (8 files read)

[10 seconds later]

TUI:  🔬 Research complete. Synthesizing findings...

[Coordinator receives findings, synthesizes, continues]

TUI:  Based on the research, here's what I found:
      1. Current auth uses session cookies (src/auth.ts:45)
      2. User schema already has email field (src/db/schema.ts:23)
      3. 3 existing auth tests need updating (tests/auth.test.ts)
      
      I'll now implement the JWT refactor. Proceed? [Y/n]
```

### 8.2 Interrupt Path

```
User: [presses Ctrl+C during research]

TUI:  🔬 Research interrupted. Cancelling remote agents...

[OrchestratorDO receives cancel signal, kills pending agents]

TUI:  Research cancelled. Partial findings:
      - auth-flow: Found src/auth.ts patterns
      - tests: Complete
      - db-schema: Cancelled
      
      What would you like to do?
```

### 8.3 Budget Exhausted Path

```
TUI:  🔬 Research: 1/3 complete
      auth-flow    ❌  Budget exhausted ($1.00)
      db-schema    ✅  Complete
      tests        ✅  Complete

TUI:  Two agents completed successfully. One agent hit the cost ceiling.
      Partial findings are available. Continue with what we have? [Y/n]
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

- `spawn-research-agents.test.ts` — mock Worker API, test polling logic
- `orchestrator-do.test.ts` — test agent lifecycle, cancellation, timeout

### 9.2 Integration Tests

- Local Commute Worker + Miniflare
- Spawn 2 research agents on a test repo
- Verify they return structured JSON
- Verify plan mode enforcement

### 9.3 Manual Tests

- Real Cloudflare Sandbox
- Real Artifacts repo
- Verify cost tracking accuracy
- Verify interrupt behavior

---

## 10. Rollout Plan

| Step | Action |
|------|--------|
| 1 | Implement Phase 1 (KimiFlare print mode flags) |
| 2 | Implement Phase 2 (KimiFlare coordinator tool) |
| 3 | Implement Phase 3 (Commute OrchestratorDO) |
| 4 | Integration test locally |
| 5 | Deploy Commute Worker to staging |
| 6 | End-to-end test with real Sandboxes |
| 7 | Deploy Commute Worker to production |
| 8 | Merge KimiFlare PR |
| 9 | Monitor for 1 week, gather telemetry |
| 10 | Iterate based on usage |

---

## 11. Open Questions (For Implementation Agent)

1. **Should the coordinator tool live in Kimiflare main repo or as an MCP server?**
   - Main repo: simpler, direct integration
   - MCP server: more modular, could be used by other clients
   - **Recommendation:** Main repo for now. Extract to MCP later if needed.

2. **How does the coordinator know the Commute Worker URL?**
   - Config file: `commuteWorkerUrl: "https://kimiflare-commute.your-subdomain.workers.dev"`
   - Environment variable: `KIMIFLARE_COMMUTE_URL`
   - **Recommendation:** Both. Env var overrides config.

3. **Should research agents share memory with the coordinator?**
   - Option A: No — agents are standalone, coordinator doesn't see their memory
   - Option B: Yes — agents write to a shared session memory namespace
   - **Recommendation:** Option A for simplicity. The coordinator gets findings via the API response. Memory sharing adds complexity without clear benefit.

4. **What happens if Commute Worker is not configured?**
   - Graceful fallback: coordinator handles the task sequentially itself
   - Warning: "Commute Worker not configured. Running research sequentially."
   - **Recommendation:** Yes, always fallback to sequential.

5. **Should we support local subprocess workers as a fallback?**
   - If Commute is not available, spawn `kimiflare --print ...` locally
   - Pros: works without Cloudflare infrastructure
   - Cons: laptop resource usage, no true isolation
   - **Recommendation:** Not in initial PR. Add later if requested.

---

## 12. Success Metrics

| Metric | Target |
|--------|--------|
| Speedup for heavy tasks | 2–3× faster than sequential |
| Cost per heavy task | ≤ $3.50 (capped) |
| User approval rate for research spawning | > 80% |
| Agent completion rate | > 90% (not cancelled/budget exhausted) |
| Research quality | At least as good as sequential (measured by user satisfaction) |

---

## 13. Related Documents

- `docs/research/multi-agent-coding-architecture-research.md` — State of the art research
- `docs/plans/multi-agent-redesign-v2.md` — Previous (abandoned) multi-agent design
- `docs/designs/parallel-research-orchestration.md` — Previous parallel research attempt (disabled)
- `docs/incident-reports/2026-05-04-parallel-research-cost-spike.md` — Lessons from previous failure
- `docs/architecture/competitor-analysis.md` — Claude Code subagent analysis
- `~/kimiflare-web/README.md` — Commute architecture
- `~/kimiflare-web/remote/worker/src/session-do.ts` — SessionDO reference
- `~/kimiflare-web/remote/agent/src/remote-agent.ts` — Headless agent reference

---

*Co-authored-by: kimiflare <kimiflare@proton.me>*
