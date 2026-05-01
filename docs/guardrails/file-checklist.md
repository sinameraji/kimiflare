# Per-File Guardrail Checklist

> **Purpose:** Quick-reference checklist for reviewers. When a file is modified in a PR, check the corresponding items.
>
> **Usage:** Copy the relevant section into the PR description or review comment.

---

## `src/agent/loop.ts`

- [ ] Anti-loop guardrail still tracks signatures with `stableStringify()`
- [ ] `LOOP_WINDOW` (8) and `LOOP_THRESHOLD` (2) constants unchanged unless justified
- [ ] `maxToolIterations` (50) cap preserved
- [ ] Budget self-assessment messages injected every 3 tool calls
- [ ] Soft budget warning (5 calls) and hard budget warning (15 calls) present
- [ ] Graceful pause message injected before tool-limit throw
- [ ] New tool call sites include `recentToolCalls.push()` and window trimming
- [ ] Code Mode API cache uses `stableStringify(opts.tools)` as key
- [ ] `validateToolArguments()` handles empty/malformed JSON
- [ ] `stripHistoricalReasoning()` and `stripOldImages()` applied before API call
- [ ] AbortSignal propagated to `runKimi()`
- [ ] No new unbounded arrays or Maps in the loop

---

## `src/agent/client.ts`

- [ ] `validateModelId()` regex unchanged unless Cloudflare schema changes
- [ ] Retry logic only retries 5xx and code 3040
- [ ] `x-session-affinity` and `X-Session-ID` headers sent when `sessionId` provided
- [ ] Gateway headers only sent when `gateway.id` is set
- [ ] `sanitizeMessagesForApi()` sanitizes all string content
- [ ] SSE parser skips malformed chunks without crashing
- [ ] `sleep()` respects AbortSignal

---

## `src/agent/system-prompt.ts`

- [ ] `buildStaticPrefix()` contains no volatile data (no dates, no cwd, no random IDs)
- [ ] `buildSessionPrefix()` changes only when mode/tools/KIMI.md change
- [ ] `loadContextFile()` respects 20KB cap
- [ ] Tool list iteration is sorted/deterministic
- [ ] New system prompt instructions are terse (model has 262K context but every token counts)

---

## `src/agent/compaction.ts`

- [ ] `shouldCompact()` thresholds (80K tokens / 12 turns) unchanged unless measured
- [ ] `keepLastTurns` (4) preserved in working memory after compaction
- [ ] `extractArtifactsFromTurn()` handles all tool types safely
- [ ] `recallArtifacts()` caps recalled artifacts at 5
- [ ] Failure-keyword recall requires `meta.summary` match (not just any bash artifact)
- [ ] No new artifact types without corresponding `ArtifactType` union member

---

## `src/agent/compact.ts`

- [ ] `SUMMARY_SYSTEM` prompt unchanged unless explicitly redesigned
- [ ] `keepLastTurns` default (4) preserved
- [ ] Compaction runs on the main model (Kimi K2.6) — justified because synthesis quality matters
- [ ] AbortSignal passed through to `runKimi()`

---

## `src/agent/session-state.ts`

- [ ] `ArtifactStore` size caps preserved: 200 entries, 500K total chars
- [ ] `serializeArtifactStore()` truncates to 50KB per artifact
- [ ] `deserializeArtifactStore()` feeds back through `add()` to enforce caps
- [ ] `emptySessionState()` includes all required fields
- [ ] New `SessionState` fields have defaults in `emptySessionState()`

---

## `src/tools/executor.ts`

- [ ] `isDiffCommand()` whitelist matches exactly: `git show`, `git diff`, `git log -p`, `git format-patch`, `git stash show -p`
- [ ] Diff commands store artifact but return unreduced content
- [ ] Non-diff commands pass through `reduceToolOutput()`
- [ ] Permission check happens before tool execution
- [ ] `sessionAllowed` cleared on mode change to `plan`
- [ ] Unknown tool returns helpful error with valid tool list

---

## `src/tools/hand-off.ts`

- [ ] `hand_off` tool has `needsPermission: false`
- [ ] `target` parameter is required and validated
- [ ] Tool returns clear confirmation message with target and optional reason

---

## `src/agent/orchestrator.ts`

- [ ] `detectHandOff()` scans only the most recent assistant message with tool_calls
- [ ] Hand-off triggered only when target differs from current role
- [ ] `synthesizeHandoff()` preserves deliverables (Brief, Notes) rather than replacing them
- [ ] `maxTurnsPerAgent` (20) still triggers forced hand-off as fallback
- [ ] Per-agent turn counts reset on hand-off

---

## `src/tools/reducer.ts`

- [ ] `DEFAULT_REDUCER_CONFIG` defaults unchanged unless cost-justified:
  - `grep`: 50 lines, 3 matches/file, 200 chars/line, 3000 chars total
  - `read`: 60 outline, 200 slice, 30 preview, 4000 chars total
  - `bash`: 40 lines, 20 error lines, 20 trailing lines, 4000 chars, dedupe on
  - `webFetch`: 2000 chars, 500 heading chars
- [ ] New tool types added to `reduceToolOutput()` switch statement
- [ ] Artifact ID included in reduced output footer
- [ ] `wasReduced` flag accurate — don't claim reduction when nothing changed

---

## `src/tools/bash.ts`

- [ ] `DEFAULT_TIMEOUT` (120s) and `MAX_TIMEOUT` (600s) preserved
- [ ] `injectCoauthor()` only applies to commit-creating commands
- [ ] Co-author injection skipped for HEAD-moving commands (`checkout`, `reset`, `switch`, etc.)
- [ ] Command runs via `bash -lc` with explicit cwd
- [ ] Timeout enforced via `AbortController` + `spawn` kill
- [ ] Exit code non-zero returns error content, not crash

---

## `src/tools/read.ts`

- [ ] `MAX_BYTES` (2MB) preserved
- [ ] `offset` and `limit` validated (minimum 1)
- [ ] Full-file read without offset/limit returns outline, not full content
- [ ] Line numbers are 1-indexed

---

## `src/tools/write.ts`

- [ ] `needsPermission: true` preserved
- [ ] `render()` returns diff preview
- [ ] Parent directories created via `mkdir`
- [ ] No overwrite confirmation — permission modal is the gate

---

## `src/tools/edit.ts`

- [ ] `needsPermission: true` preserved
- [ ] `replace_all: false` requires exactly one match
- [ ] `replace_all: true` replaces all occurrences
- [ ] `render()` returns diff preview with before/after

---

## `src/memory/manager.ts`

- [ ] `plumbingModel` used for verification and hypothetical queries
- [ ] `deterministicTopicKey()` is pure function — no LLM call
- [ ] `memory_remember` pipeline: verify → topic key → hypotheticals → embed → store
- [ ] `synthesizeRecalled()` uses plumbing model, not main model
- [ ] `redactSecrets()` applied before storage
- [ ] Cleanup and backfill are non-blocking (fire-and-forget with `void`)

---

## `src/memory/db.ts`

- [ ] `initSchema()` creates all tables and indexes
- [ ] `migrateV1()` handles additive schema changes
- [ ] FTS5 triggers sync `memories_fts` with `memories`
- [ ] `searchMemoriesFts()` excludes tasks if `category != 'task'` filter is required
- [ ] `listMemoriesForVectorSearch()` excludes tasks
- [ ] All DB operations use parameterized queries (no SQL injection)

---

## `src/memory/retrieval.ts`

- [ ] RRF weights unchanged unless re-tuned: `topicKey:0.35, fts:0.20, vector:0.20, exact:0.15, rawMessage:0.10`
- [ ] `normalizeFtsRank()` clamps to 0–10 range
- [ ] `normalizeVectorScore()` clamps to 0.5–1.0 range
- [ ] `computeExactScore()` handles file path and keyword matches
- [ ] Results limited to requested `limit`

---

## `src/memory/embeddings.ts`

- [ ] `DEFAULT_MODEL` (`@cf/baai/bge-base-en-v1.5`) preserved
- [ ] `MAX_EMBED_CHARS` (2000) preserved
- [ ] `truncateForEmbedding()` truncates, doesn't error
- [ ] `fetchWithRetry()` retries 3 times with backoff
- [ ] Batch embedding requests when possible

---

## `src/memory/cleanup.ts`

- [ ] `findDuplicates()` threshold (0.95) preserved
- [ ] Cleanup interval (24h) respected via `shouldCleanup()`
- [ ] `maxAgeDays` and `maxEntries` passed through from config
- [ ] Superseded memories kept for audit (not deleted)

---

## `src/ui/chat.tsx`

- [ ] `ChatEvent` union includes all event kinds
- [ ] `Static` items have stable keys (`e.key`)
- [ ] Streaming assistant events not added to `Static`
- [ ] Separator shown between user and assistant/tool events
- [ ] `verbose` prop passed through to `ToolView`

---

## `src/ui/status.tsx`

- [ ] Cost display includes `$` prefix
- [ ] Token count includes cached vs uncached breakdown
- [ ] `/compact recommended` warning at 80% context
- [ ] Update nudge includes version numbers and install command
- [ ] Gateway cache status shown when available

---

## `src/ui/permission.tsx`

- [ ] Three options: Allow once, Allow session, Deny
- [ ] Diff preview shown for `write`/`edit`
- [ ] Tool name and args visible
- [ ] Escape key or selection resolves the promise

---

## `src/app.tsx`

- [ ] `CONTEXT_LIMIT` (262_000) preserved
- [ ] `AUTO_COMPACT_SUGGEST_PCT` (0.8) preserved
- [ ] `MAX_EVENTS` (500) preserved
- [ ] `capEvents()` enforces event cap
- [ ] `compactEventsVisual()` collapses old turns
- [ ] `makePrefixMessages()` respects `cacheStable` flag
- [ ] `findImagePaths()` caps at `MAX_IMAGES_PER_MESSAGE` (10)
- [ ] `BUILTIN_COMMAND_NAMES` updated if new slash command added
- [ ] Session save includes `artifactStore`
- [ ] Auto-compact fires after turn when thresholds met
- [ ] Memory recall after compaction uses `sessionState.task || cwd`
- [ ] Ctrl+C interrupts current operation without exiting
- [ ] Shift+Tab cycles modes

---

## `src/config.ts`

- [ ] `DEFAULT_MODEL` (`@cf/moonshotai/kimi-k2.6`) preserved
- [ ] `DEFAULT_REASONING_EFFORT` (`medium`) preserved
- [ ] New config fields have defaults in `loadConfig()`
- [ ] Config file chmod 600 on save
- [ ] Env var overrides documented

---

## `src/mode.ts`

- [ ] `MUTATING_TOOLS` set includes `write`, `edit`, `bash`
- [ ] `isBlockedInPlanMode()` blocks `mcp_*` tools
- [ ] `isReadOnlyBash()` validates each segment of pipes/`&&` chains
- [ ] Dangerous patterns (redirection, subshells, etc.) disqualify read-only status
- [ ] `systemPromptForMode()` returns mode-specific instructions

---

## `src/pricing.ts`

- [ ] `PRICE_IN_PER_M` (0.95) matches Cloudflare pricing
- [ ] `PRICE_IN_CACHED_PER_M` (0.16) matches Cloudflare pricing
- [ ] `PRICE_OUT_PER_M` (4.0) matches Cloudflare pricing
- [ ] `calculateCost()` handles all three token types

---

## `src/usage-tracker.ts`

- [ ] `LOG_VERSION` incremented on schema change
- [ ] Retention: 90 days daily, 30 days session, 200 session entries max
- [ ] `recordUsage()` updates both daily and session totals
- [ ] `getCostReport()` returns accurate USD amounts
- [ ] Gateway usage snapshot included when available

---

## `src/sessions.ts`

- [ ] `RETENTION.sessionMaxAgeDays` (30) and `sessionMaxCount` (100) preserved
- [ ] `saveSession()` writes atomically
- [ ] `loadSession()` parses JSON safely
- [ ] `pruneSessions()` removes old files, returns count

---

## `src/index.tsx`

- [ ] Print mode (`-p`) requires TTY check
- [ ] `--dangerously-allow-all` only works in print mode
- [ ] `--reasoning` only works in print mode
- [ ] Version from `getAppVersion()`
- [ ] If a `program.command(...)` subcommand is added, the root `program` retains an explicit `.action(() => {})` before `program.parse()` — otherwise commander auto-prints help and bare `kimiflare` never reaches `main()` (Guardrail 1.5 / CRIT-7; v0.20.0 regression)
- [ ] Smoke-tested: `node bin/kimiflare.mjs </dev/null` exits with "interactive mode requires a TTY", NOT the commander `Usage:` block

---

## `feedback-worker/src/index.ts`

- [ ] Rate limit: 5 requests per hour per IP
- [ ] Max file size: 10MB
- [ ] Allowed audio types whitelist enforced
- [ ] `DISCORD_WEBHOOK_URL` env var required
- [ ] No PII logged beyond session UUID and version

---

## `src/lsp/connection.ts`

- [ ] Spawn timeout enforced (default 30s)
- [ ] `kill()` cleans up child process and pending requests
- [ ] JSON-RPC buffer parsing handles split chunks
- [ ] AbortSignal propagated to pending requests
- [ ] No unbounded buffer growth (messages processed eagerly)

---

## `src/lsp/client.ts`

- [ ] `didOpen`/`didChange`/`didClose` document sync correct
- [ ] Diagnostics cached per URI, cleared on close
- [ ] All LSP requests pass AbortSignal through
- [ ] `getCapabilities()` returns server capabilities post-initialize

---

## `src/lsp/manager.ts`

- [ ] `startServer` stops existing server before restarting
- [ ] `stopAll` shuts down gracefully on app exit
- [ ] `resolveClientForPath` falls back to first running server
- [ ] `notifyChange` broadcasts to all running servers
- [ ] Restart attempts capped at `maxRestartAttempts`

---

## `src/lsp/adapter.ts`

- [ ] `formatDocumentSymbols` does not include bogus paths
- [ ] `formatLocation` uses `relative()` for readable paths
- [ ] Null/empty inputs return helpful fallback strings

---

## `src/tools/lsp.ts`

- [ ] All tools use `resolveLspPath` + `isPathOutside` guard
- [ ] `needsPermission: true` on mutating tools (`lsp_rename`, `lsp_codeAction`)
- [ ] Deterministic ordering preserved (`tools.sort()`)
- [ ] `makeLspTools` returns empty array when no servers active

---

## `package.json`

- [ ] `engines.node` >= 20 preserved
- [ ] `type: "module"` preserved
- [ ] `bin` points to `bin/kimiflare.mjs`
- [ ] `tsup` config externalizes runtime deps
- [ ] New dependencies justified (bundle size impact)

---

## `tsconfig.json`

- [ ] `strict: true` preserved
- [ ] `noUncheckedIndexedAccess: true` preserved
- [ ] `noImplicitOverride: true` preserved
- [ ] `isolatedModules: true` preserved
- [ ] `moduleResolution: "Bundler"` preserved

---

## `KIMI.md` / `KIMIFLARE.md`

- [ ] Build/test/run commands accurate
- [ ] Layout section reflects current directory structure
- [ ] Conventions section up to date
- [ ] Do/Don't section aligned with guardrails

---

*Add new files to this checklist as the project grows. Keep checkboxes concrete and verifiable.*
