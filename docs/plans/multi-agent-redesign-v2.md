# Multi-Agent Redesign v2: Generalist-Owned Conversation with Ephemeral Specialists

> Status: Architecture decision — ready for implementation  
> Author: kimiflare  
> Date: 2026-05-03  
> Replaces: `docs/plans/multi-agent-redesign.md`, `docs/multi-agent-plan.md`

---

## 1. Executive Summary

**Delete the current multi-agent implementation and replace it with a single generalist agent that delegates to ephemeral specialists via tool calls.**

The generalist owns the conversation. The user only ever talks to the generalist. Specialists (`delegate_to_coder`, `delegate_to_researcher`) are tools the generalist calls — they receive a task, do work in an isolated sandbox, and return a result. There is no `hand_off`, no `AgentOrchestrator`, no intent classifier, no isolated per-agent message buffers.

This preserves every single-agent feature automatically (images, compiled context, agent memory, code mode, cache affinity, LSP, MCP) because there is only one persistent conversation buffer. It also fixes the handoff UX by making the generalist the single source of truth for what the user sees.

---

## 2. Why the Current System Failed

See `docs/plans/multi-agent-redesign.md` §2 for the full post-mortem. The short version:

1. **Orchestrator + Generalist redundancy** — two routing layers that fight each other
2. **Isolated buffers break every feature** — images, compiled context, memory, cache affinity, session resume all become fragile
3. **Silent handoffs** — the user sees unexplained agent jumps with no clear point to interrupt
4. **"Go on" amnesia** — pause messages go into the active agent's buffer, which may not be the agent that receives "go on"
5. **Tool limit UX** — thrown as a red error; users think something broke
6. **Mode × Agent matrix** — 18 untested combinations, holes in permission model

---

## 3. Core Architecture

### 3.1 One Conversation Owner

```
User message
   ↓
[Generalist Agent] ←── only agent the user sees
   │
   ├─ tool: delegate_to_researcher(task, context)
   ├─ tool: delegate_to_coder(task, context)
   ├─ tool: ask_user(question, options?)
   ├─ tool: <all regular tools: read, write, edit, bash, grep, glob, web_fetch, lsp_*, memory_*, tasks_set>
   │
   ↓
Response to user
```

The generalist is the only agent with persistent conversation state. Specialists are ephemeral — they run to completion (or budget exhaustion) and return. Their internal tool calls are invisible to the user unless the generalist chooses to surface them.

### 3.2 Specialists as Tools

Specialists are not agents. They are **tool implementations** that internally run a constrained `runAgentTurn`:

```typescript
// src/tools/delegate-to-researcher.ts
export const delegateToResearcherTool: ToolSpec<{
  task: string;
  sources?: string[];
  depth?: "quick" | "thorough";
}> = {
  name: "delegate_to_researcher",
  needsPermission: false,
  description: `...`,
  parameters: { ... },
  async run(args, ctx): Promise<ToolOutput> {
    const result = await runSpecialistTurn({
      persona: "research",
      task: args.task,
      sources: args.sources,
      depth: args.depth,
      maxIterations: 20,
      codeMode: false,
      tools: RESEARCH_TOOLS, // read, grep, glob, lsp_*, web_fetch
      ...ctx,
    });
    return { content: JSON.stringify(result), rawBytes: 0, reducedBytes: 0 };
  },
};
```

```typescript
// src/tools/delegate-to-coder.ts
export const delegateToCoderTool: ToolSpec<{
  task: string;
  files?: string[];
  constraints?: string;
}> = {
  name: "delegate_to_coder",
  needsPermission: false,
  description: `...`,
  parameters: { ... },
  async run(args, ctx): Promise<ToolOutput> {
    const result = await runSpecialistTurn({
      persona: "coding",
      task: args.task,
      files: args.files,
      constraints: args.constraints,
      maxIterations: 30,
      codeMode: ctx.codeMode ?? false, // respect global code mode setting
      tools: CODING_TOOLS, // read, write, edit, bash, lsp_*, memory_remember
      ...ctx,
    });
    return { content: JSON.stringify(result), rawBytes: 0, reducedBytes: 0 };
  },
};
```

### 3.3 Specialist Result Schema

Both specialists return the same shape:

```typescript
interface SpecialistResult {
  summary: string;           // for generalist to relay/use
  artifacts: Artifact[];     // diffs, files, findings, etc.
  status: "complete" | "blocked" | "partial";
  blocker?: string;          // if blocked, what's needed
  toolCallsMade: number;     // for cost tracking
  usage: Usage;              // token usage for cost tracking
}
```

The generalist receives this as a tool result and decides what to do next:
- `complete` → present to user, or delegate to next specialist
- `blocked` → call `ask_user` with the blocker, or try a different approach
- `partial` → decide whether to re-delegate with refined task, or ask user

### 3.4 `ask_user`: The Only Pause Mechanism

```typescript
// src/tools/ask-user.ts
export const askUserTool: ToolSpec<{
  question: string;
  options?: string[];
  reason?: string;
}> = {
  name: "ask_user",
  needsPermission: false, // the tool itself is the permission request
  description: `...`,
  parameters: { ... },
  async run(args, ctx): Promise<ToolOutput> {
    // This is special: it does not return until the user responds.
    // The generalist's turn ends here. The user's next message
    // is injected as the tool result.
    const response = await ctx.askUser(args.question, args.options);
    return { content: response, rawBytes: 0, reducedBytes: 0 };
  },
};
```

**Key principle:** `ask_user` is the **only** way the agent pauses for user input. Every other output is either:
- A final answer (turn ends, user can type next message)
- In-progress work (user can interrupt but isn't expected to)

This eliminates the "am I supposed to chime in?" problem entirely.

### 3.5 Three UI States

The TUI renders exactly one of three states:

1. **Working** (interruptible) — spinner, status line, input disabled or shows "interrupt to redirect"
2. **Awaiting input** (blocking) — only when `ask_user` is called. Clear question, optional choice buttons, input enabled
3. **Done** — final response shown, input enabled for next turn

**Status line during work:** The generalist emits a brief status string each time it starts a major operation:
- "Reading repository structure…"
- "Delegating to researcher: authentication patterns"
- "Researcher is analyzing 4 sources…"
- "Delegating to coder: refactor auth module"
- "Running tests to verify changes…"

This is not a chat message — it's UI metadata shown in the working state. It solves the "what's happening?" anxiety that makes users interrupt unnecessarily.

### 3.6 Interrupt Behavior

When the user interrupts (Ctrl+C or Escape during working state):

1. Cancel in-flight tool calls cleanly
2. Preserve everything done so far in the conversation history
3. Show input box with hint: "redirect or add context"
4. Next user message goes to the generalist with full context

The interrupt feels like a steering wheel, not a brake.

---

## 4. Tool Sets and Permission Model

### 4.1 Generalist Tool Set

```
read, write, edit, bash, grep, glob, web_fetch,
lsp_*, memory_*, tasks_set,
delegate_to_researcher, delegate_to_coder, ask_user
```

The generalist can do light work itself (read a file, run a quick command) or delegate. It decides based on the task complexity.

### 4.2 Research Specialist Tool Set

```
read, grep, glob, lsp_*, web_fetch, tasks_set
```

**No `write`, `edit`, `bash`, `memory_remember`, `delegate_*`.** Even in `auto` mode, the research specialist cannot mutate the filesystem. If it tries, the executor returns:
> "Tool `write` is not available in research context. The generalist can delegate to the coding specialist if file changes are needed."

### 4.3 Coding Specialist Tool Set

```
read, write, edit, bash, lsp_*, memory_remember, tasks_set
```

**No `web_fetch`, `delegate_*`.** The coding specialist focuses on implementation. If it needs research, it returns `status: "blocked"` with a `blocker` explaining what's needed, and the generalist decides whether to delegate to research or ask the user.

### 4.4 Mode Interaction

Mode is the **permission layer** and applies universally:

| Mode | Effect on Generalist | Effect on Coding Specialist | Effect on Research Specialist |
|------|---------------------|----------------------------|------------------------------|
| `edit` | Mutating tools ask permission | Mutating tools ask permission | N/A (no mutating tools) |
| `plan` | Mutating tools blocked | Mutating tools blocked | N/A (no mutating tools) |
| `auto` | All tools auto-approved | All tools auto-approved | All tools auto-approved |

This is simple, testable, and doesn't explode combinatorially.

**Note:** We keep `edit`/`plan`/`auto` modes for backward compatibility. A future PR can migrate to autonomy sliders ("ask before editing files", "ask before running commands") without touching the specialist architecture.

---

## 5. Tool Iteration Limit Redesign

### 5.1 Per-Agent Budgets

| Agent | Max Tool Iterations |
|-------|---------------------|
| Generalist | 50 (unchanged) |
| Research Specialist | 20 |
| Coding Specialist | 30 |

Each `delegate_to_*` call counts as **one** tool call against the generalist's budget, even if the specialist internally makes 20. This prevents the generalist from being consumed by specialist work.

### 5.2 Soft Check-In at 70%

When the generalist reaches 70% of its budget (35 tool calls):
- Emit status line: "This is a substantial task — I've used 35 tool calls. I'll check in before hitting the limit."
- Inject a system reminder: "You have used 35 of 50 tool calls. Consider whether to ask the user for direction or wrap up with what you have."

### 5.3 Forced Check-In at 100%

When the generalist reaches 50 tool calls, instead of throwing an error, it **must** call `ask_user`:

```
ask_user({
  question: "I've done substantial work on this. Want me to keep going, wrap up with what I have, or take a different approach?",
  options: ["continue", "wrap up", "redirect"],
  reason: "tool iteration budget exhausted"
})
```

The turn ends. The user's response is injected as the tool result. If the user says "continue", the generalist's next turn starts fresh with the same context. No amnesia, no red error.

### 5.4 Specialist Budget Exhaustion

If a specialist hits its internal limit (20 for research, 30 for coding), it returns:

```json
{
  "status": "partial",
  "summary": "I analyzed 4 of 6 files before hitting the tool budget...",
  "artifacts": [...],
  "blocker": "Need 5 more tool calls to finish analyzing the remaining files."
}
```

The generalist decides whether to re-delegate with a narrower task, ask the user, or present the partial results.

---

## 6. How Existing Features Work

### 6.1 Code Mode

Code mode is a property of the **specialist**, not the generalist. The generalist reasons in natural language. When it delegates to the coding specialist, the specialist runner invokes `runAgentTurn` with `codeMode: true` and a coding-focused tool set. The generated TypeScript API includes `read`, `write`, `edit`, `bash`, `lsp_*`, etc.

The specialist writes a script, executes it in the sandbox, and returns the result. The generalist never sees the intermediate script — only the `summary` and `artifacts`.

### 6.2 Agent Memory

Memory recall and injection work exactly like single-agent mode because there's only one message buffer:

1. **Session start:** Recall memories, inject into generalist's messages (`app.tsx:810-827` pattern, unchanged)
2. **After compaction:** Recall memories, inject into generalist's messages (`app.tsx:2794-2812` pattern, unchanged)
3. **Specialists are ephemeral** — they don't need memory. The generalist passes all relevant context in the `task` string when delegating.

The generalist can call `memory_remember` directly. The coding specialist can also call `memory_remember` (it's in its tool set) to record implementation details. The research specialist cannot (defense in depth).

### 6.3 x-Session-Affinity Cache

The cache key is derived from the conversation hash (messages + system prompt). With one persistent buffer, the generalist's conversation hashes consistently. Cache affinity is perfectly preserved.

Specialist invocations are separate `runKimi` calls with fresh, task-specific message buffers — but that's fine because each specialist task is a one-shot, not a conversation. The cache affinity that matters (ongoing context) is continuous.

### 6.4 Compiled Context + Artifact Store

One global `artifactStoreRef.current`, one `sessionStateRef.current`, one `messagesRef.current`. The `recallArtifacts` call before each turn sees the full conversation history and recalls the right artifacts. No per-agent stores, no sync dance.

### 6.5 Image Understanding (`keepLastImageTurns`)

One buffer. Images stay in the conversation for exactly `cfg.imageHistoryTurns` turns, then get stripped. Exactly like single-agent mode. The generalist can delegate to a specialist and say "look at the image the user sent in the previous turn" because the image is still in the shared buffer.

### 6.6 LSP + MCP

Same `ToolExecutor` instance, same LSP manager, same MCP manager. File changes made by the coding specialist are immediately visible to the LSP manager because there's no buffer isolation. The generalist can then call `lsp_diagnostics` in its next turn and see the results.

### 6.7 Cost Attribution

Each specialist invocation is a separate `runAgentTurn` call. We record usage with the specialist's role:

```typescript
// Generalist turn
await runAgentTurn({ ..., agentRole: "generalist" });
recordUsage(sid, usage, ..., "generalist");

// Specialist turn (inside delegate_to_coder tool)
await runAgentTurn({ ..., agentRole: "coding" });
recordUsage(sid, usage, ..., "coding");
```

Cost attribution becomes *more accurate* because every specialist invocation is independently tracked.

### 6.8 Session Persistence / Resume

Session files save `messages`, `sessionState`, `artifactStore`, and optionally `currentPersona` (a string, default `"generalist"`).

Resume is:
1. Load `messages` into `messagesRef.current`
2. Load `artifactStore` into `artifactStoreRef.current`
3. Set `currentPersona` from saved value

No orchestrator hydration. No migration logic. Old sessions without `persona` default to `"generalist"` and work fine.

### 6.9 Anti-Loop + Budget Guardrails

Each specialist invocation gets a **fresh** guardrail state — which is correct, because each specialist is a new task. The research specialist gets 20 tool calls with its own web-fetch budget (`MAX_WEB_FETCH_PER_TURN = 5`). If it hits the limit, it returns `status: "partial"` to the generalist.

The generalist's guardrail state is continuous across the conversation. It can't spiral on web fetches because it doesn't have `web_fetch` in its tool set (it delegates research).

### 6.10 Task List (`tasks_set`)

Only the generalist can call `tasks_set`. Specialists are not given this tool. The generalist uses tasks to track high-level progress ("Research auth patterns", "Refactor auth.ts", "Run tests"). When it delegates to a specialist, the task stays in "in_progress" until the specialist returns. The generalist then marks it complete and creates the next task.

---

## 7. System Prompt Design

### 7.1 Generalist System Prompt

The generalist is the user's primary point of contact. It triages, delegates, and presents results.

```
You are kimiflare, a terminal coding assistant. You help users with software engineering tasks by reading files, running commands, researching topics, and writing code.

# Your job

Handle the user's request. For small tasks (reading a file, running a quick command, answering a factual question), do it yourself. For substantial tasks (research, multi-file changes, complex debugging), delegate to specialists.

# Delegation

Call delegate_to_researcher when the user needs:
- Information you don't already have
- Comparison or evaluation between options
- Investigation of an unfamiliar codebase or library
- Architecture or design decisions

Call delegate_to_coder when the user needs:
- Code written, modified, debugged, or reviewed
- Files created, edited, or restructured
- Build/run/test actions

You may chain specialists: research → coding → research → coding. You decide the sequence.

# ask_user

Call ask_user when:
- You need a decision you can't make alone
- A specialist returned status: "blocked"
- You've used 35+ tool calls and want to check in
- You've hit the 50-tool limit and need direction

# Status updates

When you start a major operation, begin your response with a status line in brackets:
[Reading repository structure…]
[Delegating to researcher: authentication patterns]
[Running tests to verify changes…]

These status lines help the user understand what's happening.

# Voice

Direct, concise, no throat-clearing. Present specialist results without editorializing. The user can read.
```

### 7.2 Research Specialist System Prompt

Derived from the current research agent prompt (`system-prompt.ts:45-116`) but stripped of `hand_off` instructions and orchestrator references.

```
You are a research specialist. You investigate technical questions and return structured findings.

# Your job

Produce the smallest research artifact that enables action. Not the most thorough — the smallest sufficient one.

# Output format

- DECISION: one sentence — what this research enables
- FINDINGS: scannable facts with source attribution
- RECOMMENDATION: what should be done, concretely
- CONFIDENCE: per claim
- OPEN QUESTIONS: blocking vs non-blocking
- RISKS: what could go wrong

# Budget

You have 20 tool calls. Default to ~5 for routine questions, up to 15 for substantial ones. After every 3 calls, ask: is the next call worth more than what I already have?

# Tools available

read, grep, glob, lsp_*, web_fetch

You cannot write files, edit files, or run shell commands. Return your findings and let the generalist decide what to do with them.
```

### 7.3 Coding Specialist System Prompt

Derived from the current coding agent prompt (`system-prompt.ts:117-169`).

```
You are a coding specialist. You write, modify, debug, and reason about code.

# Your job

Implement the task as scoped. Correctly, narrowly, and in a way that fits the codebase.

# Working style

- Read before you write
- Small, verifiable steps
- Run the code. Read the output. Believe the output.
- Prefer existing utilities and patterns

# Budget

You have 30 tool calls. If you need more, return status: "partial" with a blocker explaining what's left.

# Tools available

read, write, edit, bash, lsp_*, memory_remember

You cannot do web research. If you need external information, return status: "blocked" with a blocker explaining what's needed.
```

---

## 8. Implementation Phases

### Phase 1: Tool Iteration Limit UX Fix (Single PR, ships first)

**Goal:** Fix the broken UX for single-agent users too.

**Files:** `src/agent/loop.ts`, `src/app.tsx`

1. Change `runAgentTurn` return type from `Promise<void>` to `Promise<{ paused?: boolean }>`
2. Instead of `throw new Error(...)` at line 458, return `{ paused: true }`
3. In `app.tsx`, detect `paused` and render an `info` event:
   > "Reached tool call limit. I've made progress on [task]. Say **go on** to continue, or tell me what to focus on."
4. The system pause message stays in `messages` so "go on" works seamlessly.

**Acceptance:** Single-agent users see a friendly message, not a red error.

### Phase 2: Delete Current Multi-Agent (Single PR)

**Goal:** Remove the broken implementation.

**Delete:**
- `src/agent/orchestrator.ts` + `.test.ts`
- `src/agent/agent-session.ts` + `.test.ts`
- `src/agent/intent-classifier.ts` + `.test.ts`
- `src/tools/hand-off.ts`
- `docs/multi-agent-plan.md` (archive or delete)

**Clean up `src/config.ts`:**
- Remove: `multiAgent`, `agentModels`, `agentReasoningEffort`, `orchestratorModel`, `autoSwitch`, `autoSwitchConfirm`, `maxTurnsPerAgent`, `customAgents`
- Keep: everything else

**Clean up `src/sessions.ts`:**
- Remove `multiAgentState` from `SessionFile`
- Remove legacy role name mapping (`plan` → `research`, etc.)

**Clean up `src/app.tsx`:**
- Remove `orchestratorRef`, `pendingOrchestratorStateRef`
- Remove all `cfg.multiAgent` branches
- Simplify `saveSessionSafe` — always save `artifactStore`
- Simplify resume logic — no orchestrator hydration
- Remove `agentRole` from assistant event display (for now; will re-add for persona display in Phase 3)

**Clean up `src/agent/system-prompt.ts`:**
- Remove `hand_off` instructions from role prefixes
- Remove orchestrator references
- Keep role prefixes — they'll be repurposed as specialist prompts in Phase 3

**Acceptance:** `npm run typecheck` passes, `npm run build` succeeds, single-agent mode works identically.

### Phase 3: Add Specialist System (Single PR)

**Goal:** The core architectural change.

**New files:**
- `src/agent/specialist.ts` — `runSpecialistTurn()` helper
- `src/agent/persona.ts` — persona definitions, tool filters
- `src/tools/delegate-to-researcher.ts`
- `src/tools/delegate-to-coder.ts`
- `src/tools/ask-user.ts`

**Modify `src/agent/loop.ts`:**
- Return `TurnResult` with `paused?: boolean`
- Accept `persona?: Persona` in `AgentTurnOpts`
- Filter tools via `filterTools(persona, allTools)` before building tool defs

**Modify `src/agent/system-prompt.ts`:**
- `buildSystemPrompt` accepts `persona?: Persona`
- Generalist prompt (no persona) + research prompt + coding prompt

**Modify `src/app.tsx`:**
- Add `currentPersona` state (default `"generalist"`, purely for UI display)
- Add `statusLine` state for working-state display
- Rebuild prefix messages with generalist prompt
- Wire `delegate_to_researcher`, `delegate_to_coder`, `ask_user` tools into executor
- Handle `ask_user` tool specially: pause the turn, show question + options, resume with user response as tool result
- Show current persona in status bar
- Add `/persona` slash command (force-switch for debugging)
- Re-add `agentRole` to assistant events for UI display (shows which specialist is running)

**Modify `src/ui/help-menu.tsx`:**
- Remove multi-agent toggle
- Add specialist info

**Acceptance:**
- Generalist can delegate to research and coding specialists
- Research specialist cannot write files
- Coding specialist cannot do web fetches
- `ask_user` pauses the turn and resumes with user response
- Status line shows during working state

### Phase 4: Session Persistence & Resume (Single PR)

**Goal:** Save and restore persona state.

**Modify `src/sessions.ts`:**
- Add `persona?: string` to `SessionFile`
- Save current persona on session save
- Restore persona on resume

**Migration:**
- Old sessions without `persona` default to `"generalist"`
- Old sessions with `multiAgentState` are ignored (field already optional)

**Acceptance:** Session save/resume preserves persona and works seamlessly.

### Phase 5: Polish & Guardrails (Single PR)

**Goal:** Tighten UX and update documentation.

1. **Budget checks:**
   - Generalist: soft check-in at 35 tool calls (70%), forced `ask_user` at 50
   - Research specialist: soft at 12, forced return at 20
   - Coding specialist: soft at 20, forced return at 30

2. **Web-fetch spiral guardrail:** Keep existing per-turn domain limits in `loop.ts`, apply to research specialist

3. **Anti-loop guardrail:** Keep existing, apply per specialist invocation

4. **Status line refinement:** Ensure status lines are concise and informative

5. **Update `docs/guardrails/README.md`:**
   - Remove multi-agent specific rules
   - Add specialist rules (research must return structured output, coding must not web fetch, etc.)

6. **Update `docs/learnings/README.md`:** Add entry for this redesign

**Acceptance:** All guardrails from `docs/guardrails/README.md` pass.

---

## 9. File-by-File Change Summary

| File | Action | Details |
|------|--------|---------|
| `src/agent/loop.ts` | Modify | Return `TurnResult`, filter tools by persona |
| `src/agent/system-prompt.ts` | Modify | Generalist + research + coding prompts, no `hand_off` |
| `src/agent/specialist.ts` | **Create** | `runSpecialistTurn()` — ephemeral agent runner |
| `src/agent/persona.ts` | **Create** | Persona definitions, tool filters |
| `src/agent/orchestrator.ts` | **Delete** | |
| `src/agent/agent-session.ts` | **Delete** | |
| `src/agent/intent-classifier.ts` | **Delete** | |
| `src/tools/hand-off.ts` | **Delete** | |
| `src/tools/delegate-to-researcher.ts` | **Create** | Tool spec + implementation |
| `src/tools/delegate-to-coder.ts` | **Create** | Tool spec + implementation |
| `src/tools/ask-user.ts` | **Create** | Tool spec + implementation |
| `src/config.ts` | Modify | Remove multi-agent config fields |
| `src/sessions.ts` | Modify | Add `persona` field, remove `multiAgentState` |
| `src/app.tsx` | Modify | Persona state, status line, `ask_user` handling, slash command |
| `src/ui/help-menu.tsx` | Modify | Remove multi-agent toggle, add specialist info |
| `docs/multi-agent-plan.md` | **Delete/Archive** | |
| `docs/plans/multi-agent-redesign.md` | **Archive** | Replaced by this document |
| `docs/plans/multi-agent-redesign-v2.md` | **Create** | This document |
| `docs/guardrails/README.md` | Modify | Replace multi-agent rules with specialist rules |

---

## 10. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Generalist delegates poorly (too much or too little) | Medium | High | Prompt engineering + budget checks. Can tune generalist prompt without touching specialists. |
| Specialist returns low-quality output | Low | Medium | High-quality prompts inherited from current system. Generalist can re-delegate with refined task. |
| `ask_user` feels interruptive | Low | Medium | Only called at blockers or budget limits, not for every decision. |
| Users miss the old multi-agent | Low | Low | Feature was behind flag, default false. No breaking change for default users. |
| Session loss for existing multi-agent users | Medium | Medium | Acceptable — flag was experimental. Old sessions resume as generalist. |
| TypeScript strictness regressions | Low | Medium | `npm run typecheck` in CI. Delete tests alongside code. |
| Cost increase from specialist overhead | Medium | Medium | Each specialist is a separate LLM call. But cache affinity improves, and specialists have smaller budgets. Net cost should be similar or lower. |

---

## 11. Cost Analysis

### Current Multi-Agent Cost

| Component | Cost Driver |
|-----------|------------|
| Orchestrator synthesis | Extra LLM call on every handoff (~500-1000 tokens) |
| Cache misses | Divergent buffers break cache affinity |
| Research spiral | 150+ tool calls with zero synthesis (documented incident) |
| Generalist re-runs | Implicit handoff to generalist runs extra turn |

### New Architecture Cost

| Component | Cost Driver |
|-----------|------------|
| Specialist calls | One LLM call per delegation, but with smaller context (fresh buffer, no history) |
| Cache hits | One continuous conversation = consistent cache keys |
| No synthesis overhead | No orchestrator LLM call between agents |
| Bounded spirals | Specialist budgets (20/30) prevent runaway |

**Net expectation:** Similar or lower cost. The specialist overhead is offset by eliminating orchestrator synthesis calls and improving cache hit rates. The bounded budgets prevent the catastrophic spirals that dominated multi-agent costs.

---

## 12. Acceptance Criteria

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] Single-agent mode works identically to before (regression test)
- [ ] Generalist can delegate to research specialist
- [ ] Generalist can delegate to coding specialist
- [ ] Research specialist cannot call `write`/`edit`/`bash` even in `auto` mode
- [ ] Coding specialist cannot call `web_fetch`
- [ ] `ask_user` pauses the turn and resumes with user response as tool result
- [ ] Tool iteration limit shows friendly info + `ask_user`, not red error
- [ ] "go on" continues seamlessly from paused turn
- [ ] Status line visible during working state
- [ ] Interrupt preserves conversation history
- [ ] Session save/resume preserves persona
- [ ] Image understanding works across specialist invocations
- [ ] Compiled context + artifact recall works across specialist invocations
- [ ] Agent memory recall/injection works across specialist invocations
- [ ] Code mode works in coding specialist
- [ ] LSP + MCP tools work across specialist invocations
- [ ] Cost attribution tracks generalist and specialist usage separately
- [ ] Task list owned by generalist, not churned by specialists
- [ ] No `AgentOrchestrator`, `AgentSession`, `intent-classifier`, or `hand_off` references remain

---

## 13. Conclusion

This design combines the best of both proposals:

- **From the friend's plan:** Generalist owns conversation, specialists as tools, `ask_user` as the only pause mechanism, three UI states, status line, iteration limit as forced check-in.
- **From the original plan:** Phased implementation, backward compatibility with modes, simplified schemas (no `expected_output` enums), defense-in-depth tool filtering, preservation of all single-agent features.

The result is an architecture that gives users specialized agents without the complexity of orchestration, isolated buffers, or silent handoffs. It deletes ~1,000 lines of fragile multi-agent code and replaces it with ~300 lines of clean, composable specialist tools.

**The user gets specialists. The developers get simplicity. The codebase gets coherence. Costs stay reasonable.**
