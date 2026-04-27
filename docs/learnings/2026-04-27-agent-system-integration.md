# Research: how `compact`, `compiled context`, `code mode`, and `agent memory` should work together

> Status: research artifact. Not an implementation plan and not a roadmap. The goal is to make the design space legible enough that the next conversation can pick a direction.

## 0. Why this exists

Kimiflare grew four overlapping mechanisms in close succession:

1. **Compact** — an LLM-driven summarizer (`/compact`).
2. **Compiled context** — a heuristic state-extraction + artifact archive layer added in `b323e80`, gated behind a feature flag.
3. **Code Mode** — a TypeScript sandbox that replaces native tool-calling with one `execute_code` tool, modeled on [Cloudflare's Code Mode blog post](https://blog.cloudflare.com/code-mode/).
4. **Agent Memory** — a per-repo SQLite + embeddings store with RRF retrieval and explicit tool-driven writes, modeled on [Cloudflare's Agent Memory blog post](https://blog.cloudflare.com/introducing-agent-memory/).

All four landed inside a five-day window in late April 2026 — the project itself is roughly a week old at the time of writing. Compact landed within four hours of the initial scaffold. Compiled context landed two days later. Agent memory and code mode both landed on the same afternoon, thirty minutes apart. Each was built mostly in isolation; none was redesigned when the next arrived. The result is four solid mechanisms that haven't yet had time to form one coherent system.

The optimization target is twofold:

- **Cheap** — minimize tokens-per-session and avoid wasted LLM calls.
- **High quality** — the model should feel like a coworker that retains context within a session and across sessions, without the user having to micro-manage it.

These two goals are usually in tension. The job here is to find an architecture where they aren't.

---

## 0.5. The two practical issues that prompted this document

Two concrete failures showed up in real sessions and need fixes regardless of the longer architectural discussion. Both have verified root causes; both have minimal-surgery fixes. Any implementation work should ship these first.

### Issue A — context-window blowup mid-session

**Symptom:** `kimiflare: Ai: The estimated number of input and maximum output tokens (424381) exceeded this model context window limit (262144).` A long-running session simply runs out of room.

**Root cause:** Auto-compaction is gated behind `compiledContextRef.current`, which is `false` by default unless `KIMIFLARE_COMPILED_CONTEXT=1` is set. With the default config, **no auto-compaction ever runs**. The `/compact` slash command is the only safety net, and it's manual. Recent additions (Code Mode, Agent Memory) inflated per-turn token cost, so the wall is hit faster than before.

This is finding §6.1 below. The fix is in §7.3, item 1: make auto-compaction fire even when compiled context is off, falling back to the existing async `compactMessages` LLM summarizer that `/compact` already uses successfully in that mode.

### Issue B — agent loops on `git show` during merge-conflict resolution

**Symptom:** When asked to resolve a merge conflict, the agent fires `git show` (and slight variants — `git show <sha>:path`, `git show <sha>`, sed-sliced versions) over and over without converging. Eventually hits the 50-iteration cap and errors out, after burning a lot of tokens.

**Root cause:** The bash output reducer (`src/tools/reducer.ts:30–55`) caps bash output at 40 lines / 4000 chars *and* applies `dedupeConsecutiveLines: true`. For diff commands this is fatal — diffs have lots of similar adjacent lines, and the dedupe rule collapses them. The model gets a partially-deleted diff and can't reconstruct the conflict, so it tries another slicing of `git show` hoping for different output. Every variant comes back equally mangled. There's no anti-loop guardrail.

This is finding §6.5 below. The fix is in §7.3, item 2: bypass the reducer for `git show`, `git diff`, `git log -p`, `git format-patch`, `git stash show -p`. Let those commands return full output. The artifact still gets archived for later retrieval, but what reaches the model is intact.

### These two come first

Everything else in this document is longer-term thinking about how to make Agent Memory feel present, how to coordinate the four mechanisms, and what to use for plumbing models. **None of that should land before the two fixes above land**, because the longer-term work doesn't help if a session can still die mid-conversation or get stuck on a merge conflict.

The recommended sequencing is:

1. Auto-compaction fallback when compiled context is off.
2. Reducer bypass for diff-style git commands.
3. Tighten the greedy artifact-recall heuristic (small, low-risk, defensive).
4. Then start on the read-side memory work in §7.1.
5. Then the write-side cost work in §7.2 (which involves the model swap to Llama 4 Scout).

Items 1–3 are the smallest changes and address user-visible pain. Items 4–5 are larger, change behavior the user feels, and benefit from the foundation that 1–3 lay.

---

## 1. What each mechanism does today

### 1.1 Compact (`src/agent/compact.ts`)

A function that asks Kimi to write a 400–800-token summary of older turns and replaces those turns with a single system-message summary.

- Triggered **only** when the user runs `/compact`, and **only** when compiled context is off.
- Costs one LLM call per invocation.
- No structured output — the summary is free-form narrative.
- Predates everything else; the original "I'm running out of context" handler.

### 1.2 Compiled context (`src/agent/compaction.ts`, `src/agent/session-state.ts`)

Two cooperating pieces:

- **`SessionState`** — a structured per-session record: `task`, `files_touched`, `files_modified`, `confirmed_findings`, `recent_failures`, `decisions`, `next_actions`, `artifact_index`.
- **`ArtifactStore`** — an in-memory LRU keyed by an opaque artifact ID, holding raw tool outputs (50 KB per artifact, 500 KB total, 200 entries).

Two operations:

- **Auto-compaction** runs after every turn when the message array crosses 80 K tokens or 12 turns: extracts deltas to `SessionState`, archives older tool outputs into `ArtifactStore`, and rewrites the message array as `[system prefix][SessionState as system message][last 4 raw turns]`.
- **Selective recall** runs **before** every API call: scans the current text for file paths or failure keywords; if they match an artifact in the index, injects that artifact's raw content (up to 5 artifacts) as a system message right before the next user turn.

No LLM calls — everything is regex / heuristic. Persists `SessionState` to the session JSON file. **Does not persist the `ArtifactStore`.** Gated behind the `compiledContext` feature flag (default off, env `KIMIFLARE_COMPILED_CONTEXT=1`).

### 1.3 Code Mode (`src/code-mode/`, `src/agent/loop.ts:60-88, 244-287`)

When enabled, the model no longer sees individual tools. It sees one tool: `execute_code`, whose description embeds an auto-generated TypeScript API for every available tool.

- The model writes a TS script. The script runs in a V8 isolate (`isolated-vm`, 128 MB / 30 s) — falling back to `node:vm` if the native binding isn't available.
- Tools are reached through an `api` object whose methods proxy back through the normal executor (so permission prompts and the output reducer still apply per call).
- Only `console.log` output is returned to the model. Errors are prepended to that output as text.
- The TypeScript API is **regenerated every turn** and embedded in the tool description; not a stable cache-friendly prefix.
- No memoization of scripts, no archival of scripts as artifacts.

### 1.4 Agent Memory (`src/memory/`, `src/tools/memory.ts`)

A per-repo SQLite database at `<cwd>/.kimiflare/memory.db`. Schema: `memories` (with `topic_key`, `superseded_by`, `forgotten`, `vectorized` columns), `memories_fts` (FTS5 mirror), `memory_meta` (cleanup timestamp).

Five categories: `fact`, `event`, `instruction`, `task`, `preference`.

- **Writes are tool-driven only** — the model has to call `memory_remember` for anything to be stored. The `extractMemories()` function in `src/memory/extraction.ts` exists as dead code; **this was deliberate**, see §5.
- Each `memory_remember` fires three LLM calls (verification, topic-key normalization, hypothetical-query generation) plus one embedding call (`@cf/baai/bge-base-en-v1.5`, 768-dim) on the content concatenated with hypotheticals.
- **Reads** use a four-channel hybrid: FTS5 (BM25), cosine vector similarity, exact match (filenames + keywords), topic-key match. Results fused via Reciprocal Rank Fusion with weights `{topicKey:0.35, fts:0.20, vector:0.20, exact:0.15, rawMessage:0.10}`, tie-broken by recency.
- Memories sharing a normalized topic key are chained via `superseded_by` (older row stays for audit; queries filter `superseded_by IS NULL`).
- Cleanup runs at app start: drops memories older than 90 days, deduplicates by cosine similarity ≥ 0.95, enforces `maxEntries` (1000) per repo.

---

## 2. Cloudflare's two reference designs

Both Cloudflare posts are part of an integrated agent-platform vision. Reading them side by side, three things stand out — and our implementation has not fully adopted any of them.

### 2.1 Code Mode (Cloudflare's version)

- Core argument: "LLMs are better at writing code to call MCP than at calling MCP directly." The point is *quality and capability*, not just token savings — the model has way more training on writing code than on stitching together synthetic tool calls.
- Architecture: V8 isolates via the new Worker Loader API. Bindings — typed handles to a service — are how tools reach the script. The model never sees credentials.
- Network is denied by default. MCP servers are reached only via injected bindings.
- TypeScript API generated from MCP schemas + JSDoc derived from MCP documentation; it's the tool surface, not the system prompt.
- Caveat in the post itself: "future work — dynamic browsing of tools." They acknowledge that loading the entire API at once doesn't scale.

Our implementation matches this fairly well. The biggest divergence: ours regenerates the TS API on every turn and embeds it in the tool description, which destroys prefix-cache stability across turns.

### 2.2 Agent Memory (Cloudflare's version)

This is where the divergence is large. Three load-bearing ideas:

1. **Bulk ingest at compaction time.** The harness ships the *entire conversation* to the memory service whenever it compacts. A multi-stage pipeline runs there: chunk → extract (full + detail passes) → verify (8 checks) → classify → store. Memories are content-addressed by SHA-256 of `(sessionId, role, content)`, so re-ingestion is idempotent.
2. **Five retrieval channels fused with RRF**, not four: full-text, exact fact-key lookup, raw-message search, direct vector, **HyDE vector** (embed a hypothetical *answer* phrasing). Tasks are excluded from the vector index — they're searchable only via FTS.
3. **Recall returns synthesized natural-language prose**, not raw memory rows. The retrieval pipeline composes results into a single sentence-style answer; *that* enters the agent's context. Storage strategy is hidden from the agent entirely.

Plus a model-economy point that matters for cost: extraction / classification / query analysis runs on a small fast model (Llama 4 Scout); only synthesis uses a larger one. "Bigger isn't always better."

### 2.3 The product-philosophy choice that diverges Cloudflare's design from ours

Cloudflare's auto-bulk-ingest is implicit memory mining: the framework reads the user's whole conversation and decides what to remember, with verification as the safety net.

**Kimiflare's design is explicit-only**: memories are written only when the user asks for them ("remember this"), and forgotten only when the user asks ("forget that"). This is a deliberate product stance about consent and predictability — the agent doesn't surveil the conversation, it doesn't pick up things said in passing, and the user is in control of their memory store.

The dead `extractMemories()` function exists because the bulk-ingest pipeline was speculatively built before this stance solidified. Wiring it up would violate the design philosophy. **This document treats explicit-only as a hard constraint**, not a preference to revisit.

---

## 3. How the four pieces interact today (the actual graph)

Every arrow below is verified in the code.

```
              ┌──────────────────────────┐
              │ User input → app.tsx     │
              └───────────┬──────────────┘
                          │
                          ▼
 ┌─── if compiledContext flag ───┐
 │ recallArtifacts() injects up  │
 │ to 5 raw artifacts (≤50 KB ea)│
 │ matched by file-path / failure│
 │ keyword. Always synchronous.  │
 └─────────────┬─────────────────┘
               │
               ▼
      ┌────────────────┐
      │ runAgentTurn() │  gets: messages, tools, executor,
      └────────┬───────┘         memoryManager (passed via
               │                  ToolContext)
   ┌───────────┴─────────────────────┐
   │                                 │
┌──▼───────┐                  ┌──────▼───────┐
│ codeMode │                  │ native tools │
│ → 1 tool │                  │              │
│ + inline │                  │              │
│ TS API   │                  │              │
└──┬───────┘                  └──────┬───────┘
   │                                 │
   ▼                                 ▼
┌──────────┐                  ┌──────────────┐
│ V8       │                  │ executor.run │
│ isolate  │                  │ each tool    │
│ runs     │                  │              │
│ script   │                  │ outputs      │
│ each tool│                  │ reduced      │
│ result   │                  │              │
│ already- │                  │              │
│ reduced  │                  │              │
└──────┬───┘                  └──────┬───────┘
       │                             │
       └─────────────┬───────────────┘
                     │
        ┌────────────▼───────────┐
        │ tool messages added to │
        │ messages array         │
        └────────────┬───────────┘
                     │
   ┌─────────────────▼────────────────────┐
   │ if model called memory_remember /    │
   │ recall / forget → MemoryManager via  │
   │ ToolContext. Three LLM calls + one   │
   │ embedding per remember (currently    │
   │ all on Kimi K2.6).                   │
   └──────────────────────────────────────┘

──── after turn ────
┌────────────────────────────────────────┐
│ if compiledContext && shouldCompact()  │
│ → compactCompiled updates SessionState │
│   + ArtifactStore.                     │
│ Otherwise: nothing fires until user    │
│ runs /compact manually.                │
└────────────────────────────────────────┘
```

### Touch-points that exist

- **Code Mode ↔ Compiled Context (partial):** Tool calls inside a script still produce reduced outputs that go through the normal channel, so compaction can see them. But the script itself isn't archived, and the model only sees one consolidated `console.log` blob — which complicates artifact path-extraction heuristics.
- **Code Mode ↔ Memory:** Memory tools work fine inside scripts. The model can call `await api.memory_recall({...})` and get a string back.
- **Memory ↔ System Prompt:** Three sentences in the static prefix telling the model that the three memory tools exist.

### Touch-points that don't exist

- **Compiled Context ↔ Memory:** None. They live in separate files, separate refs, separate stores. They don't know about each other.
- **Memory → session start:** The model walks into every session cold. Even if there are 50 stored memories about this repo, the model has no awareness of them until it thinks to call `memory_recall`.
- **Code Mode → System Prompt:** The TypeScript API gets regenerated every turn and embedded in the tool description. Not a cache-stable prefix. With 25 tools that's roughly 500 tokens × every turn of cache miss.
- **`/resume` → ArtifactStore:** Sessions persist `SessionState` but not the artifact store. After resume, the index points at IDs that no longer have content; recall stops working until new artifacts get archived.
- **Auto-compaction outside compiled context:** No automatic safety net unless the user has opted into the compiled-context feature flag. This is the proximate cause of the 424 K → 262 K window blowups the user has been hitting.

---

## 3.5. Prompt caching on Workers AI — verified facts and kimiflare's current state

This deserves its own section because cache hit rate is plausibly the single biggest lever for the "be cheap" goal, and several of the issues below interact with it directly.

### What Workers AI actually offers

Per the [Workers AI prompt-caching docs](https://developers.cloudflare.com/workers-ai/features/prompt-caching/):

- **Prefix caching is enabled automatically** for select models (model-by-model — check the model page).
- **Mechanism:** Workers AI stores the computed input tensors from the prefill stage and reuses them when subsequent requests share the same prompt prefix.
- **Cached input tokens are billed at a discounted rate** versus regular input tokens.
- **Routing requirement:** the `x-session-affinity` header with a stable session identifier is what tells the platform to keep routing requests to the same model instance, which is what makes a prefix-cache hit likely. Without affinity, requests can land on different replicas where the prefix isn't cached.
- **Hit/miss rule is strict:** prefix matching is exact token sequence from the start. **A single token difference invalidates the cache from that point onward.**
- **Optimization shape:** static content (system prompt, tool definitions) at the very start; dynamic content (timestamps, user queries, recalled artifacts) at the end.
- **Verification:** the `usage.prompt_tokens_details.cached_tokens` field on the response tells you how many tokens hit the cache.

This is not the same as **AI Gateway caching**, which is a separate layer: AI Gateway caches *whole responses* keyed by SHA-256 of the entire request body. Identical request → identical response served from cache. That's request-level deduplication, not prefix caching, and it's an unrelated optimization.

### What kimiflare already does

Commit `6b54723 feat: cache-stable prefix engineering + instrumentation` did real work here:

- **Splits the system prompt** into a static prefix (immutable per session) and a session prefix (changes only when mode/tools/context change). See `buildStaticPrefix` and `buildSessionPrefix` in `src/agent/system-prompt.ts`.
- **Sends both `X-Session-ID` and `x-session-affinity` headers** in the Workers AI client (`src/agent/client.ts:85-86`), with a test that verifies both go out (`src/agent/client.test.ts:38-39`).
- **Adds `cacheStablePrompts` feature flag**, defaulting to true (`src/config.ts:128`).
- **Uses deterministic JSON serialization** (`stableStringify`) with recursive key sorting to avoid V8 insertion-order jitter in tool argument JSON.
- **Tracks cached vs uncached tokens** (`prompt_tokens_details.cached_tokens`) in the usage tracker and surfaces it in the status bar.

So this is not a hidden lever the team hasn't pulled — it's actively used and instrumented. The integration question is whether the *other* mechanisms preserve or destroy it.

### What the four mechanisms do to cache stability

Given the "single token difference invalidates from that point onward" rule:

| Layer | Cache-stable? | Notes |
|---|---|---|
| `buildStaticPrefix` | Yes | Designed to be byte-identical across all turns of a session. |
| `buildSessionPrefix` | Mostly | Includes `Today: ${date}` — this is stable within a session but means crossing midnight breaks the cache. Also includes the tools list, which changes if MCP servers connect/disconnect mid-session. |
| Tool definitions in native mode | Stable | Same tools list across turns → same tool descriptions. |
| **Tool definitions in Code Mode** | **No.** | The TypeScript API is regenerated and embedded in the `execute_code` tool description. Even if the tool list is the same, generated TS may not be byte-identical (key ordering, JSDoc rendering) without explicit determinism. This is a known cost lever that hasn't been pulled yet — see §7.4. |
| Compiled context recall (artifacts injected before each turn) | Position matters | The raw artifact content is appended *after* the static prefix and *before* the user message. As long as that position is consistent and the static portions before it don't change, the static prefix still hits cache. The recall content itself doesn't hit cache (fine — it changes per turn anyway). The risk is if the recall is inserted *before* a stable section, it shifts everything after it and breaks the prefix match. |
| Compiled-context SessionState message | Stable within a turn, changes after compaction | After auto-compaction the SessionState system message contents change. That's a one-off cache invalidation per compaction event, which is acceptable — compaction is rare relative to turns. |
| Compact (LLM summarization) | Cache rebuild after each `/compact` | Same shape as compiled-context post-compaction: a new system message replaces a chunk of history. Acceptable. |
| Memory recall | Per-turn variable | Recalled memories are different each turn → can't cache that segment. Same positioning concern as compiled-context recall. |

**The concrete priority for cache stability:** Code Mode is the load-bearing problem. With ~25 native tools, the Code Mode TS API embedded in the `execute_code` tool description is hundreds of tokens that change every turn — and because it's part of the *tool definition* (early in the request body, before the conversation messages), variability there invalidates the cache for *everything that follows*. Native-mode tool definitions are stable; Code Mode's are not. This single fact may dominate the per-turn billed-input cost when Code Mode is on.

---

## 4. Overlapping concerns

Same idea, three implementations:

| Concept | Compact | Compiled context | Memory |
|---|---|---|---|
| What files were touched | embedded in summary text | `files_touched` array | `relatedFiles` JSON column on each row |
| Decisions made | embedded in summary text | `decisions` array | implicit (model decides to remember) |
| Recent failures | embedded in summary text | `recent_failures` array | usually not stored |
| Repo facts | embedded in summary text | `repo_facts` array | `category="fact"` rows |
| Tool outputs | summarized (lossy) | archived raw, re-callable | not stored |
| Persistence | session JSON only | session JSON (state) + memory (lost) | SQLite (cross-session) |

This is the strongest signal that the integration was never designed end-to-end. Three different mechanisms each maintain their own version of "what happened" in three different shapes, with three different lifetimes, and they don't read from each other.

---

## 5. Cross-cutting tensions

Trade-off axes that any integration design has to take a position on.

### 5.1 Cost vs quality

- Compaction (heuristic) is free. Memory verification + topic + hypotheticals is ~3 LLM calls per write. LLM compaction is 1 call per `/compact`.
- Code Mode adds ~500 tokens of tool description per turn but can collapse N tool calls into 1.
- Recalling raw artifacts is bytes-cheap on storage but token-expensive on context (50 KB × 5 = 250 KB ≈ 60 K tokens) every turn.
- The cheapest setup token-wise (compiled context on, code mode on, memory off) might also be the lowest quality after a `/resume`, because artifacts are gone.

### 5.2 Implicit vs explicit

- Compiled context is fully implicit: the user doesn't know auto-compaction or recall happened.
- Memory is fully explicit: the model has to call `memory_remember` and `memory_recall`.
- Cloudflare's design is hybrid: bulk-ingest on compaction is implicit; the model has explicit `remember` / `recall` / `forget` tools for in-task use.

Kimiflare's stance: explicit-only on the *write* side. That's load-bearing for the product — and it implies that the only way to make memory feel present to the user is via the *read* side.

### 5.3 Per-session vs cross-session memory

- Compiled context is per-session, ephemeral.
- Memory is per-repo, durable.
- A repo fact discovered in session A is invisible to session B unless the model thought to call `memory_remember` for it.

### 5.4 Sync vs async

- Recall is synchronous (in the critical path before each API call).
- Memory writes are synchronous (3 LLM calls + 1 embedding before `memory_remember` returns — that's seconds of wall-clock time per remember).
- Embedding backfill on startup is async.
- Cloudflare's design explicitly puts vectorization, supersession deletion, and consolidation off the critical path.

### 5.5 Local heuristic vs LLM judgment

- Compiled-context extraction uses regex.
- Memory verification uses Kimi K2.6 (the main agent model) to fact-check.
- Cloudflare uses Llama 4 Scout (small/fast) for similar work.
- Heuristics are free but brittle. LLMs are accurate but expensive. The middle path — a small fast model — isn't being used.

---

## 6. Surprising findings worth surfacing

In rough order of how load-bearing they are.

1. **Auto-compaction is gated behind `compiledContext` (off by default).** Without that flag, sessions grow unboundedly. This is the proximate cause of the 424 K → 262 K window blowup the user has been seeing.
2. **`ArtifactStore` is not persisted.** `sessions.ts:25` only saves `sessionState`. After `/resume`, recall finds index entries with no content. Compiled context is partly broken on resume.
3. **Memory writes cost 3 LLM calls plus an embedding** because verification, topic-key normalization, and hypothetical-query generation are all separate Kimi calls. With the user-facing model being a flagship-class model, this is heavy per remember.
4. **Code Mode's TypeScript API is in the tool description, regenerated every turn.** That's hundreds of tokens of cache-miss text per turn that never becomes prefix-stable.
5. **The `dedupeConsecutiveLines: true` rule on the bash output reducer breaks `git show` / `git diff`.** Diffs have lots of similar adjacent lines; the reducer collapses them; the model can't see the conflict and starts thrashing — observed in the saved session for PR #169 with ~12 `git show` variants in 86 messages.
6. **`recallArtifacts` greedy match.** Any failure keyword matched in the current text triggers recall of *all* bash artifacts in the index (capped at 5 IDs). One stray "error" mention in a user message can pull 250 KB of old bash output into context.
7. **Memory has Tasks as a category but doesn't treat them differently.** Cloudflare excludes Tasks from the vector index because they're ephemeral. Ours indexes them like any fact.
8. **Memory recall returns raw rows, not synthesized prose.** The model gets a list of bullet points; it has to pick which to use.
9. **No fifth retrieval channel.** Cloudflare's HyDE channel (embedding a *hypothetical answer* to bridge question/answer vocabulary mismatches) doesn't exist in our retrieval. We do have hypothetical *queries* generated at write time, which is similar in spirit but not the same mechanism.
10. **Memory uses Kimi K2.6 (the main agent model) for extraction-style work** instead of a smaller model. Cost-wise this is the opposite of Cloudflare's recommendation.
11. **No anti-loop guardrail on tool calls.** The agent loop has a hard cap of 50 iterations (`src/agent/loop.ts:54`) but no detection of "you just called the same thing five times". Combined with the bash dedupe issue, it produces the merge-conflict thrashing.

---

## 7. The corrected design discussion (respecting explicit-only memory)

Auto-extract is off the table. That eliminates one whole class of integration. What remains is meaningful and worth doing.

### 7.1 Read-side: make memory feel present without violating the philosophy

The current state: the model walks into every session cold. Even with 50 explicitly-stored memories about this repo, it doesn't surface them until the model proactively calls `memory_recall` — which it often doesn't think to do.

What's compatible with explicit-only:

- **At session start, recall the top N most-relevant memories for the cwd and inject them as a system message.** This doesn't violate explicit-only because it's not writing anything new — it's surfacing what the user *already* explicitly stored. The model just walks in knowing the lay of the land.
- **At compaction time, do the same recall and re-inject.** Once auto-compaction strips older raw turns, the model loses easy access to anything that was in those turns. A small recall against the current task description gives it something durable to anchor on.
- **Optionally synthesize the recalled memories into prose** (Cloudflare-style) instead of injecting raw rows. This costs one LLM call per recall but gives the model a denser, more usable context.

What's *not* compatible with explicit-only:

- Auto-extracting facts from the conversation. Off the table.
- Storing tool outputs as memories without user direction. Off the table.

### 7.2 Write-side: lighten the existing explicit `memory_remember`

Right now `memory_remember` fires:

1. Verification ("is this fact valid?") — Kimi K2.6
2. Topic-key normalization ("produce snake_case key") — Kimi K2.6
3. Hypothetical-query generation ("3-5 alternative phrasings") — Kimi K2.6
4. Embedding — `@cf/baai/bge-base-en-v1.5`

For each task, what should it actually run on?

| Task | Current | Recommended | Reasoning |
|---|---|---|---|
| Verification | Kimi K2.6 | `@cf/meta/llama-4-scout-17b-16e-instruct` | Structured-output binary judgment with optional correction. Cloudflare's own Agent Memory uses Scout for this exact category of task; their blog explicitly says it "hit the better sweet spot of cost, quality, and latency" for structured plumbing. Scout is 17 B with 16-expert MoE — well above the threshold where small-model accuracy starts to degrade on this kind of task. |
| Topic-key normalization | Kimi K2.6 | **No LLM at all** — deterministic function | "Lowercase, strip non-alphanum, replace spaces with `_`, truncate to 60 chars." Calling any LLM for this is overkill. |
| Hypothetical queries | Kimi K2.6 | `@cf/meta/llama-4-scout-17b-16e-instruct` | Mild creative-ish output, narrow scope. Small models do okay; even if a hypothetical is mediocre, the worst-case is missed retrieval, not stored misinformation. Same model as verification keeps configuration simple. |
| Embedding | `@cf/baai/bge-base-en-v1.5` | Keep — it's already small and fast | This isn't the lever. |

**Compact summarization stays on Kimi K2.6.** Synthesis is the one place where larger models meaningfully help (Cloudflare uses their *biggest* model for it).

### 7.3 Cross-cutting cleanup that helps everything

These are not memory-specific but they remove integration friction:

- **Make auto-compaction work without `compiledContext`.** Today the safety net is opt-in and most users never opt in. A version that falls back to the LLM summarizer when compiled context is off would prevent the context-window blowups entirely.
- **Bypass the bash output reducer for diff-style commands** (`git show`, `git diff`, `git log -p`, `git format-patch`). Diffs are meaning-bearing per line; dedupe destroys them. This is the proximate cause of the merge-conflict loops.
- **Tighten the failure-keyword recall heuristic.** Require the artifact summary to actually mention the keyword, not just match any bash artifact in the index. Bounds the worst-case context injection.
- **Persist the artifact store** — or accept that `/resume` is best-effort and document it. Right now neither is true.

None of these is a memory change. They're hygiene that the integration story depends on.

### 7.4 Code-mode ↔ caching

This is the highest-impact cache-stability fix, given the verified Workers AI prefix-cache behavior in §3.5.

- **Make the Code Mode TypeScript API byte-stable across turns.** Two parts:
  1. *Determinism.* The generator (`src/code-mode/api-generator.ts`) needs to produce byte-identical output when given the same tool list. Sort keys, normalize whitespace, normalize JSDoc rendering. This is the same kind of fix that `stableStringify` already applies elsewhere.
  2. *Position.* The TS API currently sits inside the `execute_code` tool description, which is part of the request's tool definitions block — early in the byte sequence, before the conversation messages. That's actually the *right* position for cache hits, *if* the content is stable. Once it's deterministic, it should hit cache like any other static tool description.
- **Optional: archive code-mode scripts as their own artifact type.** Not required for correctness, but if the model writes a useful script the user might want to reuse it.

A reasonable first measurement: run the same multi-turn task twice, once in native mode and once in Code Mode, and compare `prompt_tokens_details.cached_tokens` totals. The gap quantifies how much Code Mode is currently leaving on the table.

---

## 8. Model selection — `@cf/meta/llama-4-scout-17b-16e-instruct` for plumbing

For all *internal* (never user-facing) LLM calls inside Agent Memory's write pipeline. The voice the user talks to stays Kimi K2.6.

**Why Scout:**

- Cloudflare uses this exact model in their own Agent Memory for the same category of work. Direct empirical signal.
- 17 B with a 16-expert MoE means it's substantially cheaper per token than Kimi K2.6 while still well above the size threshold where structured-output quality starts to degrade.
- Already on the user's existing Workers AI account, no separate provider integration.

**Candidates considered and not chosen:**

- `@cf/openai/gpt-oss-20b` — supports structured outputs natively, drop-in Chat Completions API. Strong fallback if Scout has quality issues in practice. Probably worth keeping in mind as a backup, not a primary.
- `@cf/meta/llama-3.1-8b-instruct` — workhorse. Probably fine for hypothetical-query generation alone, but Scout is already proven on the harder verification task by Cloudflare's own data, and there's no reason to mix two models when one fits both jobs.
- `@cf/meta/llama-3.2-1b-instruct` — too small for verification quality.
- `@cf/zai-org/glm-4.7-flash` — Cloudflare's catalog describes it as "optimized for multi-turn tool calling," but our plumbing tasks are JSON-structured-output, not tool calling.

**Configuration notes:** worth making this configurable via env var (e.g., `KIMIFLARE_PLUMBING_MODEL`) so the model can be swapped without a code change if Scout's quality turns out to be a problem. Falling back to Kimi if the env var is unset is the safe default during the rollout.

---

## 9. Open questions for the next conversation

These do not need to be answered to merge this document. They're the agenda for the next design discussion.

1. **Is auto-compaction-without-compiled-context something to ship soon, or wait until compiled context becomes the default?** Either fixes the 262 K window blowup. The first is simpler and more conservative.
2. **Should compiled context be on by default once the artifact-store-persistence and greedy-recall issues are addressed?** It saves a lot of tokens; the only reason it isn't on is that it had sharp edges.
3. **At session start, what queries should drive the memory recall?** The cwd alone? The first user message? Both? This determines what gets injected and how relevant it feels.
4. **Should recall return prose or rows?** Prose costs an extra LLM call per recall but gives the model a denser, more usable context. Rows are cheaper but the model has to interpret them.
5. **Should the bash output reducer just be smarter about diffs, or should diff commands bypass it entirely?** The simpler version (bypass) is recommended above; the smarter version is more work for marginal benefit.
6. **What does the right experience for explicit memory look like in the TUI?** Does the user see "remembered: X" confirmations? "Recalled at session start: 3 facts about this repo"? Visibility matters for trust in an explicit-only system.
7. **Is the cross-cutting "what happened" data model in §4 worth unifying?** It's a real design problem but a big refactor; the question is whether the duplication actively hurts or just looks ugly.

---

## 10. Out of scope for this document

- Implementation. No code changes accompany this file.
- Prioritization. The above is a map, not a roadmap.
- Estimates. None given on purpose.

The next step is a conversation that picks one or two of the items in §7 and §9 and turns them into focused PRs.

---

## 11. Progress log

This section is updated as work lands. Dates are absolute. The research doc itself is intentionally not rewritten — the design/tensions stay legible.

### 2026-04-27 — Milestone 1 hotfix (`fix/auto-compact-and-diff-reducer`)

Branch: `fix/auto-compact-and-diff-reducer` off `main` at `5617f68` (PR #169).
Status: **merged to `main` and in production.**

Plan (from `~/.claude/plans/you-re-picking-up-work-concurrent-hippo.md`):

1. Bypass the bash output reducer for diff-style git commands (§0.5 Issue B, §6.5, §7.3 item 2).
2. Tighten the failure-keyword recall heuristic (§6.6, §7.3 item 3).
3. Auto-compact via the LLM summarizer when `compiledContext` is off (§0.5 Issue A, §6.1, §7.3 item 1).
4. Bonus: restore the `$` prefix on the right-status-bar cost cell (a pre-existing bug surfaced while running `npm test`; orthogonal to the research scope but cheap).

Commits on the branch (chronological):

| #  | Subject                                                                        | Touches                                                                  |
|----|--------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1  | `fix(reducer): bypass bash reducer for diff-style git commands`                | `src/tools/executor.ts`, `src/tools/executor.test.ts` (new)              |
| 2  | `fix(compaction): tighten failure-keyword artifact recall`                     | `src/agent/compaction.ts`, `src/agent/compaction.test.ts`                |
| 3  | `fix(compact): auto-compact via LLM summarizer when compiled context is off`   | `src/app.tsx`                                                            |
| 4  | `fix(status): restore $ prefix on cost cell in right status bar`               | `src/ui/status.tsx`                                                      |

Key implementation notes:

- **Diff bypass.** New exported `isDiffCommand(cmd)` in `src/tools/executor.ts`. Matches `git show` (excluding `show-ref` / `show-branch`), `git diff`, `git format-patch`, `git log` with `-p` / `--patch`, and `git stash show` with `-p` / `--patch`. When matched, the executor stores the raw output as an artifact (so `expand_artifact` still works) and returns the unreduced content. Unit-tested in `src/tools/executor.test.ts`.
- **Failure-keyword tightening.** The recall loop now requires `meta.summary` to contain the keyword too, not just any bash artifact. Honest caveat from the plan: with the existing entry shape `bash failed: <cmd>`, `failure.split(":")[0]` produces `"bash failed"`, and bash artifact summaries follow `bash: <cmd snippet>` — so the failure-keyword channel is now effectively dormant. That's the *defensive* outcome §7.3 item 3 called for; redesigning the keyword extractor belongs to Milestone 2. The file-path channel is unaffected and remains the higher-signal one.
- **Auto-compact fallback.** The post-turn block in `src/app.tsx` now checks `shouldCompact()` regardless of the flag. With the flag on, the heuristic `compactCompiled` runs as before. With the flag off, it falls back to `compactMessages` (the same async LLM summarizer the manual `/compact` command uses). The LLM call sits inside its own `try/catch` so a compaction failure surfaces as a non-fatal info event rather than killing the session — the turn that triggered it has already succeeded. Threshold reuses `shouldCompact()` defaults (80 K tokens / 12 turns) — no new tuning was introduced.

Verification:

- `npm run typecheck` clean across all four commits.
- `npm test` after the full set: **139 passing, 0 failing**. Before the `$` fix the suite had 138 pass / 1 pre-existing fail (`src/ui/status.test.ts`); the `$` commit fixes it.
- TUI smoke tests not yet run by the assistant; called out in the plan as a manual user step (drive a long session without `KIMIFLARE_COMPILED_CONTEXT=1` for Fix 1; trigger a merge conflict and ask for `git show`/`git diff` for Fix 2).

### Milestone 2 — in progress

Ordering: ArtifactStore persistence → Scout plumbing → Code Mode determinism → session-start recall.

#### PR 1 — `feat/artifact-store-persistence` (merged)

Addresses finding §6.2: `ArtifactStore` is not persisted, so `/resume` leaves compiled-context recall broken.

Changes:
- `src/agent/session-state.ts` — added `SerializedArtifact` interface, `serializeArtifactStore()`, and `deserializeArtifactStore()` functions. Serialization truncates raw content to 50 KB per artifact (matching the in-memory cap). Deserialization feeds artifacts back through `ArtifactStore.add()` so the same LRU/size limits apply.
- `src/sessions.ts` — added `artifactStore?: SerializedArtifact[]` to `SessionFile`.
- `src/app.tsx` — `saveSessionSafe` now includes `artifactStore: serializeArtifactStore(artifactStoreRef.current)`; `handleResumePick` restores the store via `deserializeArtifactStore(file.artifactStore)` when present, falling back to an empty `ArtifactStore` when absent.
- `src/agent/session-state.test.ts` — 4 new test cases: empty store round-trip, timestamp ordering, 50 KB truncation, and full inverse property.

Verification: `npm run typecheck` clean; `npm test` 145 passing, 0 failing (was 139 before this PR).

#### PR 2 — `feat/scout-plumbing` (merged)

Addresses finding §6.10: Memory write pipeline uses Kimi K2.6 for verification, topic-key normalization, and hypothetical-query generation — 3 LLM calls per `memory_remember`.

Changes:
- `src/memory/manager.ts` — `verifyMemory` and `generateHypotheticalQueries` now use `plumbingLlmOpts` (Llama 4 Scout) instead of the main model. `normalizeTopicKey` replaced with `deterministicTopicKey`: a pure function that lowercases, strips non-alphanumerics, replaces spaces with `_`, and truncates to 60 chars — zero LLM calls.
- `src/config.ts` — added `plumbingModel` config key, defaulting to `@cf/meta/llama-4-scout-17b-16e-instruct`.
- `src/app.tsx` — passes `plumbingModel` through to `MemoryManager`.

Verification: `npm run typecheck` clean; `npm test` passing.

#### PR 3 — `feat/code-mode-determinism` (in progress)

Addresses finding §6.4 / §7.4: Code Mode's TypeScript API is regenerated every turn and embedded in the `execute_code` tool description. Without determinism, property-key ordering jitter invalidates the Workers AI prefix cache from that point onward.

Changes:
- `src/code-mode/api-generator.ts` — Sorts `Object.entries()` and `Object.keys()` by key in `schemaToTsType`, `generateInterface`, and `generateTypeScriptApi`. Sorts the tools array by name. Sorts `required` arrays before passing to `generateInterface`.
- `src/agent/loop.ts` — Adds a module-level `codeModeApiCache` keyed by `stableStringify(opts.tools)`. The generated API string is only recomputed when the tool list actually changes (e.g., MCP connect/disconnect).
- `src/code-mode/api-generator.test.ts` — New test suite covering: identical output across different property-key insertion orders, identical output on repeated calls, tool-name sorting, simple declaration smoke test, no-parameters handling, and nested object property ordering.

Verification: `npm run typecheck` clean; `npm test` passing.
