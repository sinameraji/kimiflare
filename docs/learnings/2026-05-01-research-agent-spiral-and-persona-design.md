# Research Agent Spiral: Post-Mortem and Personality Design

> Status: Investigation complete. No code changes yet — this document captures findings and proposed design before implementation.
>
> Related: PR #225 (partial fix — persona prefix + web-fetch guardrails), `docs/multi-agent-plan.md`

---

## 1. The Incident

### What happened

User enabled multi-agent mode and asked: *"I don't like the color themes that we offer to users."*

The Research Agent responded with a 50-tool-iteration spiral of `web_fetch` calls to GitHub search URLs:
- `github.com/search?q=terminal+theme`
- `github.com/search?q=dracula+theme`
- `github.com/search?q=catppuccin`
- `github.com/search?q=night-owl`
- … (repeated with slight URL variations)

After exhausting 50 tool calls, the agent hit the iteration limit. The user typed `"go on"`. The agent responded: *"What should I continue with? I don't see an in-progress task from this session."*

The user typed `"go on"` again. The agent repeated the exact same 50-fetch spiral. This happened **three times** — 150+ tool calls, zero synthesis, zero hand-off to the Coding Agent.

### Two distinct bugs

1. **Research spiral**: The agent never concluded its research. It treated each new URL as "progress" without ever synthesizing findings or producing a deliverable.
2. **"Go on" amnesia**: After hitting the tool limit, the agent lost all context of what it was working on. The user's `"go on"` was interpreted as a brand-new, empty request.

---

## 2. Root Cause Analysis

### 2.1 Why Plan Mode didn't spiral, but Research Agent does

**Plan Mode system prompt** (`src/mode.ts:240`):

> "PLAN MODE is active. The user wants you to investigate and produce a plan WITHOUT making any changes… **At the end, present a concise plan** (bullets, files to change, approach). The user will review and then exit plan mode to execute."

Plan Mode gives the single agent three critical things:

| Element | Plan Mode | Research Agent (before fix) |
|---------|-----------|----------------------------|
| **Deliverable** | "a concise plan" | None |
| **Format** | bullets, files to change, approach | None |
| **Termination condition** | "present… the user will review" | None |
| **Scope boundary** | "WITHOUT making any changes" | None |

The single agent knows: *when I have a plan, I'm done.*

The Research Agent knows: *I have tools. I should explore.* It has no concept of "done," no deliverable format, and no stopping heuristic. It defaults to its training distribution — a grad student doing a literature review. Grad students never stop; there's always one more paper to read.

### 2.2 Why the guardrails didn't catch the spiral

Guardrail 3.1 (`docs/guardrails/README.md:106`):

> "On the 3rd identical call, inject a synthetic error"

The Research Agent called `web_fetch` with **different URLs each time**:

```
github.com/search?q=terminal+theme
github.com/search?q=dracula+theme
github.com/search?q=catppuccin
github.com/search?q=night-owl
```

Same tool, different arguments = different signatures = guardrail doesn't fire.

The agent found the loophole: *"if I vary the URL slightly, I can research forever."*

Even if we patch this loophole, the agent still has no concept of "enough." It would pivot to `grep`, `read`, or `lsp_definition` and keep going. The problem isn't the tool — it's the **absence of a stopping heuristic**.

### 2.3 Why "go on" caused amnesia

In `src/agent/loop.ts:434`:

```ts
throw new Error(`kimiflare: tool iteration limit reached (${opts.maxToolIterations ?? 50})`);
```

This is caught in `src/app.tsx:2693` and displayed as a chat event. But critically: **the error is NOT added to the agent's message history.**

The loop structure:

```ts
for (let iter = 0; iter < max; iter++) {
  // stream assistant response...
  // collect tool calls...
  // execute tools...
}
// ONLY AFTER the loop:
opts.messages.push(assistantMsg);  // line 246
```

If the loop throws, `assistantMsg` is never pushed. The assistant's reasoning, partial content, and the tool calls it initiated are all **erased from history**.

When the user says `"go on"`, the message history is:

1. User: *"I don't like the color themes…"*
2. [assistant message **MISSING** — was never saved]
3. [50 tool results with no assistant message explaining why they were requested]
4. User: *"go on"*

The agent sees `"go on"` with **no context** of what was being worked on. The `tasks_set` tool might have been called during the spiral, but tasks live in `tasksRef` (UI state), not in the agent's message history. They're not injected back as persistent context.

### 2.4 Why Claude Code doesn't have this problem

Claude Code maintains coherence because:

1. **Assistant reasoning is checkpointed** — even partial thoughts are saved
2. **The user's original request is always visible** as the anchor
3. **"Continue" means "continue from where we left off"** — the system preserves task context
4. **Hitting a limit is a pause, not a crash** — the assistant says "I've made progress on X, should I continue?"

In KimiFlare, hitting the tool limit is a **hard exception** that wipes the assistant's turn. That's the architectural bug.

---

## 3. The Fix: An Opinionated Research Personality

This is not an algorithm problem. It's a **personality design** problem. We need to decide what kind of researcher the Research Agent should be.

### 3.1 The personality: Senior Staff Engineer, not Grad Student

| Grad Student | Senior Staff Engineer |
|-------------|----------------------|
| "I need to be comprehensive" | "I need enough to make a decision and build" |
| "Let me check one more source" | "I have 3 solid options, here's my recommendation" |
| Neutral, cataloging | Opinionated, recommending |
| Information-oriented | Action-oriented |

The Research Agent's job is not to *collect information*. It's to **produce a Research Brief** that gives the Coding Agent everything they need to implement.

### 3.2 The Research Brief format (mandatory deliverable)

```
RESEARCH BRIEF
==============
1. THE ASK (1 sentence): What the user wants
2. CURRENT STATE (2-3 bullets): What I found in the codebase
3. OPTIONS CONSIDERED (2-3): Approaches, with evidence and tradeoffs
4. RECOMMENDATION (1 paragraph): What the coding agent should do
5. OPEN QUESTIONS (0-2): Things that can be decided during implementation
6. CONFIDENCE (high/medium/low): How sure I am
```

### 3.3 The stopping heuristic (qualitative, not quantitative)

The Research Agent stops when it can **truthfully answer yes** to:

> "If I were the Coding Agent, could I implement the recommendation with just this Brief and my existing skills?"

If yes → stop, present the Brief.
If no → what's missing? Fetch exactly that. Then re-assess.

This is opinionated. It says: *"We believe good research is brief, actionable, and biased toward implementation."* Some research questions need 5 tool calls, some need 30. The agent decides based on the Brief's completeness, not a counter.

### 3.4 Why this prevents the spiral

The spiral happens because the agent treats each URL as "progress." But with the Brief format, the agent must ask:

> "Does this new page fill a gap in my Brief, or am I just collecting more of the same?"

The prompt should say:

> "Before fetching a new page, check your draft Brief. If you already have 2-3 solid examples for a section, you don't need more. Synthesize instead. A Brief with thin evidence is better than no Brief at all."

### 3.5 The Brief is persisted across turns

The Research Brief is not just output — it's **state**. After every tool call (or every few), the agent updates the Brief. The latest draft is:

- Saved as a system message in the agent's session
- Included in hand-off summaries to the Coding Agent
- Visible to the agent itself so it can judge completeness

If the 50-tool limit hits, the partial Brief survives. When the user says `"go on"`, the agent sees:

> "Previous Research Brief (draft): [sections 1-3 complete, section 4 pending]"

And continues from there. No amnesia.

---

## 4. The "Go On" Fix: Graceful Pause, Not Crash

### Current behavior (broken)

```
Agent: [thinks, fetches 50 URLs, never synthesizes]
System: ERROR: tool iteration limit reached
User: go on
Agent: What should I continue with?
```

### Desired behavior

```
Agent: [fetches 15 URLs, writes partial Brief]
System: Paused after 50 tool calls. Research Brief so far: [summary]
User: go on
Agent: Continuing research. Based on my Brief so far, I need to verify [specific gap]...
```

### Architectural changes needed

1. **Commit partial assistant message before throwing**
   Before `throw new Error("tool iteration limit reached")`, push the assistant's accumulated `content` and `reasoning` to `opts.messages`. Even if incomplete, it preserves context.

2. **Inject the Brief as a system message**
   If the agent has produced any Brief content, add it to history: `"Research Brief (in progress): [draft]"`

3. **Change the error message**
   From: `"kimiflare: tool iteration limit reached (50)"`
   To: `"Paused after 50 tool calls. Say 'go on' to continue, or ask me to focus on a specific area."`

4. **Preserve tasks across the boundary**
   If `tasks_set` was called, inject the task list into history as a system message. The agent should always know what it's working on.

---

## 5. Supporting Infrastructure (Secondary)

The personality fix is primary. But these guardrail extensions help:

### 5.1 Pattern-based loop detection (extends Guardrail 3.1)

Detect not just identical signatures but **similar patterns**:

- 5+ `web_fetch` calls within any 8-call window → warning
- 3+ fetches from the same domain → warning

But these are **warnings**, not hard stops. The agent can override if it justifies why in its Brief.

### 5.2 Orchestrator-aware research phases

The orchestrator could track whether the Research Agent has produced a Brief. If not after N user messages, force a hand-off with synthesis: "Research agent has not produced a Brief. Synthesizing findings and handing off."

But N should be generous (like 20 user messages, not 20 tool calls). The point is to catch runaway agents, not to micromanage.

---

## 6. What We Already Shipped (PR #225)

A partial fix was merged in PR #225:

- **Persona prefix**: Research Agent is now told its audience is the Coding Agent, not the user
- **Web-fetch budget**: Max 5 `web_fetch` calls per turn (hard stop)
- **Domain-level anti-loop**: 3+ fetches from same domain triggers warning
- **New themes**: Added `one-dark`, `ayu`, `night-owl`, `palenight`

### Why this is insufficient

The web-fetch budget is a **quantitative** fix for a **qualitative** problem. It prevents the specific symptom (50 GitHub fetches) but doesn't teach the agent when to stop. A research question about a large codebase might legitimately need 15 `read` calls and 0 `web_fetch` calls — the budget doesn't help there.

The persona prefix fixes the audience confusion but doesn't give the agent a job description.

---

## 7. Open Questions for Design Review

1. **Should the Research Brief be structured (JSON) or free-form (markdown)?**
   - Structured: easier to validate, harder for the model to produce
   - Free-form: more natural, harder to parse for the orchestrator

2. **Should the Coding Agent also produce a deliverable (e.g., Implementation Notes)?**
   - If yes, we have a two-phase pipeline: Brief → Implementation → Code
   - If no, the Coding Agent works directly from the Brief

3. **Should the Generalist Agent have a deliverable too?**
   - E.g., "Conversation Summary" or "Decision Log"
   - Or is the Generalist's job inherently open-ended?

4. **How do we handle research that spans multiple turns?**
   - The Brief draft persists, but what if the user changes their mind mid-research?
   - Should the agent re-read the user's latest message and adjust the Brief's scope?

5. **What happens when the user says "go on" but the Brief is already complete?**
   - The agent should recognize this and say: "My Research Brief is complete. Should I hand off to the Coding Agent, or is there something specific you'd like me to dig deeper on?"

---

## 8. Related Documents

- `docs/multi-agent-plan.md` — Multi-agent architecture overview
- `docs/guardrails/README.md` — Guardrail specification (Section 3: Agent Loop Safety)
- `docs/guardrails/file-checklist.md` — Per-file guardrail checklist
- `docs/learnings/2026-04-27-agent-system-integration.md` — Compact, compiled context, code mode, agent memory integration research
- PR #225 — Partial fix (persona prefix + web-fetch guardrails)

---

## 9. Next Steps

1. Review this document with the team
2. Collect mental models for "what a good researcher is" (user input)
3. Design the Research Brief format and prompt language
4. Implement the Brief persistence and graceful pause architecture
5. Extend guardrail 3.1 with pattern-based detection
6. Audit Coding Agent and Generalist Agent for similar personality gaps
