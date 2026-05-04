# Budgeted Research Transaction: Engineering Plan

> **Status:** Engineering plan — ready for implementation  
> **Date:** 2026-05-04  
> **Related:**
> - `docs/designs/parallel-research-orchestration.md` (problem definition & constraints)
> - `docs/incident-reports/2026-05-04-parallel-research-cost-spike.md` (root cause analysis)
> - `docs/plans/adaptive-agent-routing.md` (Phase 5: research routing)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Context & Motivation](#2-context--motivation)
3. [Design Principles](#3-design-principles)
4. [Architecture Overview](#4-architecture-overview)
5. [Component Specifications](#5-component-specifications)
6. [Data Models](#6-data-models)
7. [Budget Model](#7-budget-model)
8. [Lifecycle](#8-lifecycle)
9. [Implementation Phases](#9-implementation-phases)
10. [In Scope / Out of Scope](#10-in-scope--out-of-scope)
11. [Definition of Success](#11-definition-of-success)
12. [Testing Strategy](#12-testing-strategy)
13. [Risk Analysis & Mitigations](#13-risk-analysis--mitigations)
14. [Migration from Old Code](#14-migration-from-old-code)
15. [Telemetry & Observability](#15-telemetry--observability)
16. [Rollout Plan](#16-rollout-plan)
17. [Appendices](#17-appendices)

---

## 1. Executive Summary

We are replacing the naive "parallel research agents" feature with a **budgeted research transaction system**. The old system (discover → partition → spawn N agents → synthesize) caused a $70 cost incident due to unbounded spend, redundant work, and missing guardrails.

The new system treats each heavy research request as a **deterministic, budgeted, checkpointed transaction** controlled by code (not an autonomous agent). LLMs are used only as bounded evidence-gathering subprocesses.

> **Core thesis:** Do not build parallel agents. Build a budgeted research transaction where parallelism is an implementation detail inside a controlled, observable, abortable process.

---

## 2. Context & Motivation

### 2.1 The Incident

On 2026-05-04, two sessions burned ~$70 in API costs due to:
- SSE usage double-counting
- Broken file discovery (regex matching nearly every file)
- Missing cached token tracking (6× cost inflation)
- No per-turn cost ceiling
- No deduplication (agents reading the same files)
- Empty summaries poisoning synthesis

We hard-coded `maxSubAgents = 1` as a hotfix. This degraded the feature to "research mode with a single sequential agent" — safe but slow.

### 2.2 The Tension

| Approach | Speed | Cost | Quality |
|----------|-------|------|---------|
| Sequential agent | Too slow (10-20 min for 50 files) | Predictable | High |
| Naive parallel (old) | Fast | Unbounded, wasteful | Low (no cross-context) |
| **Budgeted transaction (new)** | **Target: 2-3× sequential** | **Hard ceiling** | **≥ sequential** |

### 2.3 Why Not Patch the Old Code?

The old architecture (`discoverFiles` → `partitionFiles` → `runResearchAgent` × N → `synthesize`) has fundamental structural flaws:
- No scout phase: files are discovered greedily, not strategically
- No task model: agents get file lists, not questions to answer
- No deduplication: round-robin partitioning ignores semantic overlap
- No convergence: agents run to iteration limit regardless of findings
- No budget enforcement: cost accumulates silently until synthesis
- No observability: internal state is invisible

Patching these would require adding so many guardrails that the architecture collapses under its own weight. A clean redesign is cheaper and safer.

---

## 3. Design Principles

### P1. Deterministic Orchestrator
The orchestrator is **code**, not an LLM. It decides: budget allocation, worker count, task assignment, file leases, replanning, convergence, and synthesis trigger. LLMs are only used for scouting, worker research, summarizing, and judging unresolved questions.

### P2. Append-Only Ledger
All state lives in a durable, typed, append-only ledger file. Workers never mutate it directly. They call structured tools (`record_finding`, `propose_followup_task`, etc.) and the orchestrator validates and appends.

### P3. Question-First Tasks
Tasks are defined as **questions to answer**, not files to read. Example: "How does the auth middleware validate JWT signatures?" with scope hints (`suggestedFiles`, `includePaths`), not "Read these 12 files."

### P4. File Leases
Once a worker reads a file, it holds a lease. Other workers skip it. Leases expire after a bounded number of tool calls to prevent starvation.

### P5. Budget as Circuit Breaker
Budget is a **hard ceiling**, not a spend target. Exceeding any partition triggers graceful degradation (skip non-critical tasks, trigger emergency conclusion).

### P6. Mandatory Terminal States
Every transaction must end in one of six defined terminal states (A-F). "No conclusion" is not allowed. Partial findings are always surfaced.

### P7. Observability by Design
Every wave, checkpoint, finding, and convergence decision is logged. The ledger is archived per turn for post-hoc analysis.

### P8. Incremental Rollout
Start with N=1 (safe transaction, no parallelism). Add N=2 only after telemetry proves safety. Never default to N=4.

---

## 4. Architecture Overview

```
User prompt
  ↓
Triage (existing: classifyIntent)
  ↓
Research Transaction Controller (NEW)
  ├── Budget Enforcer
  ├── Ledger Manager
  ├── Scout Dispatcher
  ├── Worker Pool (1-2 bounded workers)
  ├── Convergence Engine
  └── Synthesis Dispatcher
  ↓
Final answer + coverage report
```

### 4.1 Component Interaction

```
┌─────────────────────────────────────────────────────────────┐
│              Research Transaction Controller                 │
│  (deterministic, code-only, no LLM reasoning)               │
├─────────────────────────────────────────────────────────────┤
│  Budget Enforcer  │  Ledger Manager  │  Convergence Engine  │
├─────────────────────────────────────────────────────────────┤
│  Scout (LLM) ──▶ research_plan.json ◀── Worker (LLM)       │
│                      (append-only)                          │
├─────────────────────────────────────────────────────────────┤
│  Synthesis (LLM) ◀── findings + open questions              │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Component Specifications

### 5.1 Research Transaction Controller

**Responsibility:** Owns the transaction lifecycle. Never calls an LLM directly.

**Interface:**
```typescript
export async function runResearchTransaction(
  opts: ResearchTransactionOpts
): Promise<ResearchResult>;
```

**Behavior:**
1. Initialize budget partitions
2. Dispatch scout (Wave 0)
3. Initialize ledger from scout output
4. Loop: dispatch workers → checkpoint → evaluate convergence
5. Trigger synthesis or emergency conclusion
6. Return final answer with coverage report

**Error Handling:**
- Budget exceeded → emergency conclusion with partial findings
- Scout fails → fallback to sequential `runAgentTurn`
- Worker crashes → mark task failed, redistribute if budget allows
- Signal aborted → checkpoint, synthesize partial if possible

### 5.2 Budget Enforcer

**Responsibility:** Track spend across partitions. Trigger circuit breaker when any partition is exhausted.

**Partitions:**
| Partition | Share | Purpose |
|-----------|-------|---------|
| Scout | 10% | File discovery, task planning |
| Exploration | 65% | Worker execution, file reading |
| Synthesis | 15% | Final answer generation |
| Emergency | 10% | Reserved for partial conclusion when main budgets hit |

**Circuit Breaker Rules:**
- If scout exceeds 10% → abort scout, fall back to sequential
- If exploration exceeds 65% → stop accepting new tasks, trigger convergence
- If synthesis exceeds 15% → truncate findings, generate abbreviated answer
- If total exceeds 100% → emergency conclusion with "budget exhausted" caveat

### 5.3 Ledger Manager

**Responsibility:** Read/write the append-only ledger. Validate worker mutations.

**Location:** `~/.kimiflare/research/<turn_id>/research_plan.json`

**Validation Rules:**
- Workers can only append findings for tasks they own
- `propose_followup_task` creates a pending task; orchestrator approves/rejects based on budget
- `request_file` checks lease table; if leased, returns "skip" directive
- `mark_unknown` is always allowed (signals "I can't answer this")

### 5.4 Scout

**Responsibility:** Cheap, bounded discovery. Produces the initial task list.

**Input:** User query, repo fingerprint, budget cap (10% of total)

**Output:** `ScoutResult` — see §6.4

**Constraints:**
- Max 3 tool calls (glob, grep, read heads)
- Max 1 LLM call for task generation
- Must produce falsification questions ("What would prove this wrong?")
- Must recommend worker count (1-2)

### 5.5 Worker

**Responsibility:** Answer a single research task. Read-only. Budgeted.

**Input:** Task object, ledger snapshot, available tools

**Constraints:**
- Max tool calls: `task.budget.maxToolCalls`
- Max files read: `task.budget.maxFilesRead`
- Max tokens: `task.budget.maxTokens`
- Cannot mutate ledger directly (uses tool calls)
- Must produce at least one finding or mark_unknown

**Tools Available:**
- `read`, `glob`, `grep` (same as old research tools)
- `record_finding` (appends to ledger)
- `propose_followup_task` (suggests new task)
- `request_file` (checks lease before reading)
- `mark_unknown` (signals inability to answer)

### 5.6 Convergence Engine

**Responsibility:** Decide whether to stop, continue, or replan.

**Deterministic Metrics (weighted score):**
- Budget remaining > 20%? (+1)
- Unresolved critical questions = 0? (+2)
- Useful findings delta in last wave = 0? (+1)
- Duplicate read rate < 10%? (+1)
- Coverage checklist ≥ 80%? (+2)

**Thresholds:**
- Score ≥ 5: Converged → trigger synthesis
- Score 3-4: Partial convergence → one more wave
- Score < 3: Not converged → replan or continue

**Optional:** LLM judge advisory (not binding) for edge cases.

### 5.7 Synthesis Dispatcher

**Responsibility:** Generate the final answer from findings.

**Input:** All findings, open questions, coverage checklist, task statuses

**Output:** Must include:
1. Direct answer to original query
2. Evidence summary (file paths, line ranges)
3. Confidence level (high/medium/low)
4. What was checked
5. What remains unknown
6. Suggested next action

**Constraints:**
- Budget: 15% of total (circuit breaker truncates if exceeded)
- Must cite findings by ID
- Must not hallucinate files not in findings

---

## 6. Data Models

### 6.1 ResearchPlan (Root Ledger)

```typescript
type ResearchPlan = {
  version: 1;
  turnId: string;
  query: string;
  repoFingerprint: string; // git sha or file hash
  status:
    | "scouting"
    | "executing"
    | "synthesizing"
    | "done"
    | "aborted";

  budget: ResearchBudget;
  phases: PhaseUsage[]; // actual spend per phase

  tasks: ResearchTask[];
  findings: Finding[];
  fileLeases: FileLease[];
  openQuestions: OpenQuestion[];

  convergence: ConvergenceState;
  checkpoints: CheckpointRef[];

  notes: OrchestratorNote[];
};
```

### 6.2 ResearchTask

```typescript
type ResearchTask = {
  id: string; // uuid
  question: string; // primary question to answer
  description: string; // context for the worker

  priority: 1 | 2 | 3 | 4 | 5; // 1 = critical, 5 = nice-to-have

  scope: {
    includePaths?: string[]; // glob patterns
    excludePaths?: string[];
    suggestedFiles?: string[]; // hints, not mandates
    maxFiles?: number;
  };

  dependencyIds: string[]; // must complete before this task

  status:
    | "pending"
    | "in_progress"
    | "done"
    | "killed"
    | "failed";

  ownerWorkerId?: string;

  budget: {
    maxTokens: number;
    maxToolCalls: number;
    maxFilesRead: number;
    consumedTokens: number;
    consumedToolCalls: number;
    consumedFilesRead: number;
  };

  killReason?: string;
};
```

### 6.3 Finding

```typescript
type Finding = {
  id: string;
  taskId: string;
  workerId: string;

  claim: string; // concise factual statement
  evidence: {
    filePath: string;
    lineRange?: [number, number];
    excerpt?: string; // ≤ 200 chars
  }[];

  confidence: "high" | "medium" | "low";

  implications?: string[]; // "this means X for the auth flow"
  unresolvedFollowups?: string[]; // "need to check how Y handles Z"

  createdAt: string; // ISO timestamp
};
```

### 6.4 ScoutResult

```typescript
type ScoutResult = {
  estimatedRelevantFiles: number;
  likelyAreas: string[]; // e.g., ["src/auth/", "src/middleware/"]
  proposedTasks: ResearchTask[];
  dependencyHints: { taskId: string; dependsOn: string[] }[];
  falsificationQuestions: string[]; // "What would prove this wrong?"
  recommendedWorkerCount: 1 | 2;
};
```

### 6.5 FileLease

```typescript
type FileLease = {
  filePath: string;
  workerId: string;
  taskId: string;
  purpose: string; // why this file is being read
  status: "active" | "released" | "expired";
  expiresAfterToolCalls: number; // countdown
};
```

### 6.6 ConvergenceState

```typescript
type ConvergenceState = {
  score: number; // 0-6
  metrics: {
    budgetRemainingPct: number;
    unresolvedCriticalQuestions: number;
    findingsDeltaLastWave: number;
    duplicateReadRate: number;
    coverageChecklistPct: number;
  };
  llmJudgeAdvisory?: string; // optional, non-binding
  decision: "converged" | "partial" | "continue" | "replan";
};
```

### 6.7 ResearchBudget

```typescript
type ResearchBudget = {
  maxCostUsd: number;      // default: 2.0
  maxInputTokens: number;  // default: 2_000_000
  maxOutputTokens: number; // default: 80_000
  maxWallTimeMs: number;   // default: 8 * 60_000
  maxFilesRead: number;    // default: 80
  maxWaves: number;        // default: 3
  maxWorkersPerWave: number; // default: 1 (v1), 2 (v1.1)

  partitions: {
    scout: number;      // 0.10
    exploration: number; // 0.65
    synthesis: number;   // 0.15
    emergency: number;   // 0.10
  };
};
```

---

## 7. Budget Model

### 7.1 Default Budget

```typescript
const DEFAULT_BUDGET: ResearchBudget = {
  maxCostUsd: 2.0,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 80_000,
  maxWallTimeMs: 8 * 60_000,
  maxFilesRead: 80,
  maxWaves: 3,
  maxWorkersPerWave: 1, // v1
  partitions: {
    scout: 0.10,
    exploration: 0.65,
    synthesis: 0.15,
    emergency: 0.10,
  },
};
```

### 7.2 Circuit Breaker Behavior

| Trigger | Action |
|---------|--------|
| Scout exceeds 10% | Abort scout, fallback to sequential `runAgentTurn` |
| Exploration exceeds 65% | Stop new tasks, trigger convergence |
| Synthesis exceeds 15% | Truncate findings, abbreviated answer |
| Total exceeds 100% | Emergency conclusion: "Budget exhausted. Partial findings below." |
| Wall time exceeds 8 min | Same as total exceedance |

### 7.3 Per-Task Budget Allocation

Exploration budget is divided among active tasks proportionally by priority:

```typescript
function allocateTaskBudget(
  explorationBudget: number,
  tasks: ResearchTask[]
): Map<string, number> {
  const totalPriority = tasks.reduce((s, t) => s + (6 - t.priority), 0);
  return new Map(tasks.map((t) => [
    t.id,
    Math.floor((explorationBudget * (6 - t.priority)) / totalPriority),
  ]));
}
```

---

## 8. Lifecycle

### Phase 0 — Triage (Existing)

`classifyIntent()` determines if this is a heavy exploration task. If `intent === "explore" && tier === "heavy"`, route to research transaction.

### Phase 1 — Scout (Wave 0)

1. Controller allocates 10% budget to scout
2. Scout runs cheap discovery (glob, grep, read heads)
3. Scout produces `ScoutResult` with proposed tasks
4. Controller initializes ledger

### Phase 2 — Ledger Initialization

1. Write `research_plan.json` with status `"scouting"`
2. Populate `tasks` from `ScoutResult`
3. Initialize `fileLeases` empty
4. Set status to `"executing"`

### Phase 3 — Worker Waves

1. Controller selects pending tasks with no unresolved dependencies
2. Assigns tasks to workers (max `maxWorkersPerWave`)
3. Workers execute with bounded tools
4. Workers append findings via tool calls
5. Controller updates ledger after each tool call

### Phase 4 — Checkpoint

After every wave:
1. Archive ledger to `research_plan.json`
2. Record phase usage
3. Update file lease expirations

### Phase 5 — Dynamic Replanning

Workers may `propose_followup_task`. Controller:
1. Checks if budget allows new task
2. Checks for duplicates (same question or overlapping scope)
3. Approves → adds to ledger as pending
4. Rejects → records reason in `notes`

### Phase 6 — Convergence Evaluation

Controller computes convergence score. Decision:
- `"converged"` → Phase 7
- `"partial"` → one more wave (if budget allows)
- `"continue"` → next wave
- `"replan"` → kill stale tasks, create new ones from open questions

### Phase 7 — Synthesis

1. Allocate 15% budget
2. Dispatch synthesis with all findings, open questions, coverage
3. Generate final answer with mandatory sections

### Phase 8 — Terminal State

Set status to `"done"`. Archive ledger gzipped. Return result.

---

## 9. Implementation Phases

### Phase A: Foundation (Week 1)

**Goal:** Types, ledger API, and budget enforcer. No LLM calls yet.

**Deliverables:**
- [ ] `src/research/types.ts` — all schemas from §6
- [ ] `src/research/ledger.ts` — append-only API (read, validate, append, checkpoint)
- [ ] `src/research/budget.ts` — budget enforcer with circuit breaker logic
- [ ] Unit tests for ledger and budget

**Success Criteria:**
- All types compile
- Ledger append is atomic and idempotent
- Budget enforcer correctly triggers circuit breaker at thresholds

### Phase B: Scout + Single Worker (Week 1-2)

**Goal:** End-to-end flow with N=1.

**Deliverables:**
- [ ] `src/research/scout.ts` — bounded scout implementation
- [ ] `src/research/worker.ts` — single worker with tool constraints
- [ ] `src/research/controller.ts` — transaction controller (Phases 1-8)
- [ ] `src/research/convergence.ts` — deterministic convergence engine
- [ ] `src/research/synthesis.ts` — synthesis dispatcher
- [ ] Integration test with mocked LLM

**Success Criteria:**
- A test query produces a research plan, findings, and synthesis
- Budget is enforced (test with artificially low budget)
- Ledger is archived and readable

### Phase C: Integration (Week 2)

**Goal:** Wire into `src/app.tsx` and retire old code.

**Deliverables:**
- [ ] Replace `runParallelResearch` call in `src/app.tsx` with `runResearchTransaction`
- [ ] Delete `src/agent/research.ts` and `src/agent/research.test.ts`
- [ ] Update `src/cost-debug.ts` to log research transaction telemetry
- [ ] Add user-facing progress messages ("Scouting...", "Synthesizing...")

**Success Criteria:**
- Heavy exploration queries trigger research transaction
- UI shows progress
- Cost-debug logs include research transaction data
- Old research code is removed

### Phase D: Telemetry + Hardening (Week 2-3)

**Goal:** Observability and edge case handling.

**Deliverables:**
- [ ] `src/research/telemetry.ts` — structured logging for research turns
- [ ] Abort/resume: Ctrl-C checkpoints, resume loads latest checkpoint
- [ ] Fallback: if research transaction fails, fall back to `runAgentTurn`
- [ ] Duplicate read detection and reporting

**Success Criteria:**
- Every research turn is logged with full metrics
- Ctrl-C preserves partial findings
- Fallback works seamlessly

### Phase E: N=2 Parallelism (Week 4+)

**Goal:** Add bounded parallelism behind explicit opt-in.

**Deliverables:**
- [ ] Worker pool with 2 workers
- [ ] File lease coordination
- [ ] Cross-worker deduplication
- [ ] Feature flag or explicit command (`/research --parallel`)

**Success Criteria:**
- N=2 is measurably faster than N=1 on fixture repos
- Duplicate read rate < 10%
- No cost regression vs N=1

---

## 10. In Scope / Out of Scope

### In Scope

- [x] Deterministic transaction controller
- [x] Append-only typed ledger
- [x] Budget enforcer with circuit breaker
- [x] Bounded scout phase
- [x] Single-worker execution (N=1)
- [x] Convergence engine (deterministic + optional LLM advisory)
- [x] Mandatory synthesis with 6-section output
- [x] File lease system for deduplication
- [x] Dynamic replanning (worker-proposed followups)
- [x] Telemetry and cost-debug integration
- [x] Abort/resume with checkpointing
- [x] Fallback to sequential `runAgentTurn`
- [x] N=2 parallelism (Phase E)

### Out of Scope (Explicitly Not Building)

- [ ] 4-agent default (never)
- [ ] Peer-to-peer worker messaging
- [ ] Async background mode (research continues after user sees answer)
- [ ] General-purpose LangGraph clone
- [ ] Autonomous implementation agents (agents that write code, not just research)
- [ ] Semantic file partitioning (v1 uses scope hints from scout)
- [ ] Real-time cross-worker context sharing (v1 workers are isolated)
- [ ] LLM-as-orchestrator (orchestrator is always code)
- [ ] User-editable research plans (orchestrator owns the plan)

---

## 11. Definition of Success

### 11.1 Cost Safety

| Metric | Target | Measurement |
|--------|--------|-------------|
| Max cost per research turn | ≤ $2.00 | Cost-debug logs |
| Cached token tracking accuracy | 100% | Compare to API invoice |
| Duplicate reads per turn | ≤ 10% | Ledger analysis |
| Budget circuit breaker triggers | 0 false negatives | Test with low budgets |

### 11.2 Speed

| Metric | Target | Measurement |
|--------|--------|-------------|
| Wall time vs sequential (N=1) | ≤ 120% (acceptable overhead) | Fixture repo tests |
| Wall time vs sequential (N=2) | ≤ 70% (30% faster) | Fixture repo tests |
| Scout phase overhead | ≤ 20% of total time | Telemetry |

### 11.3 Quality

| Metric | Target | Measurement |
|--------|--------|-------------|
| Coverage vs sequential baseline | ≥ 90% | Manual evaluation on 5 fixture tasks |
| Answer confidence accuracy | ≥ 80% (high confidence = actually correct) | Manual evaluation |
| Hallucination rate | 0% (no files cited that weren't read) | Automated ledger check |

### 11.4 Reliability

| Metric | Target | Measurement |
|--------|--------|-------------|
| Research transaction success rate | ≥ 95% | Telemetry |
| Fallback to sequential works | 100% | Test failure injection |
| Partial findings preserved on abort | 100% | Test Ctrl-C simulation |

---

## 12. Testing Strategy

### 12.1 Unit Tests

**Target:** 80% coverage on controller, ledger, budget, convergence.

**Key Tests:**
- Budget enforcer triggers at exact thresholds
- Ledger append is atomic under concurrent writes
- Convergence score computation matches spec
- File lease expiration works correctly
- Task budget allocation is proportional to priority

### 12.2 Mocked Integration Tests

**Target:** Full transaction flow without real API calls.

**Approach:**
- Mock `runKimi` to return deterministic responses
- Fixture repos with known structure
- Assert on: ledger state, task count, finding count, budget usage, terminal state

**Fixture Scenarios:**
1. Simple: 5-file auth system, 1 task, converges in 1 wave
2. Medium: 20-file codebase, 2 tasks, needs 2 waves
3. Complex: 50-file codebase, scout proposes 4 tasks, budget limits to 2
4. Failure: Scout returns empty, falls back to sequential
5. Abort: User Ctrl-C mid-wave, partial findings preserved

### 12.3 Live Smoke Tests

**Target:** Validate on real API with small budgets.

**Approach:**
- Run 3-5 real queries on kimiflare repo itself
- Budget capped at $0.50
- Manual review of output quality

### 12.4 Regression Tests

**Target:** Ensure no degradation to non-research paths.

**Approach:**
- Light/medium queries still route to `runAgentTurn`
- Cost-debug schema is backward-compatible
- Session storage format unchanged

---

## 13. Risk Analysis & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Scout is too expensive | Medium | High | Hard limit 3 tool calls + 1 LLM call; if exceeded, fallback to sequential |
| LLM produces bad task list | Medium | Medium | Tasks are question-first with scope hints, not file mandates; worker can propose followups |
| Synthesis exceeds budget | Low | High | Circuit breaker truncates findings; emergency conclusion always possible |
| File leases cause starvation | Low | Medium | Leases expire after bounded tool calls; orchestrator can force-release |
| N=2 parallelism doesn't speed up | Medium | Medium | Telemetry measures this; if false, N=2 rollout is blocked |
| Code complexity exceeds benefit | Medium | High | Start with N=1; if transaction overhead is too high, keep sequential fallback |
| User confusion about research mode | Medium | Low | Progress messages explain what's happening; budget ceiling shown upfront |
| Resume safety bugs | Low | High | Repo fingerprint check; if changed, restart scout |

---

## 14. Migration from Old Code

### 14.1 Files to Delete

- `src/agent/research.ts` — old parallel research implementation
- `src/agent/research.test.ts` — old tests (no longer applicable)

### 14.2 Files to Modify

- `src/app.tsx` — replace `runParallelResearch` call with `runResearchTransaction`
- `src/cost-debug.ts` — update `logParallelResearchDebug` or replace with research transaction telemetry

### 14.3 Files to Create

- `src/research/types.ts`
- `src/research/ledger.ts`
- `src/research/budget.ts`
- `src/research/scout.ts`
- `src/research/worker.ts`
- `src/research/controller.ts`
- `src/research/convergence.ts`
- `src/research/synthesis.ts`
- `src/research/telemetry.ts`
- `src/research/index.ts` (public API)

### 14.4 Migration Steps

1. **Phase A+B:** Create new files alongside old code. Old code remains active.
2. **Phase C:** Switch `src/app.tsx` to call new code. Delete old files.
3. **Phase D:** Harden new code. No rollback needed — fallback to `runAgentTurn` is built in.

---

## 15. Telemetry & Observability

### 15.1 Per-Turn Log Entry

```typescript
interface ResearchTelemetry {
  turnId: string;
  sessionId: string;
  query: string;
  timestamp: string;

  // Execution
  numWaves: number;
  numWorkersSpawned: number;
  numTasksCreated: number;
  numTasksCompleted: number;
  numTasksKilled: number;

  // Findings
  numFindings: number;
  findingsByConfidence: { high: number; medium: number; low: number };

  // Files
  filesScanned: string[];
  filesRead: string[];
  duplicateReads: string[];
  duplicateReadRate: number;

  // Budget
  budgetConfig: ResearchBudget;
  phaseUsage: PhaseUsage[];
  totalCostUsd: number;
  circuitBreakerTriggered?: string;

  // Convergence
  convergenceScore: number;
  convergenceDecision: string;
  terminalState: string;

  // Performance
  durationMs: number;
  scoutDurationMs: number;
  synthesisDurationMs: number;

  // Ledger
  ledgerPath: string;
  ledgerSizeBytes: number;
}
```

### 15.2 Cost-Debug Integration

Extend `cost-debug.jsonl` with a `researchTransaction` field when the turn uses research mode.

### 15.3 User-Facing Progress

Show in TUI:
- `"Research mode: budget $2.00, up to 3 waves"`
- `"Scouting... (3 tasks proposed)"`
- `"Wave 1/3: exploring auth system..."`
- `"Convergence check: 2/3 tasks complete"`
- `"Synthesizing final answer..."`

---

## 16. Rollout Plan

### v1.0 — Safe Transaction (N=1)

- Research transaction controller with single worker
- Full budget enforcement and ledger
- All telemetry and progress messages
- Fallback to sequential on any failure

**Gate:** Merge when integration tests pass and 3 live smoke tests succeed.

### v1.1 — Bounded Parallelism (N=2)

- Add worker pool with 2 workers
- File lease coordination
- Explicit opt-in (`/research --parallel` or config flag)

**Gate:** Merge when N=2 shows ≥20% speedup and ≤5% cost increase vs N=1 on fixture repos.

### v2.0 — Automatic Parallelism

- Automatically use N=2 for heavy research tasks
- Adaptive worker count based on task count and budget

**Gate:** Merge when v1.1 has been stable for 2 weeks with no incidents.

---

## 17. Appendices

### Appendix A: Worker Tool Definitions

Workers have access to these tools (in addition to `read`, `glob`, `grep`):

```typescript
const WORKER_LEDGER_TOOLS = [
  {
    name: "record_finding",
    description: "Record a factual finding with evidence",
    parameters: {
      type: "object",
      properties: {
        claim: { type: "string" },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              lineRange: { type: "array", items: { type: "number" } },
              excerpt: { type: "string" },
            },
          },
        },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        implications: { type: "array", items: { type: "string" } },
        unresolvedFollowups: { type: "array", items: { type: "string" } },
      },
      required: ["claim", "evidence", "confidence"],
    },
  },
  {
    name: "propose_followup_task",
    description: "Suggest a new research task based on findings",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        description: { type: "string" },
        priority: { type: "number", minimum: 1, maximum: 5 },
        suggestedFiles: { type: "array", items: { type: "string" } },
      },
      required: ["question", "priority"],
    },
  },
  {
    name: "request_file",
    description: "Request permission to read a file (checks lease)",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        purpose: { type: "string" },
      },
      required: ["filePath", "purpose"],
    },
  },
  {
    name: "mark_unknown",
    description: "Mark this task as unanswerable with current information",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
        missingContext: { type: "string" },
      },
      required: ["reason"],
    },
  },
];
```

### Appendix B: Terminal States

| State | Code | Description | User Sees |
|-------|------|-------------|-----------|
| A. Answer found | `ANSWER_FOUND` | All critical questions answered with high confidence | Full answer |
| B. Likely answer with caveats | `LIKELY_ANSWER` | Most questions answered, some uncertainty | Answer + caveats |
| C. Answer not found | `NOT_FOUND` | Searched defined coverage, answer not in codebase | "Not found" + what was checked |
| D. Blocked | `BLOCKED` | Missing context or tool failure prevented completion | "Blocked" + what failed |
| E. Budget reached | `BUDGET_EXHAUSTED` | Hard ceiling hit before convergence | Partial answer + budget notice |
| F. User aborted | `ABORTED` | Ctrl-C or explicit cancel | Partial findings |

### Appendix C: Directory Structure

```
src/research/
├── index.ts          # Public API: runResearchTransaction
├── types.ts          # All TypeScript schemas
├── ledger.ts         # Ledger read/write/validate
├── budget.ts         # Budget enforcer
├── controller.ts     # Transaction lifecycle
├── scout.ts          # Scout phase implementation
├── worker.ts         # Single worker execution
├── worker-pool.ts    # N=2 worker coordination (v1.1)
├── convergence.ts    # Convergence engine
├── synthesis.ts      # Synthesis dispatcher
├── telemetry.ts      # Structured logging
└── __fixtures__/     # Test fixture repos
    ├── simple-auth/
    ├── medium-api/
    └── complex-monorepo/
```

### Appendix D: Related Documents

- `docs/designs/parallel-research-orchestration.md` — Problem definition and design constraints
- `docs/incident-reports/2026-05-04-parallel-research-cost-spike.md` — Root cause analysis
- `docs/plans/adaptive-agent-routing.md` — Broader routing architecture (Phase 5)
