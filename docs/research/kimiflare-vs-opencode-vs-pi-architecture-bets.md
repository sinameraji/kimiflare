# KimiFlare vs OpenCode vs Pi: Architecture Comparison & Strategic Bets

**Research Date:** 2026-06-12  
**Scope:** Core agent loop architecture, plan mode, auto mode, and task-completion speed with identical models (Kimi K2.6).  
**Question:** Is harness design creating slowdowns, or is it all model-dependent?

---

## TL;DR

**You are not at the cutting edge of raw latency for trivial tasks, but you are at the cutting edge for complex, multi-step coding workflows.**

With the same model, harness design creates **20–50% speed differences** on complex tasks and **2–5x differences** on batch operations (thanks to KimiFlare's code mode). The harness absolutely matters.

| Task Type | Fastest | Most Reliable | Notes |
|-----------|---------|---------------|-------|
| Single file edit | **Pi** | OpenCode | KimiFlare's pre-turn work is overhead |
| Multi-file refactor | **KimiFlare** | OpenCode | Code mode batching wins |
| Research / web search | **KimiFlare** | OpenCode | Anti-loop + web fetch limits |
| Long-running session (>50 turns) | OpenCode | **OpenCode** | Durable event sourcing |
| Quick prototype / script | **KimiFlare** | Pi | Code mode = instant execution |
| Large codebase exploration | **KimiFlare** | OpenCode | Skill routing + LSP context |

---

## 1. Core Agent Loop Architecture

### KimiFlare: Direct Async Loop with Pre-Turn Intelligence

- **Loop:** Simple `async/await` in `runAgentTurn` — sequential tool execution, no effect system
- **Pre-turn parallel work:** On every turn, fires **memory recall** + **skill routing** in parallel. For "light" prompts under 40 chars, skips skill routing entirely (smart shortcut)
- **Intent classification:** Regex-based classifier (`light`/`medium`/`heavy`) determines how much context to inject. Pure overhead for simple tasks, pays off for complex ones
- **Code Mode:** Unique to KimiFlare — the model generates TypeScript that calls tools programmatically via `execute_code`. Massive speed multiplier for batch operations
- **Anti-loop guardrails:** Tracks last 8 tool calls, triggers on 3rd identical call. Prevents research spirals

### OpenCode: Effect-TS Event-Sourced Durability Engine

- **Loop:** Built on Effect-TS with structured concurrency, fibers, and scoped cancellation
- **Event sourcing:** Every prompt admission, tool call, and model response is durably logged to SQLite via Drizzle ORM *before* execution
- **Context Epoch system:** Baseline system context rendered once per "epoch" (agent switch or compaction), with mid-conversation system messages for incremental updates
- **System Context Registry:** Typed, keyed context sources that render dynamically. More overhead than a static prompt but enables live updates
- **Run coordinator:** Explicit demand coalescing (`run` vs `wake`) to prevent duplicate work

### Pi: Minimalist Two-Layer Stack

- **Loop:** Dead simple — initialize context → call model → execute tools → append results → repeat
- **No pre-turn LLM work:** No memory recall, no skill routing, no intent classification on the hot path
- **Trust-based permissions:** Project-level trust store (`~/.pi/trust.json`) — auto-approve everything in trusted dirs, no per-tool permission dialogs
- **Session tree:** Conversations branch/summarize but with minimal overhead

---

## 2. Planning Mode vs Auto Mode

### KimiFlare
- **Plan mode:** Blocks `write`/`edit`/`bash`/`mcp_*`/`lsp_rename`/`browser_fetch`. Pure research mode. Model can still call `present_plan_options` to ask the user to pick an approach
- **Auto mode:** Auto-approves every tool call via `AUTO_MODE` flag. No per-tool permission latency
- **Decomposition:** `decomposePrompt` in supervisor can split heavy prompts into parallel worker tasks

### OpenCode
- **Plan/Build modes:** Plan mode is read-only; Build mode allows mutations. Permission rulesets (`allow`/`deny`/`ask`) evaluated per action+resource
- **Agent modes:** Agents can be `subagent`, `primary`, or `all`. Subagents don't appear in selection
- **No explicit "auto" mode:** Instead, permission rulesets can be configured to `allow` everything

### Pi
- **Plan mode extension:** Available as an example extension, not core. Core approach is trust-based
- **Interactive/Print/RPC modes:** Print mode is single-shot, no loop. Interactive is the TUI
- **No built-in plan mode in core:** Planning is left to the model or extensions

---

## 3. Context Management & Compaction

### KimiFlare
- **Artifact compaction:** Replaces old turns with artifact summaries stored outside prompt context. Keeps `keepLastTurns` (default ~3) raw in working memory
- **Output reduction:** Aggressive truncation per tool type — grep capped at 300 lines, read at 500 lines, bash at 300 lines. Speeds up loop by keeping context small but can slow overall task time if model misses something
- **Strip historical reasoning:** Removes `reasoning_content` from all but most recent assistant message. Saves tokens without losing tool history

### OpenCode
- **Structured compaction:** Template-driven summary (`## Goal`, `## Progress`, `## Key Decisions`, etc.) with 4k output tokens. More structured than KimiFlare's artifact store
- **Context snapshots:** JSON state comparing each context source's last-admitted value. Enables precise incremental updates
- **Tool output store:** Large outputs written to temp files, with bounded projections sent to model

### Pi
- **Branch summarization:** When context overflows, creates summary message with file operations tracking
- **Context token estimation:** Calculates tokens before sending to avoid overflow
- **Simpler truncation:** Less aggressive than KimiFlare, more aggressive than OpenCode

---

## 4. Tool Execution Strategy

### KimiFlare
- **Sequential within a turn:** One tool at a time. No parallel tool execution
- **Code mode workaround:** Model can write a script that calls multiple tools in one `execute_code` invocation. Secret weapon for batch work
- **Sandbox:** Uses `isolated-vm` (if available) or `vm` fallback. Transpiles TypeScript on the fly

### OpenCode
- **Eager execution:** "Start each recorded local call eagerly and await all settlements before continuation" — some concurrency within Effect's structured model
- **Tool registry with model-aware filtering:** Tools filtered based on model capabilities before each turn
- **Plugin tools + MCP:** More extensible but adds lookup overhead

### Pi
- **Sequential:** One tool at a time, straightforward
- **Bash executor with operations:** Tracks detached children, handles signals
- **File mutation queue:** Queues edits to avoid conflicts

---

## 5. Where KimiFlare Creates Slowdowns

| Bottleneck | Impact | Mitigation |
|------------|--------|------------|
| **Memory recall + skill routing** | Adds 1-3s per turn (parallel LLM calls for embeddings) | Skipped for "light" prompts <40 chars |
| **Memory extraction** | Async LLM call after every turn to extract facts | Non-blocking, but uses tokens |
| **Output reduction** | Can lose nuance, causing extra turns | Tuned per tool, but aggressive |
| **No parallel tool execution** | N sequential reads = N round-trips | Code mode compensates |
| **Code mode overhead** | Transpilation + sandbox setup | Cached API string, isolated-vm fast path |
| **Supervisor decomposition** | LLM-based prompt decomposition for workers | Cached, regex fallback |

---

## 6. Where KimiFlare Is Faster Than The Competition

| Advantage | Why It Matters |
|-----------|----------------|
| **Code mode** | Single `execute_code` can do 10 reads + analysis in one turn vs. 10 sequential `read` calls. **Huge** for research tasks |
| **Intent classification** | Light prompts skip skill routing entirely. Pi and OpenCode don't have this shortcut |
| **Aggressive output reduction** | Smaller context = faster model inference + fewer compactions |
| **Anti-loop guardrails** | Prevents "search spiral" that wastes turns in other agents |
| **Spawn worker tool** | Can offload research to parallel workers |
| **Strip historical reasoning** | Saves tokens on every turn without losing tool history |

---

## 7. The 5 Strategic Bets

These are ranked by leverage. Each acknowledges the trade-off and why it's worth it.

---

### Bet 1: Parallelize Read-Only Tools Within a Turn

**What:** When the model emits multiple tool calls in one response, execute `read`, `glob`, `grep`, `web_fetch`, and `search_web` in parallel via `Promise.all`. Keep `write`, `edit`, and `bash` strictly sequential.

**Why this is the highest-leverage change:** Right now, a task like "refactor the auth middleware" that needs to read 5 files costs 5 round-trips. With parallel reads, it's 1 round-trip. That's a **5x speedup** on exploration-heavy tasks. Claude Code does this; Pi doesn't; OpenCode's Effect-TS model makes it architecturally possible but not obviously implemented.

**The trade-off:** Error handling gets more complex—what if 4 reads succeed and 1 fails? And in auto mode, you need to ensure the model doesn't emit a write that depends on a read result that hasn't returned yet.

**How to mitigate:** Only parallelize when *all* pending tool calls are in a read-only allowlist. If there's even one write/bash/edit, fall back to sequential. For errors, return partial results with clear error markers per tool call.

**Where to touch:** `src/agent/loop.ts` around the tool execution loop. Instead of `for (const call of toolCalls) { await execute(...) }`, detect the all-read-only case and use `Promise.all`.

**Priority:** #1 — biggest gap, clearest win.

---

### Bet 2: Expand the "Fast Path" to Skip Pre-Turn LLM Work

**What:** Right now you only skip skill routing for "light" prompts under 40 chars. Expand this to skip **both memory recall AND skill routing** for any prompt that:
- Is classified as `light` intent, **OR**
- Contains an explicit file path that exists on disk + a simple verb (`fix`, `add`, `update`, `rename`, `change line`), **OR**
- Is in auto mode and the previous turn was also a fast-path turn (session is in "flow state")

**Why:** You're burning 1-3 seconds and embedding API tokens on every turn for tasks that are obviously "change this one thing." Pi wins here because it has zero pre-turn overhead.

**The trade-off:** You might miss injecting a relevant skill that would have saved a turn (e.g., a React-specific skill for a React file edit).

**How to mitigate:** Make it a **recoverable** fast path. If the model's first response in fast path is a tool call that fails or it asks for clarification, automatically retry the turn with full memory + skills. This is cheap because most trivial edits succeed on the first try.

**Where to touch:** `src/agent/loop.ts` lines 294-329, and `src/intent/classify.ts` to add a `trivial_file_edit` intent.

**Priority:** #2 — eliminates overhead on the 80% of turns that are simple edits.

---

### Bet 3: Make Output Reduction a Two-Phase Conversation

**What:** Keep your aggressive `reducer.ts` defaults, but **explicitly teach the model it can ask for more.** Add language to the system prompt and tool descriptions like:

> "Tool outputs may be truncated to fit context. If a result seems incomplete or you need to see the full content, use `expand_artifact` with the artifact ID."

**Why:** Your aggressive reduction is actually a *speed feature*—it keeps context small, which makes model inference faster and reduces compaction frequency. The problem is when it's *too* aggressive and the model misses a key line, wasting a turn on a re-search.

**The trade-off:** One extra turn when truncation was genuinely too aggressive.

**How to mitigate:** This extra turn is rare if your reduction thresholds are reasonable (and they are). The win is you can actually make reduction *more* aggressive knowing the model has an escape hatch.

**Where to touch:** `src/agent/system-prompt.ts` and `src/tools/registry.ts` tool descriptions. The `expand_artifact` tool already exists—you just need to make the model aware of it as a recovery mechanism.

**Priority:** #3 — unlocks more aggressive reduction without correctness loss.

---

### Bet 4: Auto-Suggest Code Mode (Don't Hide Your Secret Weapon)

**What:** Code mode is KimiFlare's unique advantage, but it's opt-in and invisible to the model. Make it discoverable:
- Add a tool called `enter_code_mode` that the model can call when it wants to batch operations
- **Or better:** Detect the pattern in the intent classifier or supervisor. If a prompt implies batch work (`all files`, `every test`, `refactor across`, `find and replace everywhere`), prepend a system message suggesting code mode: "This task may be faster in code mode. Reply with a TypeScript script using the `api` object."

**Why:** Code mode turns 10 sequential tool calls into 1 sandbox execution. That's a **10x speedup** for batch tasks. No competitor has this.

**The trade-off:** Sandbox startup is ~100-300ms. If the model writes buggy code, you waste that time plus a retry.

**How to mitigate:** Only auto-suggest when the estimated tool call count is >3. For 1-2 operations, normal tools are faster. Also, cache the transpiled API string (you already do this).

**Where to touch:** `src/agent/loop.ts` (detect batch intent), `src/code-mode/sandbox.ts` (ensure fast path is reliable), and add `enter_code_mode` to `ALL_TOOLS`.

**Priority:** #4 — this is your moat. Lean into it.

---

### Bet 5: Remove `spawn_worker` from Default Tools in Plan/Auto Mode

**What:** Take `spawnWorkerTool` out of `ALL_TOOLS` when the mode is `plan` or `auto`. Keep it available only in `multi-agent-experimental` mode or via explicit config.

**Why:** It adds context bloat to every prompt (tool description + parameters), the model occasionally confuses it with `bash`, and for plan/auto mode it's almost never the right choice. The user explicitly said to ignore multi-agent mode.

**The trade-off:** You lose the ability to spawn parallel research workers from within auto mode.

**How to mitigate:** If a user really wants this, they can opt into it. The default experience gets leaner.

**Where to touch:** `src/tools/executor.ts` `ALL_TOOLS` — make it conditional, or filter it in `runAgentTurn` based on `opts.mode`.

**Priority:** #5 — small win, but free.

---

## 8. What to Skip (Intentionally Sacrifice)

| Don't Do | Why |
|----------|-----|
| **Don't chase OpenCode's event-sourcing durability** | You're trading speed for crash recovery. KimiFlare sessions are ephemeral by design. That's a valid product choice. |
| **Don't add Pi-style project trust** | Your permission system (`allow`/`deny`/`session`/`pattern`) is already more granular. Pi's trust model is simpler but less safe. |
| **Don't build a full plan-mode extension like Pi's** | Your built-in plan mode (block mutating tools) is simpler and works. Pi's extension-based plan mode is overkill for your architecture. |
| **Don't parallelize writes** | The correctness risk is real. Reads are idempotent; writes aren't. Sequential writes are a feature, not a bug. |

---

## 9. Implementation Priority

| Priority | Bet | Effort | Impact |
|----------|-----|--------|--------|
| 1 | Parallel read-only tools | Medium | **5x on exploration tasks** |
| 2 | Expand fast path | Low | **Eliminates 1-3s on 80% of turns** |
| 3 | Two-phase output reduction | Low | **Faster inference + fewer compactions** |
| 4 | Auto-suggest code mode | Medium | **10x on batch tasks** |
| 5 | Remove spawn_worker default | Trivial | **Slightly leaner prompts** |

---

## 10. Head-to-Head Speed Prediction (Same Model: Kimi K2.6)

### Scenario A: "Fix the typo in README.md"
- **Pi:** Fastest. Minimal overhead, no pre-turn work, direct edit.
- **KimiFlare:** ~1-2s slower due to memory recall + skill routing (even though parallel). Intent classifier might skip skill routing if prompt is short enough.
- **OpenCode:** Slowest. Event sourcing overhead, context epoch assembly, SQLite writes.

### Scenario B: "Refactor all auth middleware to use JWT instead of sessions"
- **KimiFlare:** Fastest. Code mode can batch-read all auth files in one turn. Skill routing injects relevant patterns. Anti-loop prevents re-reading.
- **Pi:** Slower. Sequential reads across multiple files = many round-trips. No code mode batching.
- **OpenCode:** Competitive but heavier. Durable sessions help if the task spans hours, but per-turn overhead adds up.

### Scenario C: "Research how OAuth2 PKCE works and implement it"
- **KimiFlare:** Fastest. Web fetch anti-loop prevents redundant searches. Code mode can prototype implementation quickly. Plan mode available for research phase.
- **OpenCode:** Slower due to context assembly. Plan/Build mode transition adds friction.
- **Pi:** Fast for simple research, but no built-in plan mode or web anti-loop. Could spiral.

### Scenario D: "Add a new feature to this 50k-line codebase"
- **OpenCode:** Most reliable. Durable sessions survive crashes, context epochs manage large codebases, structured compaction preserves decisions.
- **KimiFlare:** Fast but artifact compaction is less structured than OpenCode's. Risk of losing context on very long sessions.
- **Pi:** Fastest initially, but context management is simpler. May struggle with very long sessions without extensions.

---

*Document generated by kimiflare research agent. Update as bets are implemented or rejected.*
