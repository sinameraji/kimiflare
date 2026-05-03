# Adaptive Agent Routing: Development Plan

> **Branch:** `feat/adaptive-agent-routing`  
> **Status:** Planning complete. Ready for implementation.  
> **Context:** This plan was developed through extensive codebase audit and architectural discussion. It is designed to be self-contained: another agent should be able to read this document and execute any phase without access to the original conversation.

---

## Table of Contents

1. [Context & Motivation](#1-context--motivation)
2. [Current State Assessment](#2-current-state-assessment)
3. [Design Principles](#3-design-principles)
4. [Phase 1: `/init` Refresh](#4-phase-1-init-refresh)
5. [Phase 2: Memory Auto-Extraction](#5-phase-2-memory-auto-extraction)
6. [Phase 3: Intent Classification + Telemetry](#6-phase-3-intent-classification--telemetry)
7. [Phase 4: Code Mode Tier-Gating](#7-phase-4-code-mode-tier-gating)
8. [Phase 5: Parallel Research Agents](#8-phase-5-parallel-research-agents)
9. [Telemetry & Metrics](#9-telemetry--metrics)
10. [Architecture Diagrams](#10-architecture-diagrams)
11. [Appendix A: Intent Taxonomy](#appendix-a-intent-taxonomy)
12. [Appendix B: Extractor Registry](#appendix-b-extractor-registry)
13. [Appendix C: File Reference](#appendix-c-file-reference)

---

## 1. Context & Motivation

### Why We Started This Conversation

The KimiFlare agent currently treats every user prompt identically: it loads the full system prompt, KIMI.md, message history, and optional memory recall, then calls the LLM. There is no triage layer. A simple "What does this function do?" query gets the same context stack as a "Refactor the entire auth system" request.

This leads to three problems:

1. **Wasted tokens and latency** on light queries that don't need deep reasoning
2. **Stale project context** because KIMI.md is generated once via `/init` and never refreshed
3. **Empty agent memory** because we rely on users to explicitly say "remember this" — and they don't

### What We Want

An agent that:
- **Adapts to task complexity** — fast and light for simple queries, deep and thorough for heavy requests
- **Maintains fresh project context** without manual intervention
- **Accumulates project knowledge automatically** through bounded, deterministic extraction
- **Makes trade-offs explicit** — we optimize for cost and quality, not just speed

### What We Are NOT Doing

- No big-bang rewrite. Every phase is additive and reversible.
- No subjective agent judgment for memory extraction. The system decides what to remember, not the LLM.
- No premature optimization. We measure first, then tune.

---

## 2. Current State Assessment

### What Exists Today

| Component | Location | State |
|-----------|----------|-------|
| **Agent loop** | `src/agent/loop.ts` | Turn-based, max 50 iterations, no triage gate |
| **System prompt** | `src/agent/system-prompt.ts` | Static prefix + KIMI.md loading (capped at 20KB) |
| **Session state** | `src/agent/session-state.ts` | Tracks `repo_facts`, `files_touched`, `decisions` — only used during compaction |
| **Memory manager** | `src/memory/manager.ts` | SQLite + embeddings (768-dim), hybrid retrieval (vector + FTS + exact + RRF) |
| **Memory schema** | `src/memory/schema.ts` | `fact`, `event`, `instruction`, `task`, `preference` categories |
| **Memory DB** | `src/memory/db.ts` | Full schema with `topic_key`, `superseded_by`, `forgotten`, `vectorized` |
| **Cost attribution** | `src/cost-attribution/heuristic.ts` | 27-category deterministic classifier (runs post-hoc for cost reports) |
| **Code Mode** | `src/code-mode/sandbox.ts` | Replaces individual tools with single `execute_code` TS sandbox |
| **Telemetry** | `src/cost-debug.ts` | Per-turn JSONL logging: tokens, tool stats, cache diagnostics, prompt sections |
| **Usage tracking** | `src/usage-tracker.ts` | Per-session cost aggregation |
| **Session storage** | `src/sessions.ts` | Full message history + session state + artifact store |

### What's Broken or Underutilized

1. **KIMI.md is stale.** `/init` generates it once. If it exists, the command blocks with "delete it first." There is no incremental update mechanism.

2. **Agent memory is essentially empty.** The live DB (`~/.local/share/kimiflare/memory.db`) contains **2 memories total**, both behavioral instructions. The infrastructure (embeddings, FTS, supersession, topic keys) is solid but unused for project knowledge.

3. **No triage layer.** `processMessage()` in `src/app.tsx` pushes raw user text directly to `messagesRef` and calls `runAgentTurn()`. Every prompt gets the full stack.

4. **SessionState is underutilized.** Rich state exists (`repo_facts`, `open_questions`, `recent_failures`) but is only compressed into history summaries during compaction. It is never fed back as a live "present state" to prime future turns.

5. **Code Mode is a manual toggle.** `Ctrl+M` enables/disables it. The user doesn't know if it's on. There is no adaptive routing.

6. **Telemetry tracks cost but not intent.** We know how many tokens were used, but not whether the prompt was light, medium, or heavy. We cannot validate if our optimizations work.

---

## 3. Design Principles

1. **Incremental only.** No phase requires a rewrite of existing code. Every change is additive.
2. **Measure before optimizing.** Phase 0 (telemetry) must be in place before Phase 3 (intent classification) so we have a baseline.
3. **Bounded growth.** Memory extractors are finite and deterministic. The agent does not decide what to remember — the system does.
4. **Never sacrifice quality for speed.** Slow/high-quality is acceptable when necessary. Fast/low-quality is not.
5. **Make trade-offs explicit.** Code Mode saves tokens on heavy tasks but adds sandbox overhead. We document this, not hide it.
6. **User control.** Auto-behaviors can be overridden. `/init` refresh can be declined. Code Mode can be manually toggled.

---

## 4. Phase 1: `/init` Refresh

### Goal
Fix the daily annoyance where `/init` blocks if `KIMI.md` already exists. Make it refresh instead.

### Current Behavior
In `src/app.tsx`, `runInit()` loops through `["KIMI.md", "KIMIFLARE.md", "AGENT.md"]`. If any exists, it shows an info message and returns early:

```
"KIMI.md already exists at /path/to/KIMI.md — delete it first if you want to regenerate"
```

### Desired Behavior
- Detect if any context file exists.
- If yes, prompt the agent to **read the existing file first**, then update it (preserve accurate content, update what changed).
- If no, generate from scratch (current behavior).
- Show `/init (refreshing KIMI.md)` in the UI so the user knows what's happening.

### Implementation

**File:** `src/app.tsx`  
**Function:** `runInit()` (around line 1371)

**Changes needed:**

1. Replace the blocking loop with a detection + refresh prompt:

```typescript
const cwd = process.cwd();
const existingName = ["KIMI.md", "KIMIFLARE.md", "AGENT.md"].find((n) => existsSync(join(cwd, n)));
const isRefresh = existingName !== undefined;
```

2. Build a conditional prompt:

```typescript
const promptParts = [
  isRefresh
    ? `Regenerate ${existingName} at the repository root to refresh project context. If the file already exists, read it first and preserve anything still accurate, updating only what has changed.`
    : "Generate a KIMI.md at the repository root so future agents have project context.",
  "",
  "First, use the `glob`, `read`, and `grep` tools to understand the project: read `package.json`, the top-level `README.md` if present, the tsconfig / build config, and skim the top-level source directory structure.",
  isRefresh ? `Also read the existing ${existingName} so you know what to keep vs. update.` : null,
  "",
  "Then call the `write` tool to create `KIMI.md` at the repo root with these sections, terse (aim ≤ 100 lines total):",
  "",
  "- **Project** — one-line description + primary language/runtime.",
  "- **Build / test / run** — exact shell commands an agent should use.",
  "- **Layout** — key directories and what lives in each.",
  "- **Conventions** — naming, import style, file structure, commit style, anything surprising.",
  "- **Do / Don't** — quirks or rules future agents should know.",
  "",
  "Do not call `tasks_set` for this. Just read what you need, then write the file.",
];
const prompt = promptParts.filter((p): p is string => p !== null).join("\n");
```

3. Update the event text:

```typescript
setEvents((e) => [...e, { kind: "user", key: mkKey(), text: isRefresh ? `/init (refreshing ${existingName})` : "/init" }]);
```

### Success Criteria
- [ ] `/init` on a repo with existing `KIMI.md` does not block
- [ ] The agent reads the existing file before writing
- [ ] The UI shows `/init (refreshing KIMI.md)`
- [ ] Typecheck passes (`npm run typecheck`)

### Time Estimate
30 minutes

---

## 5. Phase 2: Memory Auto-Extraction

### Goal
Make the agent memory system useful by automatically extracting project facts from tool calls. No user prompting required.

### Why This Is Phase 2 (Not Phase 1)
We already built the memory infrastructure (SQLite, embeddings, FTS, retrieval, supersession). The DB has 2 entries. This is the highest-impact, lowest-risk fix: we're filling an existing database, not changing architecture.

### Core Design: Extractors, Not Agent Judgment

The agent does NOT decide what to remember. The SYSTEM decides via a **deterministic extractor registry**.

After every tool call in `runAgentTurn()`, we check if the tool + file path matches an extractor. If yes, we call `memory_remember` automatically with deterministic content.

#### Extractor Interface

```typescript
// src/memory/extractors.ts

export interface Extractor {
  /** Unique identifier for this extractor */
  id: string;
  /** Check if this extractor applies to a given tool call */
  match: (toolName: string, filePath: string | undefined) => boolean;
  /** Extract memory content from the tool result. Returns null if nothing to extract. */
  extract: (content: string, filePath: string | undefined) => {
    content: string;
    category: "fact" | "event";
    importance: number; // 1-5
    topicKey: string;
    relatedFiles?: string[];
  } | null;
}
```

#### Initial Extractor Registry (4 extractors)

**Extractor 1: `package_json`**
```typescript
{
  id: "package_json",
  match: (tool, file) => tool === "read" && /package\.json$/.test(file || ""),
  extract: (content, file) => {
    try {
      const pkg = JSON.parse(content);
      const deps = Object.keys(pkg.dependencies || {}).slice(0, 10);
      const devDeps = Object.keys(pkg.devDependencies || {}).slice(0, 5);
      const scripts = Object.keys(pkg.scripts || {}).slice(0, 5);
      return {
        content: `Project dependencies: ${deps.join(", ") || "none"}. Dev dependencies: ${devDeps.join(", ") || "none"}. Scripts: ${scripts.join(", ") || "none"}. Type: ${pkg.type || "commonjs"}.`,
        category: "fact",
        importance: 4,
        topicKey: "project_dependencies",
        relatedFiles: file ? [file] : undefined,
      };
    } catch {
      return null;
    }
  },
}
```

**Extractor 2: `tsconfig`**
```typescript
{
  id: "tsconfig",
  match: (tool, file) => tool === "read" && /tsconfig.*\.json$/.test(file || ""),
  extract: (content, file) => {
    try {
      const ts = JSON.parse(content);
      const opts = ts.compilerOptions || {};
      return {
        content: `TypeScript config: target=${opts.target || "default"}, module=${opts.module || "default"}, strict=${opts.strict || false}, jsx=${opts.jsx || "none"}.`,
        category: "fact",
        importance: 4,
        topicKey: "project_tsconfig",
        relatedFiles: file ? [file] : undefined,
      };
    } catch {
      return null;
    }
  },
}
```

**Extractor 3: `entry_point`**
```typescript
{
  id: "entry_point",
  match: (tool, file) => tool === "read" && /src\/(index|main)\.(ts|tsx|js|jsx)$/.test(file || ""),
  extract: (content, file) => {
    const exports = content.match(/export\s+(?:default\s+)?(?:function|class|const|interface|type)\s+(\w+)/g);
    const exportNames = exports ? exports.map(e => e.split(/\s+/).pop()).filter(Boolean).slice(0, 5) : [];
    return {
      content: `Entry point ${file} exports: ${exportNames.join(", ") || "default export or side effects"}.`,
      category: "fact",
      importance: 3,
      topicKey: "project_entry_point",
      relatedFiles: file ? [file] : undefined,
    };
  },
}
```

**Extractor 4: `edit_event`**
```typescript
{
  id: "edit_event",
  match: (tool, file) => (tool === "edit" || tool === "write") && !!file,
  extract: (content, file) => ({
    content: `File modified: ${file}.`,
    category: "event",
    importance: 2,
    topicKey: `event_edit_${(file || "unknown").replace(/[^a-zA-Z0-9]/g, "_")}`,
    relatedFiles: file ? [file] : undefined,
  }),
}
```

### Hook Location

After each tool call executes in `runAgentTurn()` (in `src/agent/loop.ts`), check extractors:

```typescript
// After tool result is received and added to messages
for (const extractor of EXTRACTORS) {
  if (extractor.match(toolCall.name, toolCall.args?.path)) {
    const memory = extractor.extract(toolResult.content, toolCall.args?.path);
    if (memory && memoryEnabled) {
      await memoryManager.remember({
        content: memory.content,
        category: memory.category,
        importance: memory.importance,
        topicKey: memory.topicKey,
        relatedFiles: memory.relatedFiles,
        sourceSessionId: sessionId,
        repoPath: cwd,
      });
    }
  }
}
```

### Supersession

Because each extractor returns a deterministic `topicKey`, repeated extractions automatically supersede old memories via the existing `superseded_by` mechanism in `src/memory/manager.ts`.

Example:
- Turn 1: Read package.json → memory with `topicKey: "project_dependencies"`
- Turn 5: Read package.json again → new memory with same `topicKey` → old memory gets `superseded_by` pointer

### Constraints

- Only 4 extractors to start. Bounded growth.
- No LLM call for extraction. Pure regex/JSON parsing.
- Only runs if `memoryEnabled` is true.
- `instruction` category remains user-driven. Extractors only produce `fact` and `event`.

### Success Criteria
- [ ] After 3 sessions on the same repo, `memory_recall` for query "project dependencies" returns the latest package.json facts
- [ ] Memory DB grows from 2 entries to 10+ after normal usage
- [ ] No duplicate facts for the same `topicKey` (supersession works)
- [ ] Typecheck passes

### Time Estimate
3-4 hours

---

## 6. Phase 3: Intent Classification + Telemetry

### Goal
Classify user prompts by complexity and adapt `reasoningEffort` accordingly. Add telemetry fields to measure if it works.

### Why This Is Phase 3 (Not Phase 1 or 2)
This is the first architecture change: a new gate before `runAgentTurn()`. We do it AFTER memory auto-extraction because:
1. We want the memory system working so the agent has project context during classification
2. We want telemetry in place to measure baseline vs. optimized performance

### Intent Taxonomy

| Intent | Pattern | Typical Tier |
|--------|---------|-------------|
| `qa` | "what", "how", "why", "explain" | light |
| `diagnose` | "broken", "failing", "error", "bug" | medium |
| `verify` | "correct", "review", "check", "is this" | light |
| `polish` | "rename", "refactor", "extract", "clean" | medium |
| `small_edit` | "add", "change", "fix" + specific target | medium |
| `feature_bounded` | "add", "implement" + flag/option/param | medium |
| `feature_exploratory` | "add", "implement", "migrate" + module/system | heavy |
| `explore` | "how does X work", "architecture", "structure" | heavy |
| `meta` | "plan", "design", "strategy", "ontology" | heavy |

### Classification Function

**File:** `src/intent/classify.ts`

```typescript
export interface IntentResult {
  intent: string;
  rawScore: number;      // 0.0 - 1.0
  tier: "light" | "medium" | "heavy";
  confidence: number;    // 0.0 - 1.0
}

const INTENT_PATTERNS: Record<string, RegExp> = {
  qa: /\b(what|how|why|explain|describe|what's|what is)\b/i,
  diagnose: /\b(broken|failing|error|bug|crash|why.*fail|not working)\b/i,
  verify: /\b(correct|right|verify|review|check|is this|does this)\b/i,
  polish: /\b(rename|refactor|extract|move|clean|lint|format)\b/i,
  small_edit: /\b(add|change|update|fix|remove|delete)\b.+\b(line|here|this|variable|function)\b/i,
  feature_bounded: /\b(add|implement|create|support)\b.+\b(flag|option|param|arg|field)\b/i,
  feature_exploratory: /\b(add|implement|migrate|integrate|build)\b.+\b(module|system|auth|oauth|framework|service)\b/i,
  explore: /\b(how.*work|architecture|structure|where.*used|find.*all|understand)\b/i,
  meta: /\b(plan|design|strategy|ontology|roadmap|approach)\b/i,
};

export function classifyIntent(prompt: string): IntentResult {
  let intentScore = 0;
  let matchedIntent = "other";

  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    const matches = (prompt.match(pattern) || []).length;
    if (matches > intentScore) {
      intentScore = matches;
      matchedIntent = intent;
    }
  }

  const hasFileMentions = (prompt.match(/@\w+|\b[\w/-]+\.(ts|tsx|js|jsx|py|go|rs)\b/g) || []).length;
  const hasMutatingVerb = /\b(add|create|write|edit|delete|remove|rename|migrate|implement)\b/i.test(prompt);
  const isQuestion = prompt.trim().endsWith("?") || /\b(what|how|why|is|does|can)\b/i.test(prompt.split(" ")[0] || "");

  const rawScore = Math.min(1.0,
    intentScore * 0.25 +
    (hasFileMentions > 2 ? 0.3 : hasFileMentions * 0.1) +
    (hasMutatingVerb ? 0.25 : 0) +
    (isQuestion ? 0 : 0.1)
  );

  const tier = rawScore < 0.3 ? "light" : rawScore < 0.65 ? "medium" : "heavy";

  return {
    intent: matchedIntent,
    rawScore,
    tier,
    confidence: 0.5 + (intentScore > 0 ? 0.3 : 0) + (hasFileMentions > 0 ? 0.1 : 0),
  };
}
```

### Integration Point

In `src/app.tsx`, `processMessage()`:

```typescript
// Before runAgentTurn()
const classification = classifyIntent(text);

// Adjust reasoning effort based on tier
const effortForTier: Record<string, "low" | "medium" | "high"> = {
  light: "low",
  medium: "medium",
  heavy: "high",
};
const reasoningEffort = effortForTier[classification.tier] || effortRef.current;

// Pass classification to telemetry
// ... runAgentTurn({ ..., reasoningEffort, intentClassification: classification })
```

### Telemetry Fields (3 new fields)

Extend `CostDebugEntry` in `src/cost-debug.ts`:

```typescript
export interface CostDebugEntry {
  // ... existing fields ...
  durationMs?: number;                    // NEW: wall-clock time for this turn
  intentClassification?: {                // NEW: what we predicted
    intent: string;
    tier: "light" | "medium" | "heavy";
    rawScore: number;
    confidence: number;
  };
  codeMode?: boolean;                     // NEW: was Code Mode enabled this turn
}
```

**Duration measurement:** In `src/app.tsx`, wrap `runAgentTurn()`:

```typescript
const start = performance.now();
await runAgentTurn({ ... });
const durationMs = Math.round(performance.now() - start);
```

### Success Criteria
- [ ] Light-classified prompts have ≥20% lower median latency vs. baseline
- [ ] Light-classified prompts have ≤5% increase in turn count (quality doesn't degrade)
- [ ] Confidence score correlates with accuracy (high confidence = correct tier)
- [ ] Typecheck passes

### Validation Query

After a few sessions, run:

```bash
python3 -c "
import json
from collections import defaultdict
by_tier = defaultdict(lambda: {'turns': [], 'tokens': [], 'durations': []})
with open('~/.local/share/kimiflare/cost-debug.jsonl') as f:
    for line in f:
        d = json.loads(line)
        if 'intentClassification' in d:
            tier = d['intentClassification']['tier']
            by_tier[tier]['turns'].append(d['turn'])
            by_tier[tier]['tokens'].append(d['usage']['total_tokens'])
            by_tier[tier]['durations'].append(d.get('durationMs', 0))
for tier in ['light', 'medium', 'heavy']:
    t = by_tier[tier]
    if t['turns']:
        print(f'{tier}: avg {sum(t[\"turns\"])/len(t[\"turns\"]):.1f} turns, '
              f'avg {sum(t[\"tokens\"])/len(t[\"tokens\"]):.0f} tokens, '
              f'avg {sum(t[\"durations\"])/len(t[\"durations\"]):.0f}ms')
"
```

### Time Estimate
2-3 hours

---

## 7. Phase 4: Code Mode Tier-Gating

### Goal
Automatically enable Code Mode for heavy tasks to save tokens. Respect manual override.

### Code Mode Trade-Offs (Documented)

| Dimension | Direct Tools | Code Mode | Winner |
|-----------|-------------|-----------|--------|
| Speed (light: 1 read) | Faster | Slower (sandbox overhead) | Direct |
| Speed (heavy: 10+ reads) | Slower (many LLM round-trips) | Faster (batches in one script) | Code Mode |
| Token cost | Higher (each result feeds back into LLM) | Lower (only console.log returns) | Code Mode |
| Reliability | Higher | Lower (sandbox crashes, TS errors) | Direct |
| Parallelism | Sequential | Can run loops, Promise.all | Code Mode |

**Code Mode optimizes token cost and batching for heavy tasks.** It is NOT universally faster.

### Integration

In `src/app.tsx`, after intent classification:

```typescript
// Auto-enable Code Mode for heavy tasks unless manually toggled
const shouldUseCodeMode = classification.tier === "heavy" && !userManuallyDisabledCodeMode;
if (shouldUseCodeMode) {
  setCodeMode(true);
}
```

After the turn completes, restore the user's manual preference:

```typescript
if (shouldUseCodeMode && !userHadCodeModeOn) {
  setCodeMode(false);
}
```

### Success Criteria
- [ ] Heavy tasks with Code Mode use ≥15% fewer tokens than heavy tasks without
- [ ] Code Mode tasks have ≤10% higher error rate
- [ ] Manual `Ctrl+M` toggle is always respected
- [ ] Typecheck passes

### Time Estimate
1 hour

---

## 8. Phase 5: Parallel Research Agents

### Goal
For exploratory tasks, parallelize file reads to reduce wall-clock time.

### Trigger Conditions
- `intent === "explore"` AND `tier === "heavy"`
- OR user explicitly requests parallel research

### Architecture

Spawn 3-5 lightweight agents, each with a subset of files:

```
Main Agent ──▶ "Explore the auth system"
       │
       ├──▶ Agent 1: reads auth/*.ts
       ├──▶ Agent 2: reads middleware/*.ts
       ├──▶ Agent 3: reads tests/auth/*.ts
       │
       └──▶ Main Agent synthesizes summaries
```

### Success Criteria
- [ ] Exploratory tasks complete in ≥30% less wall-clock time
- [ ] Parallel tasks have ≤5% increase in total tokens
- [ ] Synthesized answer covers ≥90% of what sequential research would find

### Time Estimate
4-6 hours

---

## 9. Telemetry & Metrics

### What We Already Track

**`cost-debug.jsonl`** (per-turn):
- `sessionId`, `turn`, `ts`
- `usage`: prompt_tokens, completion_tokens, total_tokens
- `promptSections`: breakdown by role with char counts
- `toolStats`: which tools, raw vs reduced bytes
- `cacheDiagnostics`: static/session/dynamic prefix chars, cache hit ratio
- `signals`: cost attribution categories

**`usage.json`** (per-session):
- `id`, `date`, `promptTokens`, `completionTokens`, `cachedTokens`, `cost`

### What We Add

| Field | Location | Purpose |
|-------|----------|---------|
| `durationMs` | `cost-debug.jsonl` | Measure latency per turn |
| `intentClassification` | `cost-debug.jsonl` | Track predicted vs actual |
| `codeMode` | `cost-debug.jsonl` | Track Code Mode usage |

### What We Do NOT Put in the Memory DB

Telemetry is time-series operational data. The memory DB is designed for semantic search (embeddings, topic keys, supersession). Mixing them would waste embeddings on metrics that will never be semantically searched.

**Exception:** Session summaries could be stored as `event` memories for cross-session recall ("What did we work on last time?").

### Validation Queries

**Baseline (before Phase 3):**
```bash
# Average turns per session
python3 -c "import json; from collections import Counter; turns = Counter(); [turns.update({json.loads(l)['sessionId']: 1}) for l in open('cost-debug.jsonl')]; print(f'Avg: {sum(turns.values())/len(turns):.1f}')"

# Average tokens per turn
python3 -c "import json; lines = [json.loads(l) for l in open('cost-debug.jsonl')]; print(f'Avg prompt: {sum(l['usage']['prompt_tokens'] for l in lines)/len(lines):.0f}')"
```

**After Phase 3:**
```bash
# Compare light vs medium vs heavy
python3 -c "
import json
from collections import defaultdict
by_tier = defaultdict(lambda: {'turns': [], 'tokens': [], 'durations': []})
for line in open('cost-debug.jsonl'):
    d = json.loads(line)
    if 'intentClassification' in d:
        t = d['intentClassification']['tier']
        by_tier[t]['turns'].append(d['turn'])
        by_tier[t]['tokens'].append(d['usage']['total_tokens'])
        by_tier[t]['durations'].append(d.get('durationMs', 0))
for tier in ['light', 'medium', 'heavy']:
    t = by_tier[tier]
    if t['turns']:
        print(f'{tier}: {sum(t[\"turns\"])/len(t[\"turns\"]):.1f} turns, {sum(t[\"tokens\"])/len(t[\"tokens\"]):.0f} tokens, {sum(t[\"durations\"])/len(t[\"durations\"]):.0f}ms')
"
```

---

## 10. Architecture Diagrams

### Current Flow (Today)

```
User Message
     │
     ▼
┌─────────────────┐
│ messagesRef     │
│ (raw text)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│      runAgentTurn()         │
│                             │
│  ┌─────────────────────┐    │
│  │ System Prompt       │    │
│  │ + KIMI.md (stale)   │    │
│  │ + Full History      │    │
│  │ + Memory Recall     │    │
│  └─────────────────────┘    │
│            │                │
│            ▼                │
│           LLM ──▶ Response  │
│            │                │
│            ▼                │
│      Tool Calls? ──▶ Loop   │
└─────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ cost-debug.jsonl│
│ (tokens, tools) │
└─────────────────┘
```

### Phase 1: `/init` Refresh

```
/init command
     │
     ▼
┌─────────────────┐
│ File exists?    │
└────────┬────────┘
    ┌────┴────┐
    ▼         ▼
   YES       NO
    │         │
    ▼         ▼
┌─────────────────────┐   ┌─────────────────────┐
│ "Read existing      │   │ "Generate from      │
│  file, then update" │   │  scratch"           │
└─────────────────────┘   └─────────────────────┘
```

### Phase 2: Memory Auto-Extraction

```
┌─────────────────────────────────────────────────────────────┐
│                      runAgentTurn()                         │
│                                                             │
│   LLM ──▶ Tool Call ──▶ execute tool ──▶ Result            │
│                              │                              │
│                              ▼                              │
│                    ┌─────────────────┐                      │
│                    │ Extractor Match?│                      │
│                    │ (deterministic) │                      │
│                    └────────┬────────┘                      │
│                             │                               │
│              ┌──────────────┼──────────────┐               │
│              ▼              ▼              ▼               │
│        ┌─────────┐   ┌─────────┐   ┌─────────┐            │
│        │package  │   │tsconfig │   │ edit    │            │
│        │.json    │   │.json    │   │ event   │            │
│        └────┬────┘   └────┬────┘   └────┬────┘            │
│             │             │             │                  │
│             ▼             ▼             ▼                  │
│        memory_remember  memory_remember  memory_remember   │
│        (fact, key=      (fact, key=      (event, key=      │
│         "deps")          "tsconfig")     "edit_<file>")    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Phase 3: Intent Classification

```
User Message
     │
     ▼
┌──────────────────┐
│ classifyIntent() │◄── Regex/keyword heuristic
│  (< 1ms)         │    (no LLM call)
└────────┬─────────┘
         │
    ┌────┴────┬──────────────┐
    ▼         ▼              ▼
┌────────┐ ┌────────┐  ┌────────┐
│ LIGHT  │ │ MEDIUM │  │ HEAVY  │
│ score  │ │ score  │  │ score  │
│ < 0.30 │ │ 0.30-  │  │ > 0.65 │
└────┬───┘ │ 0.65   │  └────┬───┘
     │     └────┬───┘       │
     ▼          ▼           ▼
reasoningEffort reasoningEffort reasoningEffort
= "low"         = "medium"      = "high"
     │          │           │
     └──────────┴───────────┘
                │
                ▼
       ┌─────────────────┐
       │  runAgentTurn() │
       └─────────────────┘
```

---

## Appendix A: Intent Taxonomy

| Intent | Keywords | Typical Tier | reasoningEffort |
|--------|----------|-------------|-----------------|
| `qa` | what, how, why, explain, describe | light | low |
| `diagnose` | broken, failing, error, bug, crash | medium | medium |
| `verify` | correct, review, check, is this, does this | light | low |
| `polish` | rename, refactor, extract, clean, lint | medium | medium |
| `small_edit` | add/change/fix + line/here/this/function | medium | medium |
| `feature_bounded` | add/implement + flag/option/param | medium | medium |
| `feature_exploratory` | add/implement/migrate + module/system/auth | heavy | high |
| `explore` | how does X work, architecture, structure | heavy | high |
| `meta` | plan, design, strategy, ontology, roadmap | heavy | high |

### Scoring Weights (v1)

```
rawScore = min(1.0,
  intentScore * 0.25 +
  fileMentionsScore +
  mutatingVerbScore +
  questionPenalty
)

where:
  intentScore = number of regex matches for the top intent
  fileMentionsScore = 0.3 if >2 files mentioned, else fileCount * 0.1
  mutatingVerbScore = 0.25 if prompt contains add/create/write/edit/delete/remove/rename/migrate/implement
  questionPenalty = 0 if prompt is a question, else 0.1

tier = "light" if rawScore < 0.30
       "medium" if 0.30 <= rawScore < 0.65
       "heavy" if rawScore >= 0.65

confidence = 0.5 + (intentScore > 0 ? 0.3 : 0) + (fileMentions > 0 ? 0.1 : 0)
```

---

## Appendix B: Extractor Registry

### Extractor 1: `package_json`

| Field | Value |
|-------|-------|
| `id` | `"package_json"` |
| `match` | `tool === "read" && /package\.json$/.test(file)` |
| `category` | `"fact"` |
| `topicKey` | `"project_dependencies"` |
| `importance` | `4` |
| `extract` | Parse JSON, extract `dependencies` (top 10), `devDependencies` (top 5), `scripts` (top 5), `type` |

### Extractor 2: `tsconfig`

| Field | Value |
|-------|-------|
| `id` | `"tsconfig"` |
| `match` | `tool === "read" && /tsconfig.*\.json$/.test(file)` |
| `category` | `"fact"` |
| `topicKey` | `"project_tsconfig"` |
| `importance` | `4` |
| `extract` | Parse JSON, extract `compilerOptions.target`, `.module`, `.strict`, `.jsx` |

### Extractor 3: `entry_point`

| Field | Value |
|-------|-------|
| `id` | `"entry_point"` |
| `match` | `tool === "read" && /src\/(index|main)\.(ts|tsx|js|jsx)$/.test(file)` |
| `category` | `"fact"` |
| `topicKey` | `"project_entry_point"` |
| `importance` | `3` |
| `extract` | Regex export declarations, extract top 5 export names |

### Extractor 4: `edit_event`

| Field | Value |
|-------|-------|
| `id` | `"edit_event"` |
| `match` | `(tool === "edit" \|\| tool === "write") && !!file` |
| `category` | `"event"` |
| `topicKey` | `"event_edit_" + file.replace(/[^a-zA-Z0-9]/g, "_")` |
| `importance` | `2` |
| `extract` | Static string: `"File modified: {file}"` |

---

## Appendix C: File Reference

| File | Purpose | Modified In Phase |
|------|---------|-------------------|
| `src/app.tsx` | TUI root, `processMessage()`, `runInit()`, `runAgentTurn()` wrapper | 1, 3, 4 |
| `src/agent/loop.ts` | Core turn loop, tool execution | 2 (extractor hook) |
| `src/agent/system-prompt.ts` | System prompt assembly | 2 (add extractor instructions) |
| `src/cost-debug.ts` | Telemetry schema and logging | 3 (add 3 fields) |
| `src/memory/extractors.ts` | **NEW:** Extractor registry | 2 |
| `src/intent/classify.ts` | **NEW:** Intent classification heuristic | 3 |
| `src/memory/manager.ts` | Memory CRUD, supersession | 2 (call from loop) |
| `src/memory/schema.ts` | Memory type definitions | — (read-only reference) |
| `src/memory/db.ts` | SQLite schema and queries | — (read-only reference) |

---

## Quick Reference: Phase Checklist

### Phase 1: `/init` Refresh
- [ ] Modify `runInit()` in `src/app.tsx`
- [ ] Detect existing context file
- [ ] Build conditional refresh prompt
- [ ] Update UI event text
- [ ] Typecheck passes

### Phase 2: Memory Auto-Extraction
- [ ] Create `src/memory/extractors.ts` with 4 extractors
- [ ] Add extractor hook in `src/agent/loop.ts` after tool execution
- [ ] Add system prompt instruction: "After read/edit/write calls, extractors may auto-remember facts"
- [ ] Verify supersession works (same topicKey overwrites old memory)
- [ ] Typecheck passes

### Phase 3: Intent Classification + Telemetry
- [ ] Create `src/intent/classify.ts` with heuristic
- [ ] Add `durationMs`, `intentClassification`, `codeMode` to `CostDebugEntry`
- [ ] Wrap `runAgentTurn()` with `performance.now()` in `src/app.tsx`
- [ ] Call `classifyIntent()` before `runAgentTurn()`
- [ ] Map tier to `reasoningEffort`
- [ ] Typecheck passes

### Phase 4: Code Mode Tier-Gating
- [ ] Auto-enable Code Mode for `tier === "heavy"`
- [ ] Respect manual `Ctrl+M` override
- [ ] Restore manual preference after turn
- [ ] Typecheck passes

### Phase 5: Parallel Research Agents
- [ ] Define spawn conditions (`explore` + `heavy`)
- [ ] Implement agent pool with file subset distribution
- [ ] Implement result synthesis
- [ ] Typecheck passes

---

*End of plan. This document is self-contained. Any agent reading this should be able to execute Phase 1 without additional context.*
