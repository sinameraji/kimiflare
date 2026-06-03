# Feature: `/fresh` command + Resume Fresh mode

## Background

When users spend significant time in **plan mode**, KimiFlare researches, explores files, and produces a detailed execution plan. By the time the plan is ready, the session has accumulated a large amount of context (tool results, web fetches, reasoning traces, file reads). Switching to `auto` or `edit` mode to execute the plan carries all this baggage forward, which:

1. **Slows the model down** — Kimi-K2.6 degrades in speed and quality with very long contexts
2. **Wastes tokens** — intermediate research results are rarely needed during execution
3. **Dilutes attention** — the model may get distracted by old research rather than focusing on the plan

Users currently work around this manually by copying the plan, quitting KimiFlare, reopening it, and pasting the plan into a fresh session.

## Proposed Solution

### Phase 1: `/fresh` command (PR #1)

A single slash command that productizes the manual workaround:

```
User: /fresh
KimiFlare: Plan copied to clipboard. Starting fresh session with plan only…
[session resets, plan appears as first user message, ready to build]
```

**Behavior:**
1. Extract the last assistant message (the plan)
2. Copy it to the system clipboard
3. Reset the session (clear messages, events, artifacts, usage, turn counter)
4. Seed the new session with just the plan as the first user message
5. Surface confirmation to the user

**Edge cases:**
- No assistant message found → error: "No plan found to start fresh with."
- Clipboard unavailable → still reset and seed; inform user to paste manually
- Busy mid-turn → block with same guard as `/clear`

### Phase 2: Resume Fresh mode (PR #2 — future)

Extend the same distillation logic to `/resume`. When a user resumes an old session, offer two choices:

```
/resume
├─ Pick session: "Add OAuth flow (#47 msgs, 3 checkpoints)"
   ├─ [Resume full]      ← current behavior
   ├─ [Resume fresh]     ← new: distill plan, start clean
   └─ [Pick checkpoint]  ← existing behavior
```

**Why this matters even more for resume:**
- Fresh plan → `/fresh`: ~5-15 turns of research
- Resume old session: could be 50+ turns, days of work, hundreds of tool calls
- The token bloat and quality degradation is **significantly worse** for resumed sessions

## Implementation Notes

### Reusable core: `distillSessionPlan()`

PR #1 should extract the distillation logic into a pure, testable function:

```ts
// src/agent/distill.ts
export function distillSessionPlan(messages: ChatMessage[]): string | null;
```

This function:
- Scans messages in reverse to find the last assistant message with substantive content
- Strips reasoning traces and tool-call metadata
- Returns clean plan text, or `null` if no suitable plan found

PR #2 will reuse this exact function in the resume flow.

### Files touched

| File | PR #1 | PR #2 |
|------|-------|-------|
| `src/commands/builtins.ts` | Add `"fresh"` | — |
| `src/util/clipboard.ts` | **New** — cross-platform clipboard writer | — |
| `src/agent/distill.ts` | **New** — `distillSessionPlan()` | Reused |
| `src/ui/slash-commands.ts` | Add `handleFresh` | Extend `handleResumePick` |
| `src/app.tsx` | Wire through `SlashContext` | Add resume-mode picker |
| `src/mode.ts` | Optional nudge on plan→auto switch | — |

## Acceptance Criteria

### PR #1
- [ ] `/fresh` appears in `/help` and slash-command picker
- [ ] Running `/fresh` copies the last assistant message to clipboard
- [ ] Session is reset (messages cleared, artifacts cleared, usage reset)
- [ ] New session is seeded with the plan as first user message
- [ ] Confirmation event is shown to user
- [ ] Blocked when model is busy (same as `/clear`)
- [ ] Graceful fallback when clipboard tool is unavailable
- [ ] Unit tests for `distillSessionPlan()`

### PR #2
- [ ] `/resume` offers "Resume fresh" option for sessions above message threshold
- [ ] "Resume fresh" uses `distillSessionPlan()` then resets + seeds
- [ ] "Resume full" preserves current behavior exactly
- [ ] Threshold is configurable or sensibly defaulted (e.g., 20 non-system messages)

## Related

- User workflow: plan mode → research → `/fresh` → auto mode → execute
- Complements `/compact` (which summarizes but still carries history)
- Distinct from `/clear` (which wipes everything without preserving the plan)
