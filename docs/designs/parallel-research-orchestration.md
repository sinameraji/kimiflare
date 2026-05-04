# Design Document: Parallel Research Orchestration

**Status:** Problem definition & design constraints  
**Date:** 2026-05-04  
**Related:** `docs/incident-reports/2026-05-04-parallel-research-cost-spike.md`

---

## 1. Executive Summary

The "parallel research agents" feature was introduced to speed up deep codebase investigation by spawning multiple sub-agents that explore different files simultaneously. On 2026-05-04, it caused ~$70 in unexpected API spend across two sessions due to a combination of bugs (usage double-counting, broken file discovery, missing guardrails).

We have since disabled multi-agent spawning (hard-coded to 1 agent) and fixed the immediate bugs. However, the fundamental tension remains:

> **A single sequential research agent is too slow for large tasks. Multiple uncoordinated research agents are too expensive and wasteful. We need orchestration.**

This document defines the problem, the design constraints, and the attributes of an ideal solution. It does not prescribe the solution — that is the work of a future design session.

---

## 2. Problem Statement

### 2.1 The User Experience Problem

When a user asks a broad, deep question (e.g. "investigate how authentication works across the entire codebase"), the normal agent loop (`runAgentTurn`) handles it sequentially:

1. LLM decides to read a file
2. Tool executes
3. LLM decides next file
4. Repeat

For a codebase with 50+ relevant files, this can take 10-20 minutes. The user watches one file at a time. It feels glacial.

### 2.2 The Cost Problem

The naive parallel approach (spawn N agents, give each a random subset of files) has these failure modes:

| Failure Mode | Cause | Impact |
|-------------|-------|--------|
| **Redundant work** | Agents independently discover and read the same "important" files | 2-4× token waste |
| **Over-broad discovery** | File discovery heuristic matches 100 files when only 10 are relevant | Agents read irrelevant files |
| **Synthesis bloat** | Sub-agent summaries are unbounded in length; synthesis prompt becomes huge | Expensive final LLM call |
| **Runaway iteration** | No per-turn cost cap; agents can loop 8× each with auto-allowed tools | Unbounded spend per turn |
| **Usage misreporting** | Cached tokens not tracked; costs displayed at 6× actual | User panic, wrong decisions |

### 2.3 The Quality Problem

Even if cost were free, uncoordinated parallel agents produce worse output:

- **No cross-agent context:** Agent A discovers that `auth.ts` calls `crypto.ts`, but Agent B (reading `crypto.ts`) doesn't know what Agent A found. The synthesis step has to reconcile disconnected observations.
- **No prioritization:** All files are treated equally. A 5-line utility file gets the same attention as the core auth module.
- **No convergence check:** Agents don't know when to stop. They exhaust their iteration budget even if they've already found the answer.

---

## 3. What Happened (The Incident)

On 2026-05-04, two sessions exhibited massive token usage:

| Session | Prompt Tokens | Displayed Cost | Actual Cached | Root Cause |
|---------|--------------|----------------|---------------|------------|
| 11:44 UTC | ~22.4M | $21.74 | ~20M (not tracked) | Usage double-counting + cached tokens priced at uncached rate |
| 11:59 UTC | ~48.4M | $48.48 | Unknown | Same bugs, possibly triggered multiple parallel research turns |

**Immediate bugs found:**

1. **SSE usage accumulation:** Cloudflare emits `usage` on every SSE chunk. The code accumulated them instead of taking the final value.
2. **Broken file discovery:** The first 3 whitespace-split words were used as a grep regex (e.g. `investigate|a|massive`), matching nearly every file.
3. **Empty summaries at iteration limit:** Sub-agents that hit the 8-iteration limit with pending tool_calls returned empty summaries, poisoning the synthesis step.
4. **Usage-display race:** `recordUsage` and `getCostReport` were fire-and-forget, causing stale UI state.
5. **Missing cached token tracking:** `prompt_tokens_details` was dropped in research agents, inflating cost display by ~6×.
6. **No telemetry:** Parallel research turns were invisible in `cost-debug.jsonl`.

**Immediate fixes applied:**
- Overwrite (don't accumulate) SSE usage
- Add fallback summary when sub-agent hits iteration limit
- Preserve `prompt_tokens_details` for accurate cost tracking
- Await `recordUsage` before `getCostReport`
- Add `logParallelResearchDebug` for telemetry
- **Disable multi-agent spawning** (hard-coded `maxSubAgents = 1`)

---

## 4. Why Parallelism Exists (The Original Motivation)

The feature was introduced in PR #253 (commit `4ab70a2`) as "Phase Five — Parallel Research Agents." The motivation was:

> "For heavy exploration tasks, a single sequential agent is too slow. By partitioning files across multiple sub-agents and synthesizing their findings, we can give the user a comprehensive answer in a fraction of the time."

The trigger was:
```typescript
const useParallelResearch =
  (classification.intent === "explore" && classification.tier === "heavy") ||
  /\bparallel research\b/i.test(trimmed);
```

The intended flow:
1. **Discover files** relevant to the query
2. **Partition files** into N groups
3. **Spawn N sub-agents** in parallel, each exploring its group
4. **Synthesize** all sub-agent summaries into a final answer

The design assumed:
- File discovery would be precise
- File partitioning would distribute work evenly
- Sub-agents would stay within their assigned files
- Synthesis would be cheap relative to exploration

All four assumptions were wrong.

---

## 5. Why Orchestration is Needed

The current code (even with 1 agent) is a **degraded mode**. It preserves the architecture but loses the benefit (speed). We need a middle ground between:

- **Sequential (too slow):** One agent, one file at a time
- **Naive parallel (too expensive):** N agents, no coordination
- **Orchestrated parallel (the goal):** Smart scout, targeted assignment, deduplication, convergence

### 5.1 What Orchestration Means Here

Not generic multi-agent orchestration. Specifically:

1. **Scout phase:** A lightweight agent (or the main agent itself) quickly identifies what needs investigation — files, directories, concepts, external links — and produces a **research todo list**.
2. **Assignment phase:** Decide which todo items can be parallelized, which must be sequential, and which are redundant.
3. **Execution phase:** Spawn agents only for parallelizable items, with clear boundaries and no overlap.
4. **Convergence phase:** Check if the answer is "good enough" before spending more tokens.

### 5.2 Why This is Hard

- **Scout cost:** The scout phase itself costs tokens. If it's too thorough, it negates the savings. If it's too shallow, the assignment is wrong.
- **Dynamic discovery:** Sometimes you need to read file A to know file B exists. The todo list can't always be built upfront.
- **LLM reliability:** Getting an LLM to produce a structured, actionable todo list with correct file paths is non-trivial.
- **Overlap detection:** Two todo items might refer to the same file via different paths or descriptions.
- **Convergence criteria:** How do you know when you have "enough" information? The LLM doesn't know what it doesn't know.

---

## 6. Design Constraints

Any solution must satisfy these constraints. They are non-negotiable.

### 6.1 Cost Safety

- **C1.1:** A single research turn must have a hard cost ceiling (e.g. $2.00 or 2M input tokens). Exceeding it triggers graceful degradation, not silent spend.
- **C1.2:** The system must track cached tokens correctly and price them at the cached rate.
- **C1.3:** Redundant work must be minimized. Reading the same file twice in the same turn should be extremely rare.
- **C1.4:** The user must be able to see the estimated cost before a heavy research turn begins, or at least be notified that a research mode is activating.

### 6.2 Speed

- **C2.1:** For tasks with >10 relevant files, the solution must be meaningfully faster than sequential exploration (target: 2-3× speedup).
- **C2.2:** The scout phase must not itself take longer than ~20% of the total research time.

### 6.3 Quality

- **C3.1:** The final answer must be at least as good as what a single sequential agent would produce. Parallelism must not reduce answer quality.
- **C3.2:** Cross-file relationships must be preserved. If file A calls file B, the research agent(s) must understand that relationship.
- **C3.3:** The system must handle "I don't know" gracefully. If the answer can't be found in the codebase, it should say so rather than hallucinate.

### 6.4 Transparency

- **C4.1:** Every research turn must be logged to `cost-debug.jsonl` with: number of agents spawned, files explored, todo list, duration, and final usage.
- **C4.2:** The user must see progress (e.g. "Scouting...", "Agent 1/3 exploring src/auth/...", "Synthesizing...").
- **C4.3:** If research is aborted (user Ctrl-C, budget hit), partial findings must be preserved and surfaced.

### 6.5 Simplicity

- **C5.1:** The solution must not duplicate the full `runAgentTurn` logic. Reuse existing guardrails (budget, anti-loop, cost-debug) where possible.
- **C5.2:** The orchestrator must be testable. We must be able to write integration tests that assert on cost bounds and output quality.

---

## 7. Attributes of the Ideal Solution

These are aspirational, not constraints. The ideal solution would have:

| Attribute | Description |
|-----------|-------------|
| **Adaptive parallelism** | Spawns 1-4 agents based on task size, not always 4 |
| **Semantic partitioning** | Groups files by topic/directory, not round-robin |
| **File locking** | Once an agent reads a file, others skip it |
| **Scout-then-assign** | Builds a todo list before spawning agents |
| **Dynamic replanning** | Can add new todo items mid-research based on findings |
| **Summary compression** | Sub-agent summaries are compressed/truncated before synthesis |
| **Convergence detection** | Stops early if all todo items are satisfactorily answered |
| **Fallback to sequential** | If parallelism fails or is too expensive, falls back to 1 agent |
| **User override** | User can force or forbid parallel research for a given turn |

---

## 8. Current State (After Hotfixes)

As of 2026-05-04, the code on branch `fix/parallel-research-cost-bugs` has:

- `maxSubAgents = 1` (hard-coded in `runParallelResearch`)
- Usage double-counting fixed
- Cached token tracking fixed
- Empty summary fallback added
- Cost-debug logging for parallel research added
- `recordUsage`/`getCostReport` race fixed

**What this means:** Parallel research still triggers for heavy exploration tasks, but it runs as a single agent with a research-specific system prompt and auto-allowed tools. It's essentially a "research mode" wrapper around the same sequential logic.

**What this does NOT mean:** The problem is solved. The feature is in degraded mode. We have not addressed speed, overlap, or intelligent assignment.

---

## 9. Open Questions

These are the hard questions that the solution design must answer:

1. **Scout format:** What is the schema of the research todo list? Is it a flat list of files? A tree of topics? Does it include questions to answer, not just files to read?

2. **Scout agent vs. main agent:** Does the main agent itself do the scouting (adding 1-2 turns of latency), or is there a dedicated lightweight scout prompt?

3. **Parallelism threshold:** At what point does parallelism become worth it? 5 files? 10 files? Does it depend on file size?

4. **Cross-agent communication:** Should agents share a scratchpad? Can Agent B see Agent A's findings in real time, or only at synthesis time?

5. **Synthesis cost:** If 4 agents each produce a 2K-token summary, the synthesis prompt is 8K tokens + system prompt + query. How do we keep synthesis affordable?

6. **Testing strategy:** How do we integration-test this without burning real API dollars on every test run? Do we mock the LLM, or use a small local model?

7. **User control:** Should the user be asked "This looks like a heavy research task. Spawn 3 agents? (y/n)" or should it be fully automatic?

8. **Resume safety:** If a session resumes mid-research, how do we avoid re-running expensive research that was already done?

---

## 10. Next Steps

1. **Review this document** in a fresh session (to avoid context bloat).
2. **Design the scout phase:** Define the todo list schema, the scout prompt, and the decision logic for "should I parallelize?"
3. **Prototype on a branch:** Implement the scout → assign → execute → converge flow with 1-2 agents max.
4. **Integration test:** Write a test that asserts a research task on a known codebase stays under a token/cost bound.
5. **Gradual rollout:** Re-enable multi-agent spawning behind a feature flag or user confirmation.

---

## 11. Related Code

| File | Relevance |
|------|-----------|
| `src/agent/research.ts` | Parallel research implementation (currently 1-agent mode) |
| `src/agent/loop.ts` | Main agent loop with budget, anti-loop, cost-debug |
| `src/app.tsx` | Trigger logic for parallel research |
| `src/cost-debug.ts` | Telemetry logging |
| `src/tools/tasks.ts` | `tasks_set` tool for user-visible todo lists |
| `docs/incident-reports/2026-05-04-parallel-research-cost-spike.md` | Detailed incident analysis |
