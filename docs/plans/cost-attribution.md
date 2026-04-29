# Development Plan: Cost Attribution by Task Type (#196)

> Status: Draft — ready for review  
> Branch: `feat/cost-attribution`  
> Estimates: Phase 1 (1 wk) → Phase 2 (3–5 d) → Phase 3 (3 d) → Phase 4 (ongoing)

---

## 1. Goal

Ship `kimiflare cost`, a CLI command that maps spend to **literal task types** derived from what the user actually did — what files were touched, what tools were used, what content was consumed. Uses existing local telemetry (`usage-tracker.ts`, `sessions.ts`, `cost-debug.jsonl`) plus Cloudflare GraphQL Analytics ground truth.

**Key principle:** Categories are literal and unambiguous. "reading-web-content" means exactly that. No abstract intent guessing like "learning" or "exploring."

---

## 2. Opt-In Gating

Cost attribution is **off by default**. Users opt in via config or env var.

```ts
// src/config.ts — additive
export interface KimiConfig {
  // ... existing fields
  costAttribution?: boolean; // default: false
}
```

Or env var: `KIMI_COST_ATTRIBUTION=1`

**Why opt-in:**
- No runtime cost or latency for users who don't care
- Privacy — session pattern analysis only happens when explicitly enabled
- Simpler default experience — fewer moving parts

When enabled, classification runs **lazily** on first `kimiflare cost` invocation. No cost during normal chat usage.

---

## 3. Literal Taxonomy (v1)

Categories are derived from **observable actions + file types + tool names**. No interpretation of user intent.

### Reading (by what was consumed)

| Category | Trigger |
|----------|---------|
| `reading-source-code` | `read_file` on `.ts`, `.py`, `.go`, `.rs`, `.js`, `.jsx`, `.tsx`, etc. |
| `reading-documentation` | `read_file` on `.md`, `.txt`, `README`, inline comments, `.rst` |
| `reading-configuration` | `read_file` on `.json`, `.yaml`, `.toml`, `.env`, `.ini`, `.conf` |
| `reading-web-content` | `web_fetch` tool calls (API docs, Stack Overflow, GitHub issues, fetched pages) |
| `reading-data` | `read_file` on `.csv`, `.sql`, `.db`, `.parquet`, migration files |
| `reading-logs-output` | `bash` output containing error traces, test output, logs, stack traces |

### Writing / Creating (by what was created)

| Category | Trigger |
|----------|---------|
| `writing-source-code` | `create_file` / `write_file` for source code files |
| `writing-documentation` | `create_file` / `write_file` for `.md`, `README`, docs |
| `writing-configuration` | `create_file` / `write_file` for `.json`, `.yaml`, `.env`, etc. |
| `writing-tests` | `create_file` / `write_file` for `.test.*`, `.spec.*`, test fixtures |

### Editing / Modifying (by what was changed)

| Category | Trigger |
|----------|---------|
| `editing-source-code` | `str_replace` / `edit` on source code files |
| `editing-documentation` | `str_replace` / `edit` on `.md`, `README`, docs |
| `editing-configuration` | `str_replace` / `edit` on config files |

### Running / Executing (by command type)

| Category | Trigger |
|----------|---------|
| `running-tests` | `bash` with `npm test`, `pytest`, `jest`, `cargo test`, `go test` |
| `running-git-commands` | `bash` with `git commit`, `git merge`, `git rebase`, `git diff` |
| `running-build-scripts` | `bash` with `npm run build`, `make`, `cargo build`, `go build` |
| `running-deploy-commands` | `bash` with `docker`, `kubectl`, `wrangler deploy`, `terraform apply` |
| `running-shell-commands` | All other `bash` invocations |

### Searching

| Category | Trigger |
|----------|---------|
| `searching-code` | `grep`, `glob` for source files |
| `searching-web` | `web_fetch` for search/exploration (distinct from reading the result) |

### Fallback

| Category | Trigger |
|----------|---------|
| `other` | Anything that doesn't match above; short Q&A, misc |

**Total: 22 categories.**

---

## 4. Classification Approach: Dominant Category (v1) + Per-Turn Signal Collection (v2)

### 4.1 v1: Dominant Category Per Session

Each session gets **one** category — whichever activity consumed the most tokens (or had the most tool calls). Simple, fast, sufficient for cost attribution.

**Example:** A bug-fix session costs $5 total:
- `reading-logs-output` — $0.50 (seeing the error)
- `reading-source-code` — $1.00 (finding the file)
- `editing-source-code` — $2.50 (the fix)
- `running-tests` — $1.00 (verifying)

→ Session categorized as `editing-source-code` (dominant spend).

### 4.2 v2: Proportional Split (Future)

The same session contributes to **four categories proportionally**:
- `reading-logs-output` — 10% of $5 = $0.50
- `reading-source-code` — 20% of $5 = $1.00
- `editing-source-code` — 50% of $5 = $2.50
- `running-tests` — 20% of $5 = $1.00

**How we prepare for v2 without building it now:**

Every turn already writes to `cost-debug.jsonl` with:
- Tool calls made in that turn
- Files touched
- Token usage for that turn

We **extend** `cost-debug.jsonl` with a `signals` field — a list of literal categories detected in that turn (no LLM, just heuristic pattern matching). This data is collected silently when `costAttribution` is enabled. In v2, we aggregate these per-turn signals into proportional splits.

```ts
// cost-debug.jsonl entry (extended)
{
  "v": 1,
  "ts": "2026-04-29T...",
  "sessionId": "abc123",
  "turn": 3,
  "usage": { ... },
  "signals": ["reading-source-code", "editing-source-code"], // NEW
  "toolStats": [ ... ]
}
```

### 4.3 Classification Pipeline

**Layer 1 — Heuristic (default, free)**

Rules derived from tool calls + file extensions + bash command patterns:

| Condition | Category | Confidence |
|-----------|----------|------------|
| `create_file` / `write_file` with `.ts`/`.py`/etc. | `writing-source-code` | 0.90 |
| `create_file` / `write_file` with `.md`/README | `writing-documentation` | 0.90 |
| `create_file` / `write_file` with `.json`/`.yaml` | `writing-configuration` | 0.90 |
| `create_file` / `write_file` with `.test.*`/`.spec.*` | `writing-tests` | 0.90 |
| `str_replace` / `edit` on source file | `editing-source-code` | 0.85 |
| `str_replace` / `edit` on `.md` | `editing-documentation` | 0.85 |
| `str_replace` / `edit` on config file | `editing-configuration` | 0.85 |
| `read_file` on source file | `reading-source-code` | 0.80 |
| `read_file` on `.md`/README | `reading-documentation` | 0.80 |
| `read_file` on config file | `reading-configuration` | 0.80 |
| `read_file` on `.csv`/`.sql`/`.db` | `reading-data` | 0.80 |
| `web_fetch` | `reading-web-content` | 0.85 |
| `bash` with `npm test`/`pytest`/`jest` | `running-tests` | 0.90 |
| `bash` with `git commit`/`merge`/`rebase` | `running-git-commands` | 0.90 |
| `bash` with `npm run build`/`make`/`cargo build` | `running-build-scripts` | 0.90 |
| `bash` with `docker`/`kubectl`/`wrangler deploy` | `running-deploy-commands` | 0.90 |
| `grep`/`glob` on source files | `searching-code` | 0.75 |
| `bash` output contains error trace / stack trace | `reading-logs-output` | 0.70 |
| Short session (< 3 turns, < 5 tool calls) | `other` | 0.60 |

**Dominant category selection:**
1. Collect all signals across the session
2. Weight by token usage per turn (or tool-call count if token data unavailable)
3. Pick the category with highest weighted score
4. Confidence = weighted score / total score

**Fallback to LLM:** If confidence < 0.6 OR top two categories are within 10% of each other.

**Layer 2 — LLM Fallback (~$0.0002/session)**

Triggered only for ambiguous sessions. Prompt:

```
Classify this kimiflare session into one literal category.

First user message: <first 300 chars>
Tool calls: read_file=4(str_replace=2(bash=1(web_fetch=1
Files touched: src/foo.ts, README.md, package.json
Commands run: npm test

Categories: reading-source-code, reading-documentation, reading-configuration, reading-web-content, reading-data, reading-logs-output, writing-source-code, writing-documentation, writing-configuration, writing-tests, editing-source-code, editing-documentation, editing-configuration, running-tests, running-git-commands, running-build-scripts, running-deploy-commands, running-shell-commands, searching-code, searching-web, other

Respond with JSON: { "category": "...", "confidence": 0.0–1.0, "summary": "one-line description" }
```

Uses cheapest available model (Llama-4-Scout or similar). Cached forever.

---

## 5. Data Model

### 5.1 Extend `SessionUsage` in `usage.json`

```ts
// src/usage-tracker.ts — additive changes
export interface SessionUsage {
  id: string;
  date: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  gatewayRequests?: number;
  gatewayCachedRequests?: number;
  gatewayCost?: number;
  gatewayLogs?: GatewayUsageSnapshot[];
  // NEW — cost attribution fields
  category?: TaskCategory;
  confidence?: number;
  classifiedBy?: "heuristic" | "llm" | "user";
  classifiedAt?: string;
  summary?: string;
  tags?: string[];
}
```

### 5.2 Extend `CostDebugEntry` with signals

```ts
// src/cost-debug.ts — additive
export interface CostDebugEntry {
  v: number;
  ts: string;
  sessionId: string;
  turn: number;
  usage: Usage;
  signals?: TaskCategory[]; // NEW — literal categories detected this turn
  promptSections: PromptSection[];
  // ... rest unchanged
}
```

---

## 6. CLI Command: `kimiflare cost`

### 6.1 Commander setup

```ts
// src/index.tsx
program
  .command("cost")
  .description("Show cost attribution by task type (requires costAttribution enabled)")
  .option("-w, --week", "last 7 days (default)")
  .option("-m, --month", "last 30 days")
  .option("-d, --day", "today only")
  .option("-s, --session <id>", "single session detail")
  .option("-c, --category <name>", "filter by category")
  .option("--json", "machine-readable output")
  .option("--reclassify", "re-run classification on all sessions")
  .option("--local-only", "skip Cloudflare reconciliation")
  .action(async (opts) => {
    // Check if costAttribution is enabled
    // If not, print: "Enable cost attribution with KIMI_COST_ATTRIBUTION=1 or add costAttribution: true to ~/.config/kimiflare/config.json"
  });
```

### 6.2 Terminal Output

```
$ KIMI_COST_ATTRIBUTION=1 kimiflare cost --week

                  This week    Last week
editing-source-code   $32.10       $28.40    ↑
reading-source-code    $8.20       $14.10    ↓
running-tests          $3.90        $5.80    ↓
reading-web-content    $1.80        $2.20    ↓
writing-source-code    $0.00        $0.00    →
─────────────────────────────────────────
Total                 $46.00       $50.50    ↓

Top sessions this week:
  $5.20  Mon  editing-source-code — cache-stable prefix engineering
  $3.40  Tue  reading-source-code — merge conflict resolution
  $2.80  Wed  editing-source-code — artifact store persistence

Verified against Cloudflare: ✓ (within 0.5%)
```

### 6.3 JSON Output (`--json`)

```json
{
  "period": { "start": "2026-04-22", "end": "2026-04-29" },
  "categories": [
    { "category": "editing-source-code", "thisPeriod": { "cost": 32.10, "tokens": 45000, "sessions": 12 }, "lastPeriod": { "cost": 28.40, "tokens": 39000, "sessions": 10 }, "changePct": 13.0 },
    { "category": "reading-source-code", "thisPeriod": { "cost": 8.20, "tokens": 12000, "sessions": 5 }, "lastPeriod": { "cost": 14.10, "tokens": 21000, "sessions": 8 }, "changePct": -41.8 }
  ],
  "topSessions": [
    { "sessionId": "abc123", "date": "2026-04-28", "cost": 5.20, "category": "editing-source-code", "summary": "cache-stable prefix engineering" }
  ],
  "reconciliation": { "status": "verified", "localCost": 46.00, "cloudflareCost": 46.23, "driftPct": 0.5 }
}
```

---

## 7. Cloudflare Reconciliation

Same as original plan. Reuse existing `fetchGatewayUsageSnapshot` pattern or add `fetchAnalyticsRange()`.

```ts
// src/cost-attribution/reconcile.ts
export interface ReconciliationResult {
  status: "verified" | "drift" | "error" | "local-only";
  localCost: number;
  cloudflareCost?: number;
  driftPct?: number;
  message?: string;
}
```

- **Verified:** drift ≤ 1% → ✓
- **Drift:** drift > 1% → ✗ with hint
- **Error:** API failure → ⚠
- **Local-only:** `--local-only` or missing credentials

Cache in memory for 1 hour.

---

## 8. File Layout

```
src/
  cost-attribution/
    index.ts          # public API: buildReport(), classifySession()
    types.ts          # TaskCategory, TaskCategorization, report interfaces
    heuristic.ts      # Layer 1: rule-based classification + dominant selection
    llm-classifier.ts # Layer 2: LLM fallback
    report.ts         # Report builder: aggregate sessions into CategoryReport
    renderer.ts       # Terminal + JSON output
    reconcile.ts      # Cloudflare GraphQL reconciliation
    git-diff.ts       # Helper: git diff summary for a session cwd
  index.tsx           # Add "cost" subcommand + opt-in check
  usage-tracker.ts    # Extend SessionUsage with category fields
  cost-debug.ts       # Extend CostDebugEntry with signals field
  config.ts           # Add costAttribution?: boolean
```

---

## 9. Testing Strategy

### 9.1 Unit tests

| Test | Location |
|------|----------|
| Heuristic rules — each of 22 categories | `src/cost-attribution/heuristic.test.ts` |
| Dominant category selection (weighted scoring) | `src/cost-attribution/heuristic.test.ts` |
| Report aggregation (group by category, period) | `src/cost-attribution/report.test.ts` |
| Renderer output (80-column wrap, arrows) | `src/cost-attribution/renderer.test.ts` |
| Reconciliation math | `src/cost-attribution/reconcile.test.ts` |
| LLM classifier prompt formatting | `src/cost-attribution/llm-classifier.test.ts` |
| Config opt-in gating | `src/index.tsx` (integration) |

### 9.2 Test fixtures

```ts
// src/cost-attribution/fixtures.ts
export const fixtureEditingSourceCode: SessionFile = { /* str_replace on .ts */ };
export const fixtureReadingWebContent: SessionFile = { /* web_fetch calls */ };
export const fixtureRunningTests: SessionFile = { /* bash with npm test */ };
export const fixtureMixedSignals: SessionFile = { /* ambiguous, triggers LLM */ };
export const fixtureCodeMode: SessionFile = { /* execute_code tool */ };
```

### 9.3 Manual verification

- Create 30 test sessions with known patterns
- Run heuristic + manual label → target ≥ 70% agreement
- Run LLM fallback on disagreements → target ≥ 90% combined
- Run `kimiflare cost --week` with 50 sessions → target < 2s
- Compare local sum to Cloudflare 7-day window → target < 1% drift
- Verify opt-in: command fails gracefully when disabled

---

## 10. Implementation Phases

### Phase 1 — Heuristic + CLI + Opt-In (1 week)

**Files to create:**
- `src/cost-attribution/types.ts`
- `src/cost-attribution/heuristic.ts`
- `src/cost-attribution/report.ts`
- `src/cost-attribution/renderer.ts`
- `src/cost-attribution/git-diff.ts`

**Files to modify:**
- `src/usage-tracker.ts` — extend `SessionUsage` with category fields
- `src/cost-debug.ts` — extend `CostDebugEntry` with `signals` field
- `src/config.ts` — add `costAttribution?: boolean`
- `src/index.tsx` — add `cost` subcommand + opt-in check
- `src/storage-limits.ts` — add retention for category data (if needed)

**Deliverable:** `kimiflare cost --week` works with heuristic classification only. Opt-in gated. No LLM, no reconciliation.

### Phase 2 — LLM Fallback + Session Summaries (3–5 days)

**Files to create:**
- `src/cost-attribution/llm-classifier.ts`

**Files to modify:**
- `src/cost-attribution/heuristic.ts` — add confidence threshold hook
- `src/cost-attribution/index.ts` — orchestrate layer 1 → layer 2

**Deliverable:** Low-confidence sessions classified by LLM; one-line summaries generated; cache written to `usage.json`.

### Phase 3 — Cloudflare Reconciliation (3 days)

**Files to create:**
- `src/cost-attribution/reconcile.ts`

**Files to modify:**
- `src/cost-attribution/report.ts` — include reconciliation block
- `src/cost-attribution/renderer.ts` — render verification line

**Deliverable:** `kimiflare cost` shows ✓ / ✗ with drift % and hints.

### Phase 4 — Polish + v2 Hooks (ongoing)

- `--json` output
- Sparkline visualization
- Per-turn signal aggregation (proportional split)
- User tagging schema stub
- Monthly export for invoicing
- Anomaly highlights

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| 22 categories too many for heuristic accuracy | LLM fallback covers gaps; tune rules on test set |
| LLM classification cost too high | Only ~30% of sessions; cheapest model; cached forever |
| Users forget to opt in | Print hint on first `kimiflare cost` run: "Enable with KIMI_COST_ATTRIBUTION=1" |
| Cloudflare API rate limits | Reconciliation cached 1h; `--local-only` escape hatch |
| Session file I/O too slow | Lazy classification + cache; benchmark 50 sessions |
| Code Mode sessions misclassified | `execute_code` pattern detection in heuristic; LLM fallback default |
| "Fun but unimportant" — users ignore it | Top sessions block + week-over-week arrows + drift indicator |

---

## 12. Acceptance Criteria

- [ ] `kimiflare cost --week` runs in under 2 seconds on a 50-session dataset
- [ ] Heuristic classification agrees with manual labeling on ≥70% of a 30-session test set
- [ ] LLM fallback bumps combined accuracy to ≥90%
- [ ] Cloudflare reconciliation matches local sum within 1% on a clean 7-day window
- [ ] Total LLM cost of classifying 100 sessions is under $0.05
- [ ] All output renders cleanly in an 80-column terminal
- [ ] No new dependency on a hosted service beyond existing Workers AI / GraphQL endpoints
- [ ] `--json` flag produces valid structured output
- [ ] `--local-only` works offline
- [ ] Classification results cached; re-running `kimiflare cost` is instant
- [ ] Feature is opt-in; disabled by default; clear error message when invoked without enabling
- [ ] Per-turn signals collected in `cost-debug.jsonl` for future proportional split
