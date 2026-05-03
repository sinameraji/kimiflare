# Multi-Agent Redesign: Unified Agent with Personas

> Status: Research complete — ready for implementation planning  
> Author: kimiflare  
> Date: 2026-05-03

---

## 1. Executive Summary

**Delete the current multi-agent implementation entirely and replace it with a "Unified Agent with Personas" architecture.**

The current system (`AgentOrchestrator` + isolated per-agent buffers + `hand_off` tool + intent classifier) is fundamentally flawed: it fragments conversation context, breaks backward compatibility with every single-agent feature, creates confusing silent handoffs, and duplicates routing responsibility between the orchestrator and the generalist agent.

The new architecture keeps **one shared message buffer** (exactly like single-agent mode) and treats "persona" as a lightweight system-prompt prefix that the model can switch during conversation. This preserves all existing features automatically — images, compiled context, agent memory, code mode, session affinity caching, LSP, MCP, and the edit/plan/auto permission model.

---

## 2. Root Cause Analysis of Current Failures

### 2.1 Orchestrator + Generalist = Confused Routing

The `AgentOrchestrator` has auto-switch logic (`classifyIntent` + `shouldSwitchRole`). The generalist agent's system prompt also tells it to route. They fight. The orchestrator switches silently; the generalist tries to call `hand_off`. Neither knows what the other decided.

**Evidence:** `orchestrator.ts:246-267` auto-switches on user messages before the generalist even sees them. `system-prompt.ts:179-189` tells the generalist to route. When both fire, the user sees unexplained agent jumps.

### 2.2 Isolated Buffers Break Every Single-Agent Feature

| Feature | Single-Agent | Multi-Agent | Broken? |
|---------|-------------|-------------|---------|
| `keepLastImageTurns` | strips old images from shared buffer | only strips from active agent's buffer | ✅ Images leak into other agents or get lost |
| `compiledContext` + `artifactStore` | one global store | per-agent store, synced via `messagesRef` dance | ✅ Artifacts recalled in wrong context |
| `memoryManager` recall | injected into shared buffer | injected into shared buffer, but active agent buffer diverges | ✅ Memories visible to wrong persona |
| `sessionId` / cache affinity | one conversation hash | three different buffers = three different caches | ✅ Cache misses, higher cost |
| Session resume | load `messages` | migrate legacy → `multiAgentState`, hydrate orchestrator, sync buffers | ✅ Resume often loses context |
| Code mode | one `execute_code` API | per-agent APIs, sandbox state lost on handoff | ✅ Code mode context lost |
| Mode (edit/plan/auto) | universal permission model | unclear which agent respects it | ✅ Research agent can write in plan mode |

### 2.3 Handoffs Are Silent and Confusing

When `hand_off` is detected, `orchestrator.ts:330-446` immediately runs the target agent **before returning to `app.tsx`**. The user sees:
1. Research agent streaming
2. Nothing for a moment (synthesis LLM call)
3. Coding agent streaming

There's no clear point where the user can interrupt. The "implicit handoff guarantee" (`orchestrator.ts:397-446`) runs the generalist **silently** if a specialist forgot to call `hand_off`. The user didn't ask for this.

### 2.4 "Go On" Amnesia

When the 50-tool limit hits, `loop.ts:454-458` injects a system message and throws. In single-agent mode, this works: the system message stays in the shared buffer. In multi-agent mode:
- The pause message is in the **active agent's** buffer
- The user types "go on" → goes to `messagesRef.current` (synced from active agent)
- But if a handoff happened, the next agent's buffer doesn't have the research context
- The research agent's buffer had the context, but it's no longer active

**Evidence:** `docs/learnings/2026-05-01-research-agent-spiral-and-persona-design.md` — 150 tool calls, three "go on" loops, zero synthesis.

### 2.5 Tool Iteration Limit UX Is Broken in Both Modes

The error is thrown as `new Error("kimiflare: tool iteration limit reached...")`. `app.tsx:2818-2853` catches it and renders a **red error message**. Users think something broke. The message *does* say "Say 'go on' to continue" but it's buried inside an error string. Many users don't read error text — they assume failure.

### 2.6 Mode × Agent Matrix Is Unmanageable

We have 3 modes (edit, plan, auto) × 3 agents (research, coding, generalist) × 2 switch modes (manual, auto). That's 18 combinations, most untested. The research agent is supposed to be read-only but `plan` mode blocking is enforced by `app.tsx`'s permission handler, not by the agent's tool set — so in `auto` mode, the research agent can accidentally write files.

---

## 3. Proposed Architecture: Unified Agent with Personas

### 3.1 Core Principle

**One message buffer. One `runAgentTurn`. One agent loop. The "persona" is just a system prompt prefix.**

There is no `AgentOrchestrator`. There is no `hand_off` tool. There is no intent classifier. The model itself decides when to switch persona by emitting a marker in its assistant message.

### 3.2 Persona Definitions

```typescript
// src/agent/persona.ts
export type Persona = "generalist" | "research" | "coding";

export interface PersonaDef {
  name: Persona;
  prefix: string;           // system prompt addition
  toolFilter?: string[];    // undefined = all tools
  maxToolIterations?: number;
}
```

Personas reuse the existing high-quality system prompts from `system-prompt.ts:45-231` but strip out all `hand_off` instructions and orchestrator references.

### 3.3 Persona Switching Protocol

The model switches persona by including a marker in its **text content**:

```
[persona:research]
```

`runAgentTurn` parses this after the assistant message finalizes and returns it to the caller:

```typescript
interface TurnResult {
  paused?: boolean;           // hit tool iteration limit
  personaSwitch?: Persona;    // model requested switch
}
```

`app.tsx` updates `currentPersona` state, rebuilds the system prompt prefix, and the next turn runs with the new persona. The conversation history is **shared** — the model sees everything it previously said, regardless of persona.

### 3.4 Why This Fixes Every Problem

| Problem | Fix |
|---------|-----|
| Orchestrator vs Generalist confusion | No orchestrator. Model routes itself. |
| Backward compatibility | One buffer = all single-agent features work unchanged. |
| Silent handoffs | Every persona switch is visible in the assistant's text. No background agent runs. |
| "Go on" amnesia | Pause message stays in the shared buffer. Next turn sees it. |
| Tool limit UX | Return `paused: true` instead of throwing. Render as info, not error. |
| Mode × Agent matrix | Mode is permission layer (universal). Persona is capability layer. Orthogonal. |
| Research spiral | Research persona has `toolFilter` limiting it to read-only tools. Cannot write even in auto mode. |
| Session resume | Load messages + current persona. No migration logic. |
| Cache affinity | One buffer = one `sessionId` hash. Cache hits preserved. |

### 3.5 Tool Filtering

Instead of giving all tools to all personas, filter at `runAgentTurn` call time:

- **generalist**: `tasks_set`, `web_fetch`, `memory_*`, `hand_off` (removed — no longer needed)
- **research**: `read`, `grep`, `glob`, `lsp_*`, `web_fetch`, `tasks_set`, `memory_recall` — **no `write`, `edit`, `bash`, `memory_remember`**
- **coding**: all tools

If a persona tries to call a disallowed tool, the executor returns:
> "Tool `write` is not available in research persona. Switch to coding persona if you need to write files."

This is **defense in depth**: even in `auto` mode, the research persona cannot mutate the filesystem.

### 3.6 Mode (Edit/Plan/Auto) Interaction

Mode is purely the permission layer in `app.tsx`. It applies to **all** tool calls regardless of persona:

- `edit` mode: mutating tools ask permission
- `plan` mode: mutating tools blocked (research persona already can't call them, so this is a no-op for research)
- `auto` mode: all allowed tools auto-approved

This is simple, testable, and doesn't explode combinatorially.

---

## 4. Implementation Plan

### Phase 1: Tool Iteration Limit UX Fix (Single PR, ships first)

**Files:** `src/agent/loop.ts`, `src/app.tsx`

1. Change `runAgentTurn` return type from `Promise<void>` to `Promise<{ paused?: boolean }>`
2. Instead of `throw new Error(...)` at line 458, return `{ paused: true }`
3. In `app.tsx`, detect `paused` and render an `info` event:
   > "Reached tool call limit. I've made progress on [task]. Say **go on** to continue, or tell me what to focus on."
4. The system pause message stays in `messages` so "go on" works seamlessly.

**Why first:** This bug hurts single-agent users too. Quick win, builds trust.

### Phase 2: Delete Current Multi-Agent (Single PR)

**Delete:**
- `src/agent/orchestrator.ts` + `.test.ts`
- `src/agent/agent-session.ts` + `.test.ts`
- `src/agent/intent-classifier.ts` + `.test.ts`
- `src/tools/hand-off.ts`
- `docs/multi-agent-plan.md` (or archive it)

**Clean up `src/config.ts`:**
- Remove: `multiAgent`, `agentModels`, `agentReasoningEffort`, `orchestratorModel`, `autoSwitch`, `autoSwitchConfirm`, `maxTurnsPerAgent`, `customAgents`
- Keep: everything else

**Clean up `src/sessions.ts`:**
- Remove `multiAgentState` from `SessionFile`
- Remove legacy role name mapping (`plan` → `research`, etc.)

**Clean up `src/app.tsx`:**
- Remove `orchestratorRef`, `pendingOrchestratorStateRef`
- Remove all `cfg.multiAgent` branches
- Remove `agentRole` from assistant event display (or keep it for future persona display)
- Simplify `saveSessionSafe` — always save `artifactStore`
- Simplify resume logic — no orchestrator hydration

**Clean up `src/agent/system-prompt.ts`:**
- Remove `hand_off` instructions from role prefixes
- Remove orchestrator references
- Keep role prefixes — they'll be repurposed as persona prefixes

### Phase 3: Add Persona System (Single PR)

**New file:** `src/agent/persona.ts`
- Define `Persona` type and `PERSONAS` record
- Port cleaned-up prefixes from `system-prompt.ts`
- Add `filterTools(persona, allTools)` helper
- Add `detectPersonaSwitch(assistantContent): Persona | undefined`

**Modify `src/agent/loop.ts`:**
- Add `persona?: Persona` to `AgentTurnOpts`
- Filter tools via `filterTools` before building tool defs
- After assistant message finalizes, scan `content` for `[persona:X]` marker
- Return `{ paused?: boolean; personaSwitch?: Persona }`

**Modify `src/agent/system-prompt.ts`:**
- `buildSystemPrompt` accepts `persona?: Persona`
- Prepends persona prefix to system prompt
- Static prefix + persona prefix + session prefix = complete prompt

**Modify `src/app.tsx`:**
- Add `currentPersona` state (default: `"generalist"`)
- Before each `runAgentTurn`, rebuild prefix messages with current persona
- After turn completes, check `result.personaSwitch`
- If switch requested, update `currentPersona`, show info event:
  > "Switching to research persona"
- Show current persona in status bar (next to mode)
- Add `/persona <name>` slash command

**Modify `src/ui/help-menu.tsx`:**
- Remove multi-agent toggle
- Add persona info

### Phase 4: Session Persistence & Resume (Single PR)

**Modify `src/sessions.ts`:**
- Add `persona?: Persona` to `SessionFile`
- Save current persona on session save
- Restore persona on resume

**Migration:**
- Old sessions without `persona` field default to `"generalist"`
- Old sessions with `multiAgentState` are ignored (the field is already optional)

### Phase 5: Polish & Guardrails (Single PR)

1. **Budget checks in research persona:** Keep existing soft/hard budget checks in `loop.ts` but tighten them for research persona (soft=3, hard=8 instead of 5/15).
2. **Web-fetch spiral guardrail:** Already exists in `loop.ts`. Keep it.
3. **Anti-loop guardrail:** Already exists. Keep it.
4. **Update docs/guardrails:** Remove multi-agent specific rules. Add persona rules.
5. **Update `docs/learnings/README.md`:** Add entry for this redesign.

---

## 5. File-by-File Change Summary

| File | Action | Details |
|------|--------|---------|
| `src/agent/loop.ts` | Modify | Return `TurnResult`, filter tools by persona, detect `[persona:X]` marker |
| `src/agent/system-prompt.ts` | Modify | Accept `persona`, prepend persona prefix, remove `hand_off` text |
| `src/agent/persona.ts` | **Create** | Persona definitions, tool filters, switch detection |
| `src/agent/orchestrator.ts` | **Delete** | |
| `src/agent/agent-session.ts` | **Delete** | |
| `src/agent/intent-classifier.ts` | **Delete** | |
| `src/tools/hand-off.ts` | **Delete** | |
| `src/config.ts` | Modify | Remove multi-agent config fields |
| `src/sessions.ts` | Modify | Add `persona` field, remove `multiAgentState` |
| `src/app.tsx` | Modify | Persona state, rebuild prompts, show persona in UI, slash command |
| `src/ui/help-menu.tsx` | Modify | Remove multi-agent toggle, add persona info |
| `docs/multi-agent-plan.md` | **Delete/Archive** | |
| `docs/plans/multi-agent-redesign.md` | **Create** | This document |
| `docs/guardrails/README.md` | Modify | Replace multi-agent rules with persona rules |

---

## 6. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Model ignores `[persona:X]` marker | Medium | System prompt explicitly teaches the marker. Fallback: user can force via `/persona`. |
| Model switches persona too often | Low | Generalist prompt says "When in doubt, route" — but routing now means emitting a marker, not a full handoff. Cheap. |
| Research persona still spirals | Low | Tool filter prevents writes. Budget checks tightened. Web-fetch guardrail stays. |
| Users miss the old multi-agent | Low | Feature was behind flag, default false. No breaking change for default users. |
| Session loss for existing multi-agent users | Medium | Users with `multiAgent: true` will lose in-flight sessions. Acceptable — flag was experimental. |
| TypeScript strictness regressions | Low | `npm run typecheck` in CI. All deleted files have tests that must be deleted too. |

---

## 7. Acceptance Criteria

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] Single-agent mode works identically to before (regression test)
- [ ] Persona switch is visible in TUI (status bar or info event)
- [ ] Research persona cannot call `write`/`edit`/`bash` even in `auto` mode
- [ ] Tool iteration limit shows friendly info message, not red error
- [ ] "go on" continues seamlessly from paused turn
- [ ] Session save/resume preserves persona
- [ ] Image understanding works across persona switches
- [ ] Compiled context + artifact recall works across persona switches
- [ ] Agent memory recall/injection works across persona switches
- [ ] Code mode works across persona switches
- [ ] LSP + MCP tools work across persona switches
- [ ] No `AgentOrchestrator`, `AgentSession`, `intent-classifier`, or `hand_off` references remain in codebase

---

## 8. Open Questions

1. **Should we keep `customAgents`?** The config field lets users define arbitrary agents. In the persona model, this would be custom personas. Suggest: drop for now. Re-add later as custom persona definitions if requested.

2. **Should the model be able to switch back to generalist automatically?** Yes — the coding persona's system prompt should instruct it to switch back to generalist when implementation is complete and it needs to present results to the user.

3. **Per-persona models?** The old system had `agentModels` (research could use a different model than coding). In the unified model, this is harder because it's one turn at a time. Suggest: defer. Use the global model for all personas. The model is capable enough to wear different hats.

4. **What about the `/agent` slash command?** Repurpose as `/persona research|coding|generalist`. Force-switch for user control.

---

## 9. Conclusion

The current multi-agent architecture is a failed experiment. It added 1,500+ lines of complex orchestration code that broke more than it fixed. The unified persona model achieves the same goal — specialized behavior for research vs coding — with ~200 lines of new code and the deletion of ~1,000 lines of fragile orchestration.

**The user gets specialists. The developers get simplicity. The codebase gets coherence.**
