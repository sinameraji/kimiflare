# Multi-Agent System Implementation Plan

**Status:** All Phases Complete — Ready for Merge Review (Single PR #220)  
**Feature Flag:** `multiAgent` (default: `false`)  
**Env Override:** `KIMIFLARE_MULTI_AGENT=1`  
**Branch:** `feat/multi-agent-system`

> ⚠️ **Single-PR Strategy:** All 4 phases will be implemented in PR #220 before merging. Do not merge until the "Merge Readiness Checklist" at the bottom is 100% complete.

---

## Architecture Overview

The multi-agent system introduces specialized agents with isolated message buffers and tool subsets, coordinated by an `AgentOrchestrator`. The single-agent path is preserved when the feature flag is off.

### Agent Roles

| Role | Purpose | Tools | Mutating? |
|------|---------|-------|-----------|
| `plan` | Exploration, research, architecture | `read`, `grep`, `glob`, `lsp_*`, `web_fetch`, `tasks_set`, `memory_recall` | ❌ Read-only |
| `build` | Implementation, editing, testing | `read`, `write`, `edit`, `bash`, `lsp_*`, `memory_remember`, `memory_recall` | ✅ Full |
| `general` | Chat, Q&A, light coordination | `tasks_set`, `web_fetch`, `memory_remember`, `memory_recall`, `memory_forget` | ⚠️ Limited |

### Key Components

- **`AgentSession`** (`src/agent/agent-session.ts`) — Per-agent message buffer + anti-loop state
- **`AgentOrchestrator`** (`src/agent/orchestrator.ts`) — Routing, hand-off synthesis, per-agent compaction
- **Config additions** (`src/config.ts`) — `multiAgent`, `agentModels`, `agentReasoningEffort`, `orchestratorModel`
- **Session persistence** (`src/sessions.ts`) — Extended format with `multiAgentState`
- **Cost tracking** (`src/usage-tracker.ts`, `src/cost-debug.ts`) — Per-agent role attribution

---

## Phases

### Phase 1: Foundation + Manual Switching ✅ COMPLETE

**Goal:** Core infrastructure with user-controlled agent switching.

**Deliverables:**
- [x] `AgentSession` abstraction with per-agent tool subsets
- [x] `AgentOrchestrator` with hand-off synthesis (plumbing model)
- [x] `/agent plan|build|general|status` slash commands
- [x] Secret redaction in hand-off summaries
- [x] Per-agent anti-loop guard (`recentToolCalls` in `AgentSession`)
- [x] Per-agent compaction via `shouldCompact()`
- [x] Session persistence extended with `multiAgentState`
- [x] Per-agent cost tracking (`agentRole` field)
- [x] Config validation for `agentModels` via `validateModelId()`
- [x] Feature flag hygiene (default `false`, graceful degradation)
- [x] Tests: `agent-session.test.ts`, `orchestrator.test.ts`, `config.test.ts`

**Limitations:**
- Manual switching only (no automatic routing)
- No forced hand-off after turn limits
- No custom agent definitions
- Orchestrator model defaults to plumbing model
- `agentModels` config field exists but is unused in orchestrator

---

### Phase 2: Automatic Orchestration ✅ COMPLETE

**Goal:** The system decides which agent should handle each turn based on intent classification.

**Deliverables:**
- [x] Intent classifier (`src/agent/intent-classifier.ts`) — heuristic (LLM fallback deferred to Phase 4)
- [x] Auto-switching logic in `AgentOrchestrator.runTurn()`
- [x] `/agent auto` toggle command
- [x] Forced hand-off after configurable turn limit (default: 20)
- [x] User confirmation for auto-switches (`autoSwitchConfirm` + `onAutoSwitchSuggestion` callback)
- [x] Wire `agentModels[role]` into `runAgentTurn()`
- [x] Error handling in `synthesizeHandoff()` with fallback to raw transcript
- [x] Tests for intent classifier and auto-switching

**Implementation Notes:**
- Intent classifier should be lightweight (heuristic first, LLM fallback only for ambiguous cases)
- Keywords: "explore", "research", "find", "understand" → plan; "implement", "fix", "add", "write" → build
- Auto-switch should only trigger on user messages, not assistant continuations
- Forced hand-off counter resets on explicit `/agent` command

---

### Phase 3: Integrations ✅ COMPLETE

**Goal:** Multi-agent awareness in existing features.

**Deliverables:**
- [x] **Compiled context** (`compiledContext`): per-agent artifact stores
- [x] **Memory**: `memory_remember` tags memories with agent role; recall filters by role
- [x] **Cost attribution**: category mapping (`plan` → `exploring-codebase`, `build` → `editing-source-code`)
- [x] **LSP**: agent-specific LSP tool subsets (already partially done via tool lists)
- [x] **Code mode**: per-agent API generation (plan agent gets read-only API) — already works via `opts.tools` filtering

---

### Phase 4: Advanced Features ✅ COMPLETE

**Goal:** Power-user features and extensibility.

**Deliverables:**
- [x] **Custom agents**: user-defined roles in config (`customAgents: [{ name, tools, model, systemPrompt }]`)
- [ ] **Parallel agents**: plan + build running concurrently — *deferred to future release*
- [x] **Agent replay**: re-run a specific agent's turns with different model/effort
- [x] **Diff view**: compare outputs between agents
- [x] **Agent metrics dashboard**: token usage, latency, cache hit ratio per role

---

## Handoff Notes for Next Agent

### Start Here

1. Read this doc fully — it is the source of truth
2. **All 4 phases are DONE.** This branch is ready for merge review.
3. All work stays on branch `feat/multi-agent-system` — do not create new branches

### Files: Finished (Don't Touch Without Discussion)

| File | Status | Why |
|------|--------|-----|
| `src/agent/agent-session.ts` | ✅ Complete | Clean abstraction, per-agent artifact stores, dynamic roles |
| `src/agent/agent-session.test.ts` | ✅ Complete | Covers tool subsets, determinism, session creation |
| `src/agent/intent-classifier.ts` | ✅ Complete | Heuristic keyword classification with tie-breaking |
| `src/agent/intent-classifier.test.ts` | ✅ Complete | Covers plan/build/general classification, thresholds |
| `src/agent/orchestrator.ts` | ✅ Complete | Auto-routing, custom agents, replay, diff, metrics, error handling |
| `src/agent/orchestrator.test.ts` | ✅ Complete | Auto-switching, forced hand-off, error recovery tests |
| `src/config.ts` | ✅ Complete | All multi-agent fields + customAgents validation |
| `src/config.test.ts` | ✅ Complete | Model validation tests |
| `src/sessions.ts` | ✅ Complete | `multiAgentState` with per-agent artifact stores |
| `src/usage-tracker.ts` | ✅ Complete | `agentRole` field added |
| `src/cost-debug.ts` | ✅ Complete | `agentRole` field added |
| `src/memory/manager.ts` | ✅ Complete | `redactSecrets` exported, agent role tagging, recall filtering |
| `src/memory/schema.ts` | ✅ Complete | `agentRole` field added |
| `src/memory/db.ts` | ✅ Complete | `agent_role` column with migration |
| `src/memory/retrieval.ts` | ✅ Complete | `agentRole` filter in retrieval |
| `src/tools/registry.ts` | ✅ Complete | `agentRole` in ToolContext |
| `src/tools/memory.ts` | ✅ Complete | Passes `agentRole` to remember/recall |
| `src/cost-attribution/types.ts` | ✅ Complete | `exploring-codebase` category, `AgentMetricsEntry` |
| `src/cost-attribution/heuristic.ts` | ✅ Complete | Agent role signal in classification |
| `src/cost-attribution/classify-from-session.ts` | ✅ Complete | Accepts `agentRole` parameter |
| `src/cost-attribution/cli.ts` | ✅ Complete | Passes `agentRole` from usage log |
| `src/cost-attribution/report.ts` | ✅ Complete | Per-agent metrics aggregation |
| `src/cost-attribution/renderer.ts` | ✅ Complete | Per-agent metrics table rendering |
| `src/app.tsx` | ✅ Complete | `/agent auto/replay/diff` commands, custom agent switching |

### Known Debt / Traps

1. **Resume path creates a dummy orchestrator with no-op callbacks**
   - In `handleResumePick`, a dummy orchestrator is instantiated just to call `deserialize()`
   - This is wasteful but harmless — could be refactored to a static method

2. **`orchestratorModel` is not validated**
   - If user sets an invalid model ID, it crashes at runtime during hand-off
   - Fix: Add validation in `loadConfig()` alongside `agentModels` validation

3. **LLM fallback for intent classifier**
   - Currently heuristic only; LLM fallback mentioned in plan but deferred
   - Can be added in a future release if ambiguity becomes a real problem

4. **SessionState is still global in multi-agent mode**
   - `sessionStateRef` in `app.tsx` is shared across all agents
   - For full isolation, each agent should have its own `SessionState`
   - Deferred as it requires broader refactoring

5. **Parallel agents not implemented**
   - Plan + build running concurrently was deferred
   - The current architecture supports it but the TUI event loop would need significant changes

### Testing Strategy

```bash
# Run all tests after every change
npm run typecheck && npm run build && npm test

# Test multi-agent manually
KIMIFLARE_MULTI_AGENT=1 npm run dev
# Then: /agent plan → ask something → /agent build → ask something
```

### Code Style Reminders

- ESM only, `.js` extensions in imports
- `node:` prefix for built-ins
- TSX extension even for non-JSX files
- Strict TS: `noUncheckedIndexedAccess`, `noImplicitOverride`
- Export functions before use (no hoisting reliance)
- Use `??` for defaults, not `||`

---

## Performance Benchmarks (Target)

| Scenario | Single-Agent | Multi-Agent (Phase 1) | Improvement |
|----------|-------------|----------------------|-------------|
| 10-turn exploration + 5-turn implementation | All 25 tools in prompt for 15 turns | 16 tools (plan) × 10 + 14 tools (build) × 5 | ~30% fewer prompt tokens |
| Cache stability | System prompt changes on mode/tool changes | Static prefix identical per role | Higher cache hit ratio |
| Context window | All turns in one buffer | Compaction per agent buffer | Less frequent compaction |

---

## Guardrail Checklist

| Guardrail | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|-----------|---------|---------|---------|---------|
| CRIT-1 TypeScript strict | ✅ | ✅ | ✅ | ✅ |
| CRIT-2 Tests | ✅ | ✅ | ✅ | ✅ |
| CRIT-3 Build | ✅ | ✅ | ✅ | ✅ |
| CRIT-6 Cache stability (sorted tools) | ✅ | — | — | — |
| CRIT-7 CLI entry point unchanged | ✅ | ✅ | ✅ | ✅ |
| HP-1 Token efficiency | ✅ | — | — | — |
| HP-2 Agent loop safety | ✅ | ✅ | ✅ | ✅ |
| HP-4 Data integrity (additive format) | ✅ | ✅ | ✅ | ✅ |
| SEC-1 Secret redaction | ✅ | ✅ | ✅ | ✅ |
| CFG-1 Backward compatibility | ✅ | ✅ | ✅ | ✅ |

---

## Merge Readiness Checklist (DO NOT MERGE UNTIL 100%)

- [ ] Phase 1 complete ✅
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] All tests pass (`npm test`)
- [ ] TypeScript clean (`npm run typecheck`)
- [ ] Build succeeds (`npm run build`)
- [ ] Manual end-to-end test passes
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Guardrail review passed

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-30 | Single PR for all phases | User request; avoids partial merges and keeps review focused |
| 2026-04-30 | Manual switching for Phase 1 | Automatic routing is complex; manual gives users control while we validate infrastructure |
| 2026-04-30 | Plan agent excludes `bash` | True read-only enforcement via tool subset, not permission layer |
| 2026-04-30 | Orchestrator uses plumbing model | Hand-off summaries are internal plumbing; keeps cost low |
| 2026-04-30 | `recentToolCalls` per `AgentSession` | Anti-loop guard must be isolated per agent |
| 2026-04-30 | Sorted arrays (not Sets) for tool subsets | Deterministic ordering for cache-stable prompt prefixes |

---

## Related Documents

- `docs/guardrails/README.md` — Guardrail framework
- `docs/guardrails/scoring-rubric.md` — Scoring criteria
- `docs/learnings/2026-04-27-agent-system-integration.md` — Prior agent system research
- GitHub Issue #185 — Original multi-agent proposal
