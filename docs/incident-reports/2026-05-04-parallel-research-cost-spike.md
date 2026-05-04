# Incident Report: Parallel Research Cost Spike

**Date:** 2026-05-04  
**Severity:** High (financial impact — ~$70 in unexpected API spend)  
**Status:** Resolved (fixes merged)  
**Related PR:** `feat: implement phase five — parallel research agents (#253)` (commit `4ab70a2`)

---

## Summary

On 2026-05-04, two user sessions exhibited massive token usage spikes attributed to the newly merged "parallel research agents" feature:

| Session | Prompt Tokens | Cost | Saved Messages |
|---------|--------------|------|----------------|
| 11:44 UTC | ~22.4M | $21.74 | 51 |
| 11:59 UTC | ~48.4M | $48.48 | 4 |

The root cause was a combination of five bugs in the parallel research implementation, the most severe being **double-counting of SSE usage events**.

---

## Root Causes

### 1. Usage Double-Counting (Critical)

**File:** `src/agent/research.ts`  
**Lines:** 174-178

Cloudflare's SSE stream emits a `usage` event on **every chunk**, not just the final one. The sub-agent loop accumulated these values:

```typescript
// BROKEN — accumulated every chunk
case "usage":
  totalUsage.prompt_tokens += ev.usage.prompt_tokens;
  totalUsage.completion_tokens += ev.usage.completion_tokens;
  totalUsage.total_tokens += ev.usage.total_tokens;
  break;
```

Since the final chunk contains the true totals, this caused usage to be multiplied by the number of SSE chunks (often 100× or more).

**Fix:** Overwrite instead of accumulate.

### 2. Empty Summaries at Iteration Limit

**File:** `src/agent/research.ts`  
**Lines:** 226-229

When a sub-agent hit its 8-iteration limit while still holding pending `tool_calls`, the fallback summary was:

```typescript
const summary = typeof lastAssistant?.content === "string" ? lastAssistant.content : "";
```

If `content` was `null` (tool_calls only), the summary became `""`. The synthesis step then received empty input, producing useless output and potentially triggering more parallel research rounds.

**Fix:** Add a descriptive fallback when the last assistant message has no text content.

### 3. Broken File Discovery Heuristic

**File:** `src/agent/research.ts`  
**Line:** 60

```typescript
const grepResult = await grepTool.run(
  { pattern: query.split(/\s+/).slice(0, 3).join("|"), ... }
);
```

For a query like *"investigate a massive token spike"*, this produced the regex `investigate|a|massive`. The word `"a"` matched nearly every file in the repository, causing `discoverFiles` to return 100 files (the cap). This maximized the number of files fed to sub-agents, inflating token usage.

**Fix:** Filter out short words (<4 chars) and common stop words. Use up to 5 meaningful keywords.

### 4. Usage-Display Race Condition

**File:** `src/app.tsx`  
**Lines:** 2756-2757

```typescript
void recordUsage(sid, researchResult.usage, ...);
void getCostReport(sid).then((report) => setSessionUsage(report.session));
```

Both calls were fire-and-forget. `getCostReport` frequently read the usage log before `recordUsage` finished writing, causing the status bar to show stale or zero session usage after parallel research.

**Fix:** `await recordUsage(...)` before calling `getCostReport(...)`.

### 5. Missing Cost-Debug Logging

Parallel research turns were completely invisible in `cost-debug.jsonl`. There was no way to know after the fact how many sub-agents were spawned, how many files were explored, or what the sub-agent summaries were.

**Fix:** Add `logParallelResearchDebug()` to `cost-debug.ts` and call it from `app.tsx` after each parallel research turn.

---

## Impact

- **Financial:** ~$70 in unexpected API spend across two sessions.
- **User Experience:** Status bar showed impossible context percentages (`ctx 18472%`) because `usage` (from parallel research) and `sessionUsage` (from `getCostReport`) were out of sync.
- **Observability:** No telemetry existed to determine how many sub-agents were spawned in the affected sessions.

---

## Fixes Applied

All fixes were implemented on branch `fix/parallel-research-cost-bugs`:

1. `fix(research): overwrite SSE usage instead of accumulating`
2. `fix(research): provide fallback summary when sub-agent hits iteration limit`
3. `fix(research): improve file-discovery keyword heuristic`
4. `fix(app): await recordUsage before getCostReport after parallel research`
5. `feat(cost-debug): add logParallelResearchDebug helper`
6. `feat(app): log parallel research turns to cost-debug`

---

## Lessons Learned

1. **SSE usage events are not additive.** Always treat the last `usage` event as the source of truth.
2. **Heuristics need guardrails.** A simple word-splitting heuristic without stop-word filtering can match the entire repository.
3. **Fire-and-forget writes create races.** When a read depends on a write, always sequence them with `await`.
4. **New features need telemetry from day one.** If we had logged sub-agent counts, we could have diagnosed this in minutes instead of hours.
5. **Integration tests should assert on usage bounds.** A test that verifies parallel research usage stays within a reasonable multiple of a single-turn baseline would have caught the double-counting immediately.

---

## Action Items

- [x] Fix usage double-counting
- [x] Fix empty summary fallback
- [x] Fix file discovery heuristic
- [x] Fix usage-display race
- [x] Add parallel research telemetry
- [ ] Add integration test asserting parallel research usage ≤ 2× single-turn usage for same query
- [ ] Add cost-alert guardrail if a single turn exceeds $1.00
