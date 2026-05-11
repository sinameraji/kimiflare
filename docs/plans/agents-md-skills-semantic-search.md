# Development Plan: AGENTS.md + Semantic Skill Search

**Branch:** `feat/agents-md-skills-semantic-search`  
**Date:** 2026-05-11  
**Author:** kimiflare  
**Status:** In Development  

---

## 1. Executive Summary

This plan adds first-class support for the industry-standard **AGENTS.md** format and **Agent Skills** (agentskills.io) to KimiFlare, replacing the current regex-only skill router with a **semantic embedding-based search** that ranks skill sections by relevance to the user's prompt.

**Key decisions:**
- Skills are **not** memories. Separate `skill_index` table in SQLite.
- Large skills are **not** split into multiple skills. They stay whole, but we embed and retrieve **sections** individually.
- Section loading is **fully deterministic** — no LLM agency required. We compute relevance, pack sections into the tier budget, and inject them directly.
- We support **both** KimiFlare native skills (`.kimiflare/skills/`) **and** industry-standard locations (`.agents/skills/`, `AGENTS.md`, `.github/skills/`).
- **This plan is fully independent of the memory feature flag.** Skills are a separate system. We can ship this without touching memory-by-default at all.

---

## 2. Research Findings

### 2.1 AGENTS.md Format

- **Location:** `AGENTS.md` at repository root
- **Format:** Plain markdown, no frontmatter required
- **Structure:** Sections by `##` headers (e.g., `## Setup commands`, `## Code style`, `## Testing instructions`)
- **Ecosystem:** Supported by Codex, Jules, Factory, Aider, Goose, OpenCode, Zed, Warp
- **Usage:** 60k+ open-source projects on GitHub

### 2.2 .agents/ Protocol (agentskills.io)

- **Location:** `.agents/` directory at repository root
- **Structure:**
  - `.agents/agents.md` — Agent manifest (name, description, model, instructions)
  - `.agents/skills/` — Individual skill files (markdown with frontmatter)
  - `.agents/agents/` — Sub-agent definitions
  - `.agents/tasks/` — Task templates
  - `.agents/memories/` — Agent memories
  - `.agents/mcp.json` — MCP server configuration
  - `.agents/models.json` — Model overrides
- **Skill format:** Markdown with YAML frontmatter (`name`, `description`, `match` glob patterns)
- **Ecosystem:** Standardized by Cloudflare, supported by multiple agents

### 2.3 Cloudflare AI Search Agent Primitive

- Cloudflare Workers AI provides embedding models and vector search
- The `ai-search` agent primitive uses semantic search for tool selection
- Relevant for our embedding strategy and ranking approach

---

## 3. Architecture & Data Model

### 3.1 Skill Discovery

```
Discovery order (first match wins):
1. .agents/skills/*.md          (industry standard)
2. AGENTS.md                    (industry standard, single file)
3. .github/skills/*.md          (GitHub-specific)
4. .kimiflare/skills/*.md       (KimiFlare native)

Deduplication is by skill name (from frontmatter or section heading), not by file path. If `.agents/skills/testing.md` and `.kimiflare/skills/testing.md` both define a skill named "testing", the `.agents/` version wins.
```

For `AGENTS.md`, each `##` section becomes a virtual skill with:
- `name`: Section heading (e.g., "Testing instructions")
- `description`: Auto-generated from the first sentence of the section body. If the first non-empty line is not a complete sentence (e.g., starts with a code block, list, or short fragment), fall back to the section heading itself.
- `content`: Full section body

### 3.2 SQLite Schema

```sql
-- Skills table (one row per skill file or AGENTS.md section)
CREATE TABLE skill_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,        -- SHA-256 of raw file bytes + parser_version
  parser_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL        -- unix timestamp (ms)
);

-- Skill sections (one row per ## section within a skill)
CREATE TABLE skill_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL,
  heading TEXT NOT NULL,
  body TEXT NOT NULL,
  embedding BLOB NOT NULL,           -- 768-dim float32 array
  FOREIGN KEY (skill_id) REFERENCES skill_index(id) ON DELETE CASCADE
);

-- Index for fast skill lookup
CREATE INDEX idx_skill_path ON skill_index(file_path);
```

**Notes:**
- `content_hash` covers the **full raw file content** (bytes) concatenated with a `parser_version` integer constant. When we fix a section-parser bug, bumping `parser_version` force-invalidates all cached sections without touching files.
- During indexing, we perform a deletion pass: drop `skill_index` rows whose `file_path` no longer exists on disk. `ON DELETE CASCADE` handles the sections.
- No `lineOffset` or `lineCount` fields — the algorithm never reads them. If future UX needs to show users where a section is in the file, that will be added as a schema migration in a follow-up.

### 3.3 Embedding Model

**Model:** `@cf/baai/bge-base-en-v1.5`  
**Dimensions:** 768  
**Format:** Float32 array serialized as BLOB  

**Rationale:** This is the same model used by the existing memory system. Reusing it gives us:
- Free reuse of the embedding client (`src/memory/embeddings.ts`)
- Free reuse of retry logic and error handling
- Free reuse of BLOB serialization/deserialization
- Consistent embedding semantics across memory and skills
- No additional model cold-start latency

The BLOB size is locked in once rows are populated (768 × 4 = 3,072 bytes per section), so this decision is binding.

### 3.4 Ranking: Pure Cosine Similarity (v1)

**v1 uses cosine similarity only.** No hybrid scoring, no FTS boost, no glob matching.

```typescript
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**Why pure cosine?**
- The hybrid formula `0.5 * cosine + 0.3 * fts + 0.2 * glob` had no empirical justification. The weights were guesses.
- `glob_score` only fires for KimiFlare native frontmatter (`match` patterns), which won't exist on AGENTS.md or most Agent Skills. It's dead weight for ~90% of rows.
- The three scores aren't on comparable scales (cosine is [0, 1], BM25 is unbounded, glob is binary). Adding them with fixed weights produces unnormalized nonsense.
- Cosine alone is interpretable, debuggable, and fast.

**If we need to add FTS later:** It will be a deterministic boost for exact-substring matches in the section body (not name/description/heading), normalized to [0, 1], and validated against a baseline. This is deferred to a separate plan (Milestone 3b).

---

## 4. Algorithm Design

### 4.1 Section Embedding Input

Before embedding a section, prepend the skill's name and description to provide context:

```typescript
const embeddingInput = `${skill.name}: ${skill.description}\n\n${section.heading}\n${section.body}`;
```

**Rationale:** Short sections (e.g., a 50-token "## Testing" section) have too little signal to rank well on their own. Prepending the skill context gives the embedding model the necessary context that this section is about this project's testing conventions. This is the same technique Cloudflare's Agent Memory uses (prepending generated queries to memory content before embedding). Same storage cost, much better recall.

### 4.2 Search Algorithm

```typescript
async function searchSections(
  query: string,
  topN: number,
  db: Database
): Promise<SectionResult[]> {
  const queryEmbedding = await embed(query); // 768-dim float32

  // Fetch all section embeddings. With realistic catalog sizes
  // (under a few hundred sections), a full table scan is negligible.
  const rows = db.prepare(`
    SELECT s.id, s.heading, s.body, s.embedding, i.name, i.description, i.file_path
    FROM skill_sections s
    JOIN skill_index i ON s.skill_id = i.id
  `).all();

  const scored = rows.map(row => ({
    ...row,
    similarity: cosineSimilarity(queryEmbedding, deserialize(row.embedding)),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN);
}
```

**No arbitrary limit.** We don't pass `LIMIT 20` or any magic number. With realistic skill catalogs (dozens of files, hundreds of sections), fetching all rows is negligible. If catalogs grow to thousands of sections, we can add a `WHERE` clause or vector index later.

**Performance regression threshold:** If any user's session start exceeds 500ms on skill loading, revisit this design.

### 4.3 Greedy Budget Packer with Similarity Floor

```typescript
const MIN_SIMILARITY = 0.3; // Empirical. May need calibration.

function packSections(
  sections: SectionResult[],
  budget: number,
): string {
  let packed = "";
  let used = 0;

  for (const section of sections) {
    if (section.similarity < MIN_SIMILARITY) break;

    const text = formatSection(section);
    const tokens = estimateTokens(text);

    if (used + tokens > budget) break;

    packed += text;
    used += tokens;
  }

  return packed;
}
```

**Key properties:**
- The router can output **zero skills** if no section meets the similarity floor.
- The floor prevents injecting irrelevant skills on queries that don't need them.
- `MIN_SIMILARITY = 0.3` is a starting point. It should be calibrated during Milestone 5 (Evaluation) and documented as empirical.

### 4.4 System Prompt Injection

```typescript
const skillContext = packSections(results, budget);

if (skillContext) {
  systemPrompt += `\n\n## Relevant Skills\n\n${skillContext}`;
}
```

---

## 5. Protocol Scope (v1)

**In scope for v1:**
- `.agents/skills/*.md` — Individual skill files with YAML frontmatter
- `AGENTS.md` — Single-file agent instructions (sections become virtual skills)
- `.github/skills/*.md` — GitHub-specific skill location
- `.kimiflare/skills/*.md` — KimiFlare native skills (backward compat)

**Explicitly out of scope for v1:**
- `.agents/agents.md` — Agent manifest (name, description, model, instructions)
- `.agents/agents/` — Sub-agent definitions
- `.agents/tasks/` — Task templates
- `.agents/memories/` — Agent memories
- `.agents/mcp.json` — MCP server configuration
- `.agents/models.json` — Model overrides

These are documented in Section 2.2 for completeness but will not be implemented in v1. This prevents scope creep.

---

## 6. Implementation Plan

### Milestone 0: Evaluation Protocol

**Goal:** Define how we will measure success before writing any router code.

**Deliverables:**
1. **Prompt corpus:** 50–100 real prompts from `cost-debug.jsonl` (or manually curated if insufficient). The larger corpus gives more statistical confidence when distinguishing semantic from regex performance. Cover:
   - Testing-related queries
   - Build/deployment queries
   - Code style queries
   - Architecture/decision queries
   - Generic queries that should match no skills
2. **Expected matches:** For each prompt, manually annotate the expected top-N skill matches (if any).
3. **Evaluation script:** A script that:
   - Runs the old regex router against the prompt corpus
   - Runs the new semantic router against the prompt corpus
   - Prints a diff of disagreements
   - For each disagreement, flags it for manual judgment
4. **Success criteria:**
   - Script runs deterministically
   - Disagreements are clearly labeled and reviewable
   - Baseline is captured before any Milestone 3 code is written

**Why this matters:** Without a baseline, we'll ship something that demos better but may not actually rank better than regex. The evaluation protocol is the evidence layer.

### Milestone 1: Skill Discovery + Parsing

**Goal:** Find skill files and parse them into structured sections.

**Deliverables:**
- `src/skills/discovery.ts` — Scan filesystem for skills in all supported locations
- `src/skills/parser.ts` — Parse markdown into sections:
  - For `.agents/skills/*.md`: Extract YAML frontmatter + `##` sections
  - For `AGENTS.md`: Treat each `##` as a virtual skill
  - For `.github/skills/*.md` and `.kimiflare/skills/*.md`: Same as `.agents/skills/`
- `src/skills/types.ts` — TypeScript types for `Skill`, `SkillSection`
- Tests for parser edge cases (no sections, nested headers, empty files)

**Success criteria:**
- Correctly parses all skill formats
- Handles missing/invalid frontmatter gracefully
- AGENTS.md sections have auto-generated descriptions

### Milestone 2: SQLite Indexing

**Goal:** Store skills and sections in SQLite with embeddings.

**Deliverables:**
- `src/skills/db.ts` — Database operations:
  - `initSkillsSchema(db)` — Create tables
  - `indexSkill(skill, db)` — Upsert skill + sections
  - `reindexIfChanged(skill, db)` — Skip if `content_hash` matches
  - `deleteOrphanedSkills(db)` — Remove skills whose files no longer exist
- `src/skills/embeddings.ts` — Section embedding (reuse memory system's `embed()`)
- `src/skills/indexer.ts` — Orchestrate discovery → parse → embed → store
- Tests for content hash invalidation, parser_version bumps, CASCADE deletion

**Success criteria:**
- Skills are indexed on startup (or on first use)
- Re-indexing is fast (skips unchanged files)
- Parser version bumps force re-indexing
- Orphaned rows are cleaned up

### Milestone 3a: Pure Cosine Router + Greedy Packer

**Goal:** Replace regex router with semantic search.

**Deliverables:**
- `src/skills/router.ts` — `selectSkills(prompt, tier, db)`:
  1. Embed the prompt
  2. Compute cosine similarity against all sections
  3. Sort by similarity descending
  4. Greedy pack with `MIN_SIMILARITY = 0.3` floor
  5. Return formatted skill context string
- `src/skills/format.ts` — Format sections for system prompt injection
- Integration into `src/agent/loop.ts` — Replace `selectSkills()` call
- Tests for budget packing, similarity floor, zero-skill queries

**Success criteria:**
- Router returns relevant skills for test prompts
- Budget is respected (no overflow)
- Similarity floor prevents irrelevant injection
- Zero skills returned when appropriate

### Milestone 3b: FTS Boost (Deferred)

**Goal:** Add exact-substring match boost if v1 proves insufficient.

**Status:** Not started. Requires:
- Evidence from Milestone 5 that pure cosine is insufficient
- A separate plan with normalized boost formula
- Validation against the Milestone 0 baseline

### Milestone 4: Multi-Location Support

**Goal:** Support all skill locations with priority order.

**Deliverables:**
- Update `discovery.ts` to scan all locations
- Priority: `.agents/skills/` > `AGENTS.md` > `.github/skills/` > `.kimiflare/skills/`
- Deduplication: Same skill name in multiple locations → first wins
- Tests for priority and deduplication

**Success criteria:**
- All locations are scanned
- Priority order is respected
- No duplicate skills injected

### Milestone 5: Testing & Validation

**Goal:** Validate the new system against the Milestone 0 baseline.

**Deliverables:**
1. Run the Milestone 0 evaluation script against both routers
2. For each disagreement, manually judge which is correct
3. Document results:
   - Overall accuracy vs. regex baseline
   - False positives (injected irrelevant skills)
   - False negatives (missed relevant skills)
   - Zero-skill accuracy (didn't inject when not needed)
4. If accuracy is not clearly better than regex, diagnose and iterate

**Success criteria:**
- Semantic router is measurably better than regex, or we know exactly why it isn't
- No regressions on prompts that regex handled well
- Documented calibration for `MIN_SIMILARITY` if adjusted

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Embedding model quality weak on code-heavy skill bodies | Medium | High | BGE-base is trained on general web text. Skill bodies often contain code, CLI commands, error strings — embeddings on these may be weaker. **Mitigation:** If Milestone 5 baseline shows poor ranking, the first thing to try is a code-aware embedding model (e.g., `nomic-embed-code` or similar on Workers AI) before tuning the score formula. |
| SQLite schema migrations | Low | Medium | Version the schema. On change, bump `parser_version` and re-index. |
| Performance with large skill catalogs | Low | Medium | Current design does full table scan. If catalogs grow to 1000+ sections, add vector index or approximate search. |
| Over-injection (too many skills) | Medium | Medium | Budget packer + similarity floor prevents this. Calibrate floor in Milestone 5. |
| Under-injection (missed relevant skills) | Medium | High | Prepending skill context to section embeddings improves recall. Evaluate in Milestone 5. |

---

## 8. Open Questions

1. **Should we cache query embeddings?** If the user sends multiple messages in the same context, the prompt embedding is recomputed each time. A simple LRU cache of the last N query embeddings could help. Low priority.
2. **Should skills be user-editable via TUI?** Currently skills are read-only reference material. Future: allow users to add/edit skills through the TUI and persist to `.agents/skills/`.
3. **Should we show the user which skills were loaded?** For transparency, the TUI could display "Loaded 3 skills: Testing, Deployment, Code Style". Low priority UX enhancement.
4. **lineOffset / lineCount for future UX:** If we want to show users exactly where in a skill file a section came from, we'll need to add `lineOffset` and `lineCount` to `skill_sections` in a future migration. Not needed for v1.

---

## 9. Appendix: Types

```typescript
interface Skill {
  name: string;
  description: string;
  filePath: string;
  contentHash: string;
  parserVersion: number;
  sections: SkillSection[];
}

interface SkillSection {
  heading: string;
  body: string;
}

interface SectionResult {
  id: number;
  heading: string;
  body: string;
  name: string;           // skill name
  description: string;    // skill description
  filePath: string;
  similarity: number;
}
```
