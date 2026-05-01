# Incident Report: Multi-Agent Session Resume Regression

**Date:** 2026-05-01  
**Reporter:** kimiflare (coding agent)  
**Branch:** `fix/multi-agent-resume-context`  
**Affected Versions:** 0.29.0  
**Severity:** High — breaks core user workflow (`/resume`) for all legacy sessions when multi-agent is enabled; also breaks auto-compact and system prompt injection for ALL multi-agent sessions  
**Status:** Fix implemented, pending merge

---

## 1. Executive Summary

PR #220 ("multi-agent system with specialized plan/build/general agents") introduced **three interrelated regressions** in the multi-agent feature:

1. **Legacy session resume loses context** — resuming a session created prior to 0.29.0 (or any session without `multiAgentState`) causes the model to lose all conversation context. The user sees a brief "thinking" phase followed by either no output or a confused response ("what are you?"), as if the session had never existed.

2. **New multi-agent sessions lack system messages entirely** — built-in agents (`research`, `coding`, `generalist`) are created with empty message buffers (`messages: []`). The orchestrator never injects the system prompt into these buffers. This means every multi-agent session runs without the system prompt that defines tools, conventions, and behavior.

3. **Auto-compact crashes with "no system message found"** — `compactMessages` throws if there are no leading system messages. Because of Bug 2, all multi-agent sessions eventually hit the compact threshold and crash with this error.

The root cause of Bug 1 was a missing backward-compatibility migration path: when multi-agent mode is enabled, the `AgentOrchestrator` operates on per-agent message buffers, but legacy sessions only store a flat `messages` array. The resume logic only hydrated the orchestrator when `file.multiAgentState` was present, leaving legacy sessions with empty per-agent buffers.

A secondary issue in Bug 1: the orchestrator instantiated during resume was created with no-op callbacks, meaning that even if the buffers had been seeded correctly, UI updates (streaming text, tool calls, usage) would not have rendered.

---

## 2. Timeline

| Date | Event |
|------|-------|
| 2026-04-30 | PR #220 merged into main; released as v0.29.0 |
| 2026-04-30 | User reports `/resume` + multi-agent context loss |
| 2026-05-01 | Investigation confirms: legacy sessions lack `multiAgentState`; orchestrator starts empty |
| 2026-05-01 | Fix implemented on `fix/multi-agent-resume-context` |
| 2026-05-01 | User reports "auto-compact failed: compact: no system message found" during multi-agent use |
| 2026-05-01 | Investigation reveals: built-in agents start with `messages: []`, no system prompt ever injected |
| 2026-05-01 | Additional fixes for missing system messages and compact crash resilience added |

---

## 3. Root Cause Analysis

### 3.1 The Code Path

In `src/app.tsx`, `handleResumePick` (the `/resume` handler) contained this gate:

```ts
if (file.multiAgentState && cfg?.multiAgent) {
  // create orchestrator + deserialize
}
```

For sessions created before v0.29.0, `file.multiAgentState` is `undefined`. The block was skipped entirely. Later, when the user sent a follow-up message, `processMessage` created a **fresh** `AgentOrchestrator` with empty per-agent buffers. The model received only the new user message, with zero historical context.

### 3.2 The Callback Stalemate

Even if the gate had been widened to `if (cfg?.multiAgent)`, the orchestrator created inside `handleResumePick` was initialized with no-op callbacks (empty lambdas for `onTextDelta`, `onToolCallStart`, etc.). `processMessage` only creates a new orchestrator when `!orchestratorRef.current`, so it would have reused the stale instance. UI events would not have fired.

### 3.3 Bug 2: Missing System Messages in Built-in Agents

`createAgentSession()` in `src/agent/agent-session.ts` creates agents with `messages: []`. The orchestrator's `runTurn()` only injects a custom system prompt for **custom** agents (line 261 in `orchestrator.ts`):

```ts
if (customAgent?.systemPrompt && !session.messages.some(...)) {
  session.messages.unshift({ role: "system", content: customAgent.systemPrompt });
}
```

Built-in agents (`research`, `coding`, `generalist`) never get a system message. In single-agent mode, `makePrefixMessages()` injects the system prompt before `runAgentTurn()`. In multi-agent mode, this step was entirely missing — the per-agent buffers are passed directly to `runAgentTurn()` with no prefix.

### 3.4 Bug 3: Auto-compact Crash

`compactMessages` in `src/agent/compact.ts` expects leading system messages:

```ts
const prefix = messages.slice(0, prefixEnd);
if (prefix.length === 0) throw new Error("compact: no system message found");
```

Because Bug 2 means all multi-agent sessions lack system messages, any session that grows long enough to trigger auto-compact will crash. The error is swallowed in `maybeCompact` (the orchestrator catches it silently), but the user sees the info log: "auto-compact failed: compact: no system message found".

### 3.5 Why It Wasn't Caught

- The existing test suite (`agent-session.test.ts`, `orchestrator.test.ts`) tests the orchestrator in isolation with mock fetch.
- `app.test.tsx` only tests file-picker utilities, not the TUI session lifecycle.
- There is **no integration test** that exercises: save session → upgrade app → resume session.
- There is **no integration test** that starts a multi-agent session, sends enough messages to trigger auto-compact, and asserts it doesn't crash.
- The PR diff for `app.tsx` was large (+/- thousands of lines) and the resume path was a small, easy-to-miss conditional buried inside a `useCallback`.
- The multi-agent tests (`orchestrator.test.ts`) mock `runAgentTurn` and never exercise the real message buffer state, so missing system messages were invisible.

---

## 4. Impact

### Bug 1 (Resume)
- **User experience:** Any user who upgrades to 0.29.0, enables multi-agent, and resumes an old session loses their entire conversation context. This is a silent data-loss scenario (the session file is intact, but the model behaves as if it were blank).
- **Trust:** Users may believe the product is unreliable and downgrade or stop using multi-agent.
- **Cost:** Wasted API tokens on re-explaining context to a model that should already know it.

### Bug 2 (Missing System Messages)
- **Model behavior:** All multi-agent sessions run without the system prompt that defines available tools, coding conventions, and behavior guidelines. The model may hallucinate tools, ignore instructions, or produce lower-quality output.
- **Silent failure:** There is no error message. The user only notices that multi-agent "feels worse" than single-agent.

### Bug 3 (Compact Crash)
- **User experience:** Long-running multi-agent sessions eventually hit the compact threshold and log a failure. The session continues but never compacts, leading to token bloat and higher API costs.
- **Observability:** The error message "auto-compact failed: compact: no system message found" is cryptic and points to the wrong layer (compact utility rather than the missing injection step).

---

## 5. The Fix (Summary)

### Fix 1: Legacy Session Resume (Bug 1)

Instead of instantiating the orchestrator during resume (which forces no-op callbacks), we now **stash** the deserialized state in a `pendingOrchestratorStateRef`. When `processMessage` lazily creates the orchestrator with live `sharedCallbacks`, it hydrates the buffers from the pending ref in a single `deserialize()` call.

For legacy sessions without `multiAgentState`, we construct a synthetic migration payload:

```ts
{
  activeRole: "generalist",
  agents: [{ role: "generalist", messages: file.messages, recentToolCalls: [] }],
}
```

This preserves the exact conversation history while migrating it into the multi-agent format.

### Fix 2: System Message Injection (Bug 2)

When the orchestrator is first created in `processMessage`, we check if the active agent's buffer lacks system messages. If so, we prepend the same prefix messages that single-agent mode uses:

```ts
const prefix = makePrefixMessages(
  cacheStableRef.current,
  overrideModel ?? cfg.model,
  modeRef.current,
  [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
);
activeSession.messages.unshift(...prefix);
```

This ensures built-in agents have the same system prompt context as single-agent mode.

### Fix 3: Compact Resilience (Bug 3)

`compactMessages` now skips compaction gracefully instead of throwing:

```ts
if (prefix.length === 0) {
  return { summary: "", newMessages: messages, replacedCount: 0 };
}
```

This is a defense-in-depth measure: even if system messages are missing for any reason, the session continues without crashing.

---

## 6. Guardrail Failure — Investigative Questions

The following questions are designed to be used by a future coding agent or human reviewer when auditing why our PR guardrails did not catch this regression. They are intentionally open-ended and may require reading test files, CI configs, and the PR diff itself.

### 6.1 Test Coverage

1. **Where is the integration test for the full session lifecycle?**  
   A test should exercise: start session → send messages → save → simulate app restart → load session → send follow-up → assert context is preserved. Does such a test exist? If not, why was it omitted from PR #220?

2. **Why does `app.test.tsx` only test file-picker utilities?**  
   The main `App` component is 3,000+ lines and contains critical stateful logic (resume, compaction, interrupt, multi-agent orchestration), yet the test file covers only `buildFilePickerIgnoreList`. What guardrail should enforce that PRs touching `app.tsx` session logic also add or update integration tests?

3. **Do the orchestrator tests (`orchestrator.test.ts`) ever call `deserialize()` with a legacy payload?**  
   They test `deserialize` with well-formed multi-agent state, but not with a missing `multiAgentState` field. Should there be a test case named "migrates legacy single-agent session to multi-agent buffers"?

4. **Why are there no snapshot tests for session file format?**  
   If we had a snapshot of a v0.28.0 session JSON, a test could assert that v0.29.0 loads it correctly. Was snapshot testing considered and rejected, or simply never proposed?

### 6.2 Static Analysis & Type Safety

5. **Could TypeScript have caught the missing migration path?**  
   `SessionFile.multiAgentState` is typed as optional (`?:`). Should it be a discriminated union that forces the consumer to handle the "legacy session" case explicitly? For example:
   ```ts
   type SessionFile =
     | { format: "legacy"; messages: ChatMessage[]; ... }
     | { format: "multi-agent"; multiAgentState: MultiAgentState; ... }
   ```
   Would this have forced the `if` branch to be exhaustive?

6. **Why does `AgentOrchestrator` accept callbacks at construction time rather than per-turn?**  
   If callbacks were passed to `runTurn()` instead of the constructor, we would not have needed the "stash and lazy hydrate" pattern. Was this design choice reviewed for resume compatibility?

### 6.3 PR Review Process

7. **Was there a checklist item for "backward compatibility with existing user data" in PR #220?**  
   The PR description mentions "Config backward compatibility preserved with defaults" but says nothing about **session file** backward compatibility. Was session data explicitly considered out of scope, or was it an oversight?

8. **Who reviewed the `app.tsx` diff lines 1508–1548?**  
   The bug lives in a ~40-line block inside a 3,000-line file. Does our review process require a second pair of eyes on state-hydration logic, or was the PR so large that this section was skimmed?

9. **Was the PR tested against a real session file from a previous version?**  
   A manual QA step of "install 0.28.0, have a conversation, upgrade to 0.29.0, resume" would have caught this in minutes. Is manual QA part of the release process? If not, can we automate it?

### 6.4 Feature Flags & Rollout

10. **Why does `multiAgent` default to `false` in config, yet the resume path was broken for users who explicitly opt in?**  
    The feature flag worked for runtime behavior (the orchestrator is only used when enabled), but it did not protect the **data path**. Should feature-flagged features be required to prove they can coexist with legacy data before the flag is allowed to be toggled?

11. **Should there be a "session format version" field in saved sessions?**  
    If `SessionFile` had a `version: number` field, the resume logic could assert `version <= CURRENT_VERSION` and run a migration pipeline. Why wasn't this added in PR #220?

### 6.5 Observability & User Feedback

12. **Why did the user have to manually discover and report this?**  
    Could we have detected empty-context resumes via telemetry? For example, if a resumed session's first follow-up message receives a response containing phrases like "what are you?" or "I don't have context", could we flag that as an anomaly?

13. **Should there be a debug/diagnostic command (e.g., `/debug resume`) that prints the orchestrator's internal buffer sizes?**  
    This would have allowed the user (or a support agent) to instantly see that the generalist agent had 0 messages after resume.

### 6.6 Code Organization

14. **Why is session resume logic embedded inside a React component (`app.tsx`) rather than a pure function?**  
    If resume hydration lived in `src/sessions.ts` or a dedicated `src/session-resume.ts` module, it would be easier to unit test in isolation. Was there a reason to keep it inside the Ink TUI component?

15. **The `handleResumePick` callback has an empty dependency array (`[]`). Was this intentional?**  
   An empty deps array means the closure captures the initial render's `cfg` object. If the user changes config after mount, the resume handler uses stale config. Could this stale-closure pattern have contributed to the bug or mask it during testing?

### 6.7 Multi-Agent Architecture (New)

16. **Why does `createAgentSession()` create agents with `messages: []` instead of pre-populating with system messages?**  
    In single-agent mode, `makePrefixMessages()` runs before every turn. In multi-agent mode, this was never wired in. Was this omission a design decision ("agents are lightweight and get context on first turn") or simply forgotten during implementation?

17. **Should the orchestrator inject system messages, or should `createAgentSession()` do it?**  
    The fix injects system messages in `processMessage` (the TUI layer). Would it be cleaner for `AgentOrchestrator` to own this, since it already injects custom agent system prompts? Why is the responsibility split between the TUI and the orchestrator?

18. **Why does `compactMessages` throw rather than skip?**  
    The original design assumed system messages are invariant. But in a multi-agent world, per-agent buffers may legitimately lack them during initialization. Should compact utilities be defensive by default, or should their callers guarantee preconditions?

19. **Was the multi-agent feature ever tested end-to-end with a real model?**  
    The unit tests mock `runAgentTurn` and `runKimi`. A real end-to-end test (even a manual one) would have immediately revealed that the model doesn't know about tools — the first tool call would fail or the model would hallucinate.

20. **Why does the session file store both `messages` (flat) and `multiAgentState` (per-agent) in multi-agent mode?**  
    The flat `messages` field is redundant — it's just a copy of the active agent's buffer. This redundancy is useful for backward compatibility, but was it intentional? Should the save logic explicitly document this dual-format strategy?

---

## 7. Recommendations for Guardrail Improvements

These are **proposed** additions to the PR review checklist. They are not implemented yet; they are starting points for discussion.

| # | Guardrail | Owner |
|---|-----------|-------|
| 1 | **Session lifecycle integration test** — mandatory for any PR touching `app.tsx` resume/save logic | Engineering |
| 2 | **Legacy data migration test** — for any PR introducing new optional fields to `SessionFile`, prove that missing fields are handled | Engineering |
| 3 | **Session format version field** — add `version: number` to `SessionFile`; reject or migrate unknown versions | Engineering |
| 4 | **PR size limit for stateful files** — require extra review sign-off if `app.tsx` diff exceeds N lines | Process |
| 5 | **Manual QA checklist item** — "Tested resume with a session created by previous release" | Release Manager |
| 6 | **Callback lifecycle audit** — any ref-captured callback object must be reviewed for stale-reference bugs | Engineering |
| 7 | **End-to-end multi-agent test** — start multi-agent session, send N messages to trigger compact, assert no crash and model knows tools | Engineering |
| 8 | **System prompt invariant check** — assert that every message buffer passed to `runAgentTurn` has at least one leading system message | Engineering |
| 9 | **Compact utility defensiveness** — all compaction utilities should skip gracefully rather than throw on missing preconditions | Engineering |

---

## 8. Appendix: Reproduction Steps

### Bug 1: Legacy Session Resume

1. Install kimiflare v0.28.0.
2. Start a session, send a few messages.
3. Exit (session auto-saves).
4. Upgrade to v0.29.0.
5. Enable multi-agent in config (`multiAgent: true`).
6. Run `/resume`, select the v0.28.0 session.
7. Type a follow-up question.
8. **Expected:** Model responds with full context awareness.  
   **Actual:** Model responds with confusion ("what are you?") or empty output.

### Bug 2: Missing System Messages

1. Install kimiflare v0.29.0.
2. Enable multi-agent in config (`multiAgent: true`).
3. Start a brand new session.
4. Ask the model to list available tools, or ask it to read a file.
5. **Expected:** Model knows about `read`, `write`, `edit`, `bash`, etc. and uses them correctly.  
   **Actual:** Model may hallucinate tools, ask for clarification, or behave as if it has no tool access.

### Bug 3: Auto-compact Crash

1. Install kimiflare v0.29.0.
2. Enable multi-agent in config (`multiAgent: true`).
3. Start a brand new session.
4. Send enough messages (or long enough messages) to exceed the compact threshold.
5. **Expected:** Session auto-compacts silently, preserving context.  
   **Actual:** Info log shows "auto-compact failed: compact: no system message found".

---

*End of report.*
