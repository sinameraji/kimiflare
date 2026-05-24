# Research Report: Multi-Agent Architecture for Coding AI Assistants

> **Status:** Research phase — DO NOT IMPLEMENT YET  
> **Date:** 2026-05-23  
> **Context:** Kimiflare has failed 3-4 times at building parallel agent mechanisms. Current system uses a triage architecture (light/medium/heavy) with a single agent at a time. This report surveys the state of the art and extracts lessons for a future attempt.

---

## 1. Where Kimiflare Is Right Now

### Current Architecture
- **Single agent loop** (`runAgentTurn` in `src/agent/loop.ts`)
- **Turn supervisor** (`TurnSupervisor` in `src/agent/supervisor.ts`) — fire-and-forget wrapper with phase tracking and preemption
- **Triage system** — classifies user prompts as light/medium/heavy, equips different tools/skills/memory/code-mode based on intensity
- **One conversation buffer** — shared message history, artifact store, session state
- **SQL-based memory** — `MemoryManager` with embedding-based retrieval
- **50-tool-call limit per turn** — with "go on" continuation
- **Context window:** ~250K tokens

### History of Failed Attempts

#### Attempt 1: Orchestrator + Isolated Buffers (`AgentOrchestrator`)
- **What it was:** An orchestrator that auto-switched between research/coding/generalist agents based on intent classification. Each agent had its own isolated message buffer.
- **Why it failed:**
  1. Orchestrator + generalist redundancy — two routing layers fighting each other
  2. Isolated buffers broke every single-agent feature (images, compiled context, memory, cache affinity, session resume, code mode)
  3. Silent handoffs — user saw unexplained agent jumps
  4. "Go on" amnesia — pause messages went into the active agent's buffer, but handoffs meant the next agent didn't have that context
  5. Tool limit UX broken — thrown as red error, users thought something broke
  6. Mode × Agent matrix — 18 untested combinations (3 modes × 3 agents × 2 switch modes)

#### Attempt 2: Unified Agent with Personas
- **What it was:** One shared message buffer. "Persona" as a lightweight system-prompt prefix the model could switch during conversation via a `[persona:research]` marker.
- **Why it was abandoned:** Never fully implemented; the v2 redesign superseded it.

#### Attempt 3: Generalist-Owned Conversation with Ephemeral Specialists (v2 Redesign)
- **What it was:** Single generalist agent owns the conversation. Specialists (`delegate_to_researcher`, `delegate_to_coder`) are **tools** the generalist calls — they receive a task, work in an isolated sandbox, and return a result. No `hand_off`, no orchestrator, no intent classifier.
- **Status:** Architecture decision document exists (`docs/plans/multi-agent-redesign-v2.md`) but was never implemented. The user kept the triage system instead.
- **Why it wasn't built:** Unknown from documents, but likely because even this design doesn't solve the parallelization problem — it's still sequential delegation.

### Core Tension
The user correctly identified: **"speed is capped since sequential."** The triage system chooses the *intensity* of the single agent, but it's still one agent doing one thing at a time.

---

## 2. What Others Are Doing

### 2.1 Claude Code Agent Teams (Anthropic)

**Architecture:** Hierarchical team of parallel Claude Code sessions.

- **Coordinator agent** — receives the high-level task, decomposes it into subtasks
- **Worker agents** — run in parallel Claude Code sessions, each with their own context
- **Communication:** Workers report back to coordinator; coordinator synthesizes
- **Key feature:** Workers are actual separate Claude Code processes, not just prompt variations

**Relevant to Kimiflare:**
- Uses a **coordinator/worker** pattern, not peer-to-peer
- Workers are **isolated processes** — this avoids context pollution but means they don't share memory automatically
- The coordinator is the bottleneck and the synthesizer
- **Open question:** How do they handle the "go on" problem across multiple workers?

**Source:** `code.claude.com/docs/en/agent-teams`

### 2.2 OpenCode Multi-Agent Setup

**Architecture:** Primary agents + subagents.

- **Primary agents** — long-lived, own the conversation context
  - `use build` — coding agent (Claude Opus 4.5, temp 0.2, full tool access)
  - `use plan` — planning agent
  - `use general` — generalist agent
- **Subagents** — ephemeral, spawned for specific tasks, return results to primary
- **Configuration:** JSON-based agent definitions with model selection, temperature, tool sets

**Key insight from OpenCode:** They distinguish between **primary agents** (conversation owners) and **subagents** (ephemeral workers). This is similar to Kimiflare's v2 redesign idea.

**Relevant to Kimiflare:**
- OpenCode's subagents are **not parallel by default** — they're called sequentially
- The multi-agent setup is more about **specialization** than **parallelization**
- Users configure which agent handles which task type

**Sources:** `opencode.ai/docs/agents/`, `amirteymoori.com/opencode-multi-agent-setup-specialized-ai-coding-agents/`

### 2.3 GitHub Copilot CLI Specialized Agents

**Architecture:** Specialized agents + parallel execution + smarter context management.

- **Specialized agents** — domain-specific (e.g., security review, testing, documentation)
- **Parallel execution** — multiple agents can run simultaneously on different aspects of a task
- **Context management** — shared context pool with intelligent routing

**Key insight:** Copilot has moved toward **parallel specialized agents** rather than a single generalist. They can run a security review agent and a test-generation agent in parallel on the same code change.

**Relevant to Kimiflare:**
- This is the closest to what the user wants: **true parallelization**
- But Copilot has Microsoft's infrastructure — they can spin up isolated environments easily
- The "smarter context management" is the hard part: how do you give each agent the right subset of context without duplication?

**Source:** `winbuzzer.com/2026/01/16/github-copilot-cli-gains-specialized-agents-parallel-execution-and-smarter-context-management-xcxwbn/`

### 2.4 Academic Research: Multi-Agent Orchestration

**Key paper:** "The Orchestration of Multi-Agent Systems: Architectures, Protocols, and Enterprise Adoption" (arXiv:2601.13671v1)

**Architectural patterns identified:**

1. **Hierarchical Agent Architecture**
   - Central coordinator delegates to subordinates
   - Subordinates report back; coordinator synthesizes
   - **Pros:** Clear accountability, easy to debug
   - **Cons:** Coordinator bottleneck, single point of failure

2. **Task Decomposition Patterns**
   - **Functional decomposition** — by skill (coding, research, testing)
   - **Temporal decomposition** — by phase (plan → execute → verify)
   - **Spatial decomposition** — by codebase region (frontend, backend, database)

3. **Orchestration Layer Components**
   - **Planning and Policy Management** — who does what, when
   - **Execution and Control Management** — starting/stopping agents, handling failures
   - **State and Knowledge Management** — shared state, message passing, conflict resolution

**Critical insight from research:**
> "The coordination challenge is not in making agents work, but in managing the **interdependencies** between their tasks."

This maps exactly to the user's tweet: "creating a good todo list, delegating to multiple agents, evolving the todo with new information, checking in on agents... making sure there's minimal overlap among agents and ideally no todos left unassigned."

### 2.5 CrewAI / LangGraph Patterns

**CrewAI approach:**
- **Crew** — the team
- **Agents** — role-based (researcher, coder, reviewer)
- **Tasks** — discrete units of work with clear outputs
- **Process** — sequential, hierarchical, or consensual

**LangGraph approach:**
- **Graph-based state machine** — nodes are agents, edges are transitions
- **State is shared** — all agents read/write to a central state object
- **Conditional edges** — routing based on agent outputs

**Relevant to Kimiflare:**
- LangGraph's shared state is appealing but risky with LLM context windows
- CrewAI's task-centric model aligns with the user's "good todo list" intuition
- Both frameworks are Python-first and designed for backend workflows, not interactive TUI coding assistants

---

## 3. Synthesis: What Makes This Hard

Based on Kimiflare's history and the state of the art, here are the **fundamental challenges**:

### 3.1 The Context Window Problem

**The math:**
- 250K context window
- Each agent needs: system prompt (~2K) + conversation history (~10-50K) + task description (~1K) + tool results (~5-20K)
- If you run 3 agents in parallel, you need to either:
  a. **Duplicate context** — each agent gets a copy → 3× context usage, hits limit fast
  b. **Shard context** — each agent gets a subset → agents lack shared understanding
  c. **Use smaller models for workers** — but then quality drops

**KimiFlare's failed attempts all hit this.** The orchestrator + isolated buffers approach tried (a) and ran out of context. The persona approach tried (b) but agents couldn't see each other's work.

### 3.2 The Synchronization Problem

When agents work in parallel:
- Agent A writes file `X.ts`
- Agent B reads file `X.ts` (old version) and makes decisions
- Agent A's changes are overwritten or conflict with Agent B's

**Solutions in the wild:**
- **Git-based isolation** — each agent works on a branch, merge at the end (Copilot-style)
- **File locking** — agent A locks `X.ts`, agent B can't touch it
- **Eventual consistency** — agents broadcast changes, others incorporate on next read
- **Temporal partitioning** — plan phase is parallel, execution is sequential

### 3.3 The "When to Stop" Problem

**The user's experience:** "making sure they self manage and know when to stop/ask"

This is harder than it sounds because:
- An agent might stop too early (partial solution)
- An agent might never stop (infinite research spiral)
- An agent might stop and ask when it should have continued
- Multiple agents might all ask the user simultaneously (UX nightmare)

**KimiFlare's v2 design solved this for sequential delegation** (specialist returns `complete` | `blocked` | `partial`), but parallel agents need a **coordination protocol**.

### 3.4 The Overlap Problem

**The user's concern:** "minimal overlap among agents and ideally no todos left unassigned"

This is a **task decomposition and allocation** problem. It's essentially a distributed systems problem:
- How do you partition a task graph so that:
  - Dependencies are respected (B can't start until A finishes)
  - Load is balanced (no agent idle while others are overloaded)
  - Communication overhead is minimized

**Research insight:** This is NP-hard in the general case. Practical systems use heuristics:
- **Greedy assignment** — assign next task to idle agent
- **Skill-based routing** — coding tasks to coder, research to researcher
- **Dependency-aware scheduling** — topological sort of task graph

### 3.5 The User Experience Problem

**The user's insight:** "feels like a lot of organization/management thinking before getting to coding"

In a TUI coding assistant, the user is **watching** the agent work. Parallel agents create UX challenges:
- **Multiple output streams** — which agent's output do you show?
- **Interruption** — if the user interrupts, which agent(s) stop?
- **Progress reporting** — "Agent A is coding auth.ts, Agent B is researching OAuth flows" — this is cognitively heavy
- **Error attribution** — which agent caused the error?

**KimiFlare's failed attempts suffered here.** The orchestrator's "silent handoffs" were confusing. The v2 design's status line idea (`"Delegating to researcher: authentication patterns"`) was a step forward but still sequential.

---

## 4. Emerging Patterns That Might Work

### 4.1 The "Plan → Parallel Execute → Synthesize" Pattern

**Observation:** Most successful multi-agent coding systems don't parallelize *everything*. They parallelize the **execution** phase after a **planning** phase.

**Pattern:**
1. **Planning phase (sequential)** — Generalist agent creates a task graph
   - Tasks with dependencies identified
   - Tasks grouped by skill needed
   - Tasks assigned to agents
2. **Execution phase (parallel)** — Workers run independent tasks simultaneously
   - Each worker gets: task description + relevant context + read-only snapshot of codebase
   - Workers cannot communicate with each other directly
   - Workers report progress to coordinator
3. **Synthesis phase (sequential)** — Coordinator merges results
   - Resolve conflicts
   - Run tests
   - Present unified result to user

**Why this might work for Kimiflare:**
- Planning is sequential — fits existing architecture
- Execution is parallel — addresses speed concern
- Synthesis is sequential — fits existing architecture
- The "todo list" is explicit and created upfront
- Context can be **sharded by task** — each worker only gets what it needs

**Risk:** What if the plan needs to change mid-execution? (New information discovered)

### 4.2 The "Shared Event Log" Pattern

**Observation:** Instead of sharing full conversation history, agents share an **event log** of significant actions.

**Pattern:**
- Central append-only log: `[{agent: "coder", action: "wrote", file: "auth.ts", summary: "..."}, ...]`
- Each agent reads the log before acting
- Log is much smaller than full conversation history
- Log can be summarized for context window management

**Why this might work for Kimiflare:**
- Kimiflare already has `tasks_set` — this is a primitive event log
- The log can be stored in SQLite (existing infrastructure)
- Agents can query: "what has changed since I last checked?"

**Risk:** Agents might still make conflicting changes if they read the log at different times.

### 4.3 The "Branch-per-Agent" Pattern

**Observation:** Git is already a distributed system for parallel work. Use it.

**Pattern:**
- Each agent gets its own git branch
- Agents work in isolation
- Coordinator merges branches (or presents them for user to merge)
- Conflicts are resolved at merge time, not during execution

**Why this might work for Kimiflare:**
- Kimiflare already uses `bash` tool — can run git commands
- Git handles the hard parts (diffs, merges, conflict detection)
- User can review each agent's work separately

**Risk:**
- Merge conflicts are still hard to resolve automatically
- Not all projects use git (though most do)
- Overhead of branch creation/switching

### 4.4 The "Read-Only Parallel, Write Sequential" Pattern

**Observation:** The dangerous part of parallelization is **writes**. Reads are safe.

**Pattern:**
- **Phase 1 (parallel):** All agents read codebase, research, plan independently
  - Research agent: reads docs, web searches
  - Coder agent: reads relevant files, plans implementation
  - Test agent: reads test files, plans test cases
- **Phase 2 (sequential):** One agent writes, others verify
  - Coder writes implementation
  - Test agent writes tests
  - Research agent updates docs

**Why this might work for Kimiflare:**
- Maximizes parallelization of the time-consuming "understanding" phase
- Avoids write conflicts entirely
- Fits the existing triage system (heavy tasks get parallel research)

**Risk:** The write phase is still sequential — but it's usually faster than the read/plan phase.

---

## 5. Open Questions for Kimiflare

Before any implementation, these questions need answers:

### 5.1 Scope Question
**What exactly should be parallelized?**
- a) Research only (web fetch, doc reading)
- b) Research + code reading (understanding phase)
- c) Research + code reading + independent file edits
- d) Everything including tests and verification

**Recommendation:** Start with (b) — parallelize the "understanding" phase. It's safe (read-only), time-consuming, and directly addresses the user's speed concern.

### 5.2 Context Question
**How do we shard context without duplication?**
- Option A: Each agent gets full context (expensive, hits limit)
- Option B: Each agent gets task-specific subset (risk of missing dependencies)
- Option C: Shared read-only context + agent-specific write buffers (complex)

**Recommendation:** Option B with a **context retrieval step** — each agent's first action is to query for relevant files/context using the existing LSP/memory system.

### 5.3 Coordination Question
**How do agents know what others are doing?**
- Option A: Shared message buffer (tried, failed — context explosion)
- Option B: Event log (promising, needs design)
- Option C: Coordinator broadcasts (bottleneck)
- Option D: No communication — pre-planned task graph (simplest)

**Recommendation:** Option D for first attempt — pre-planned task graph with no mid-execution communication. If the plan needs to change, pause and replan.

### 5.4 UX Question
**What does the user see during parallel execution?**
- Option A: One combined output stream (hard to follow)
- Option B: Multiple panes/windows (TUI complexity)
- Option C: Status lines only ("Agent A: reading auth.ts, Agent B: researching OAuth")
- Option D: Collapsible agent panels (like test runners)

**Recommendation:** Option C for MVP — extend the existing status line concept. Kimiflare's TUI is already complex; don't add panes yet.

### 5.5 Failure Question
**What happens when one agent fails?**
- Option A: Abort all agents (simple, wasteful)
- Option B: Let others continue, report failure at synthesis (risk of building on bad foundation)
- Option C: Retry failed agent with different approach (complex)

**Recommendation:** Option B with **dependency awareness** — if agent B depends on agent A's output and A fails, B is cancelled. Independent agents continue.

### 5.6 Cost Question
**How do we track cost across parallel agents?**
- Kimiflare already has cost attribution via `cf-aig-metadata`
- Parallel agents mean concurrent API calls
- Need to aggregate usage across agents for the turn

**Recommendation:** Extend existing `usage-tracker.ts` to support parallel streams. This is tractable.

---

## 6. A Conceptual Architecture for Kimiflare

Based on the research, here's a **conservative** architecture that might actually work:

### 6.1 Core Idea: "Parallel Research, Sequential Action"

Don't try to parallelize everything. Parallelize the **slow, safe parts** (reading, researching, understanding) and keep the **fast, dangerous parts** (writing, editing, executing) sequential.

### 6.2 Components

```
User message
   ↓
[Generalist Agent] — decides if task benefits from parallel research
   │
   ├─ Simple task → handles itself (existing behavior)
   │
   └─ Complex task → creates Research Plan
        │
        ├─ Task 1: Research API documentation
        ├─ Task 2: Read relevant codebase files  
        ├─ Task 3: Search for similar patterns in repo
        └─ Task 4: Check existing tests
        │
        ↓
   [Parallel Research Workers]
   ├─ Worker 1 (web_fetch, read) → findings
   ├─ Worker 2 (grep, glob, read) → findings
   ├─ Worker 3 (lsp_references, read) → findings
   └─ Worker 4 (read, grep) → findings
        │
        ↓
   [Generalist Synthesizes]
   — merges findings into coherent understanding
   — decides on implementation approach
        │
        ↓
   [Sequential Action]
   — writes code (one file at a time)
   — runs tests
   — asks user if blocked
```

### 6.3 Why This Is Different from Previous Attempts

| Aspect | Previous Attempts | This Proposal |
|--------|------------------|---------------|
| **Parallel scope** | Everything (read + write) | Read-only research only |
| **Agent isolation** | Full isolated buffers | Ephemeral workers, shared event log |
| **Communication** | Complex handoffs | No inter-worker communication |
| **Planning** | Implicit (orchestrator decides) | Explicit (generalist creates plan) |
| **User visibility** | Silent handoffs | Clear "research phase → action phase" |
| **Context** | Duplicated per agent | Sharded by task, read-only |

### 6.4 Implementation Sketch

**New tool: `delegate_to_research_workers`**

```typescript
interface ResearchTask {
  id: string;
  description: string;
  tools: string[];        // subset of read-only tools
  contextQuery?: string;  // for LSP/memory lookup
}

interface ResearchPlan {
  tasks: ResearchTask[];
  rationale: string;
}

// Generalist calls this tool with a plan
const delegateToResearchWorkersTool: ToolSpec<{
  plan: ResearchPlan;
}> = {
  name: "delegate_to_research_workers",
  // ...
  async run(args, ctx) {
    // Run tasks in parallel using Promise.all
    const results = await Promise.all(
      args.plan.tasks.map(task => runResearchWorker(task, ctx))
    );
    return { content: JSON.stringify(results), ... };
  }
};
```

**Research worker:**
- Lightweight `runAgentTurn` with:
  - Read-only tool set (read, grep, glob, lsp_*, web_fetch)
  - No memory extraction (avoid DB contention)
  - No code mode
  - Strict iteration limit (e.g., 10 tool calls)
- Returns structured findings

**Synthesis:**
- Generalist receives all findings as a single tool result
- Generalist decides next steps
- If findings are insufficient, generalist can call `delegate_to_research_workers` again with refined tasks

### 6.5 Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Context window exceeded | Each worker gets only task-specific context; no shared buffer |
| Workers conflict | Read-only workers cannot conflict |
| Never-ending research | Strict iteration limit per worker; generalist controls total research budget |
| UX confusion | Clear status line: "Researching: 4 workers active" → "Synthesizing findings" → "Writing code" |
| Cost explosion | Workers use cheaper/faster model (e.g., Kimi-K2.6-light); generalist uses full model |
| Feature breakage | No changes to existing single-agent path; parallel path is opt-in via tool call |

---

## 7. What to Read Next

### 7.1 Required Reading (Before Any Design Decisions)

1. **Claude Code Agent Teams documentation** (`code.claude.com/docs/en/agent-teams`)
   - Understand how they handle coordinator/worker communication
   - Learn from their UX patterns

2. **"The Orchestration of Multi-Agent Systems"** (arXiv:2601.13671v1)
   - Read Section V (Orchestration Layer) for formal definitions
   - Read Section VI (Enterprise Adoption) for practical pitfalls

3. **KimiFlare's own `docs/plans/multi-agent-redesign-v2.md`**
   - Re-read the specialist-as-tools design
   - Consider how to extend it with parallel workers

### 7.2 Recommended Reading

4. **OpenCode architecture deep dive** (`zengineer.blog/blog/tech/opencode-architecture-deep-dive-en/`)
   - See how they handle primary vs. subagent context

5. **GitHub Copilot CLI specialized agents announcement**
   - Understand how they do parallel execution with shared context

6. **CrewAI documentation** (`docs.crewai.com`)
   - For task decomposition patterns

### 7.3 Academic Papers

7. **"TDAG: A multi-agent framework based on dynamic Task Decomposition"** (ScienceDirect)
   - Dynamic task decomposition — relevant for evolving todo lists

8. **"LLM-Based Multi-Agent Systems for Software Engineering"** (ACM)
   - Literature review specific to software engineering

---

## 8. Conclusion

### The Hard Truth

Building a **true** multi-agent coding assistant is still an open problem. Even the biggest players (Anthropic, GitHub, OpenCode) are taking **conservative** approaches:
- Claude Code: parallel workers but with a coordinator bottleneck
- OpenCode: specialized agents but mostly sequential
- Copilot: parallel specialized agents but with heavy infrastructure

### The Opportunity

KimiFlare doesn't need to leapfrog everyone. It needs to **incrementally parallelize the slow parts** while keeping the architecture that already works.

### Recommended Next Step

**Do not build a general multi-agent orchestrator.** Instead:

1. **Prototype parallel research workers** as a single tool (`delegate_to_research_workers`)
2. **Measure** — does it actually speed up heavy tasks?
3. **Iterate** — if it works, consider parallelizing other read-only phases
4. **Only then** consider parallelizing writes (with git branches or file locking)

This is **much less ambitious** than previous attempts. That's the point. The previous attempts failed because they were too ambitious. Start small, prove value, then expand.

---

## 9. Questions for the User

1. **Scope:** Does "parallel research only" feel like enough of a win? Or do you need parallel code editing too?

2. **Model strategy:** Should research workers use a cheaper/faster model than the generalist? (e.g., Kimi-K2.6-light or even a different provider)

3. **Git integration:** Are you open to using git branches for agent isolation if we ever parallelize writes? Or is that too heavy?

4. **Existing v2 plan:** The `docs/plans/multi-agent-redesign-v2.md` design (generalist-owned conversation with ephemeral specialists) was never implemented. Should we implement that first as a foundation, then add parallelism on top?

5. **Triage integration:** Should the triage system be the trigger for parallel research? (e.g., "heavy" tasks automatically spawn research workers)
