# Research: Missing Superpowers in Heavy Explorer Mode

> Date: 2026-05-05
> Scope: Compare `runAgentTurn` architecture in heavy exploration vs. other modes
> Method: Code audit of `src/app.tsx`, `src/agent/loop.ts`, `src/agent/compaction.ts`, `src/index.tsx`, `src/intent/classify.ts`

---

## 1. The Core Bug

**`runAgentTurn` runs an internal `while (true)` loop (up to 50 iterations) with no auto-compaction.**

In `src/agent/loop.ts` lines 136-523, each iteration:
1. Calls the LLM with the full `opts.messages` array
2. Appends the assistant response + tool results back to `opts.messages`
3. Loops again if there are more tool calls

In `src/app.tsx` lines 2745-2831, auto-compact **only runs after `runAgentTurn` returns**:

```typescript
await runAgentTurn({ ... });          // ← internal while loop grows messages
// Auto-compact after turn when thresholds are met
if (shouldCompact({ messages: messagesRef.current })) {
  // ... compact logic
}
```

During heavy exploration, the agent can issue 20-40+ sequential `read`/`glob`/`grep` calls inside a single `runAgentTurn`. The message array grows linearly with each iteration. Since compaction only happens after the turn completes, the context window overflows mid-turn.

**Evidence from user session:**
- Context reached 93% full with warnings `"run /compact to summarize older turns"`
- Final error: `264685 tokens exceeded 262144 context window limit`
- The `/compact` suggestion was emitted from `onUsage` callback (line 2919 in app.tsx), but auto-compact never fired because `runAgentTurn` was still running its internal loop.

---

## 2. Superpower Inventory: What Works vs. What's Missing

### 2.1 Superpowers that WORK inside `runAgentTurn`'s internal loop

| Feature | Location | Status |
|---------|----------|--------|
| **Code Mode** (`execute_code` sandbox) | `loop.ts:79-114, 408-453` | ✅ Active for all `tier === "heavy"` |
| **Image stripping** (`keepLastImageTurns`) | `loop.ts:213-215` | ✅ Passed from `app.tsx` |
| **Reasoning stripping** (`stripHistoricalReasoning`) | `loop.ts:182-211` | ✅ Controlled via env var |
| **Memory auto-extraction** | `loop.ts:471-498` | ✅ Extracts memories from tool results |
| **LSP document sync** (`onFileChange`) | `loop.ts:459` | ✅ Passed through executor context |
| **Task updates** (`onTasks`) | `loop.ts:417, 458` | ✅ Passed through executor context |
| **Web-fetch anti-loop** (max 5/turn, domain threshold) | `loop.ts:351-406` | ✅ Hardcoded guardrail |
| **Tool iteration anti-loop** (8-window, threshold 2) | `loop.ts:327-349` | ✅ Hardcoded guardrail |
| **Budget exhaustion** (`BudgetExhaustedError`) | `loop.ts:139-146, 520-522` | ✅ Works if `maxInputTokens` is set |

### 2.2 Superpowers MISSING inside `runAgentTurn`'s internal loop

| # | Missing Superpower | Why It Matters | Where It Lives (outside the loop) |
|---|-------------------|----------------|-----------------------------------|
| **1** | **Auto-compaction** | Messages grow unbounded during multi-iteration exploration | `app.tsx:2748-2804` — `shouldCompact()` + `compactCompiled()` / `compactMessages()` |
| **2** | **Compiled context / artifact recall** | Long explorations lose durable anchors; old turns aren't collapsed into `SessionState` | `app.tsx:2574-2584` (recall before turn), `app.tsx:2749-2768` (compact into artifacts after turn) |
| **3** | **Memory recall** | Agent can't inject relevant past memories mid-exploration | `app.tsx:2806-2831` — recall happens only after compaction |
| **4** | **Context limit awareness** | No proactive check against `CONTEXT_LIMIT = 262_000` | `app.tsx:384` — known only in TUI layer |
| **5** | **Budget enforcement** (`maxInputTokens`) | No cumulative token cap to force early synthesis | `AgentTurnOpts:57` — exists but **never passed from `app.tsx`** in TUI mode |
| **6** | **Continue-on-limit** (`continueOnLimit`) | Hitting 50 iterations throws hard error instead of gracefully resetting | `AgentTurnOpts:55` — exists but **never passed from `app.tsx`** in TUI mode |

### 2.3 Key insight: The architectural boundary

`runAgentTurn` is designed as a **stateless turn executor**. It receives:
- `messages: ChatMessage[]` (mutable array it appends to)
- `memoryManager?: MemoryManager` (only for auto-extraction, not recall)
- `codeMode?: boolean` (enables sandbox)

It does NOT receive:
- `sessionState: SessionState` or `artifactStore: ArtifactStore` (compiled context)
- `contextLimit: number` (for proactive management)
- `maxInputTokens: number` (not passed from TUI)
- `continueOnLimit: boolean` (not passed from TUI)
- Any compaction callback or threshold

This means **all context-management superpowers live in `app.tsx` and are applied between turns, never within a turn.**

---

## 3. How Other Modes Avoid This

### 3.1 Light / Medium tasks
These typically resolve in 1-3 tool iterations. The internal loop doesn't run long enough to overflow context. Auto-compact after the turn is sufficient.

### 3.2 Print mode (`src/index.tsx`)
```typescript
await runAgentTurn({
  // ...
  continueOnLimit: opts.continueOnLimit,      // ← CAN be set
  maxInputTokens: opts.maxInputTokens,        // ← CAN be set
});
```
Print mode has CLI flags for these, but TUI mode does not. More importantly, print mode still has **no auto-compact at all** — it simply doesn't use the TUI's compaction pipeline.

### 3.3 `/init` command
Uses the same `runAgentTurn` call as normal messages (line 1455 in `app.tsx`). Same problem if `/init` triggers heavy exploration.

---

## 4. Root Cause Analysis

**Why this happened:**

When the team reverted from multi-agent orchestration back to single-agent `runAgentTurn` for heavy exploration, they correctly preserved the **entry point** (`app.tsx` calling `runAgentTurn` with `codeMode: true`) but forgot that `runAgentTurn` was originally designed for **short turns** (1-5 iterations). 

The original v0 single-agent system worked because:
1. Turns were naturally short (the agent would synthesize and return to user)
2. The user would then send another message, triggering the between-turn auto-compact

Heavy exploration breaks this assumption because:
1. The agent enters a deep research spiral (read → grep → read → read → ...)
2. It stays inside `runAgentTurn`'s while loop for 10-20+ minutes
3. No external force can compact the growing message history

---

## 5. Recommended Fixes (Prioritized)

### P0: Auto-compact inside `runAgentTurn`'s loop
**Option A:** Pass compaction primitives into `runAgentTurn`:
```typescript
interface AgentTurnOpts {
  // ... existing ...
  onIterationEnd?: (messages: ChatMessage[]) => Promise<ChatMessage[]>; // ← compact hook
  contextLimit?: number;      // ← 262000
  tokenThreshold?: number;    // ← 80000
}
```

**Option B:** Move the while loop out of `runAgentTurn` and into `app.tsx`, making each iteration a separate `runAgentTurn` call. This is architecturally cleaner but a larger refactor.

### P1: Pass `maxInputTokens` and `continueOnLimit` from TUI
These options exist in `AgentTurnOpts` but are only used in print mode. For heavy exploration:
- `maxInputTokens` should probably default to something like `200_000` (not the full 262k, leaving headroom)
- `continueOnLimit` should be `true` for heavy tasks so the 50-iteration limit doesn't hard-throw

### P2: Compiled context inside the loop
`runAgentTurn` needs awareness of `SessionState` and `ArtifactStore` to:
1. Extract artifacts from completed iterations
2. Recall relevant artifacts before subsequent iterations

This could be done by passing `sessionState` and `artifactStore` into `AgentTurnOpts`, or by calling a callback after each iteration.

### P3: Memory recall inside the loop
Currently `memoryManager` is only used for auto-extraction. It should also be used for recall — perhaps every N iterations, or when the task context shifts (detected via tool call patterns).

---

## 6. Summary Table

| Superpower | Light/Medium Mode | Heavy Explorer Mode | Gap |
|-----------|-------------------|---------------------|-----|
| Auto-compact | ✅ After turn | ❌ Never during long turns | **Critical** |
| Code mode | ❌ No | ✅ Yes | Working |
| Memory extraction | ✅ Yes | ✅ Yes | Working |
| Memory recall | ✅ After compact | ❌ Only after turn ends | **High** |
| Compiled context | ✅ Before/after turn | ❌ No artifact mgmt inside loop | **High** |
| Context limit guard | ✅ Suggest `/compact` | ❌ Suggestion ignored during loop | **Critical** |
| Budget enforcement | ❌ Not set | ❌ Not set | **Medium** |
| Continue-on-limit | ❌ Not set | ❌ Not set | **Medium** |
| Image stripping | ✅ Yes | ✅ Yes | Working |
| Reasoning stripping | ✅ Yes | ✅ Yes | Working |
| LSP sync | ✅ Yes | ✅ Yes | Working |
| Task tracking | ✅ Yes | ✅ Yes | Working |
| Anti-loop guardrails | ✅ Yes | ✅ Yes | Working |

---

## 7. Files to Modify

1. **`src/agent/loop.ts`** — Add compaction hook, context limit check, or iteration callback
2. **`src/app.tsx`** — Pass `maxInputTokens`, `continueOnLimit`, and a compaction callback to `runAgentTurn`
3. **`src/agent/compaction.ts`** — Ensure `shouldCompact` and `compactMessages` can be called safely mid-session
4. **`src/agent/session-state.ts`** — Potentially expose `ArtifactStore` operations for mid-turn use

---

*End of research report.*
