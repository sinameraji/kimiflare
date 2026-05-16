# Competitor analysis: Claude Code

Companion to [`agent-loop.md`](./agent-loop.md) and
[`agent-loop-findings.md`](./agent-loop-findings.md). Frames KimiFlare's
agent-loop architecture against Anthropic's Claude Code — the most
directly comparable terminal coding agent — and identifies the features
worth borrowing.

This is not a feature checklist. The goal is to surface architectural
patterns that compound: things where Claude Code's design choices unlock
downstream capabilities KimiFlare currently can't reach without
significant rework.

> This document is written from the perspective of an analyst who has
> read both products' code (Claude Code from the outside as a daily
> driver; KimiFlare from the inside). Confidence varies — Claude Code
> internals are partly inferred from observable behavior and public
> docs.

## What Claude Code does that KimiFlare doesn't (in priority order)

### 1. Subagents with context isolation — **biggest single gap**

Claude Code's `Task` / `Agent` tool spawns specialized sub-agents
(`Explore` for read-only search, `Plan` for design, `general-purpose`
for multi-step research, plus user-defined ones). Each runs with:

- Its own tool allowlist (Explore is read-only by construction).
- Its own context window (parent doesn't see the sub-agent's tool
  output, only the final report).
- Optionally its own git worktree (`isolation: "worktree"`) — a
  temporary branch that auto-cleans if no changes are made.
- Parallel execution — multiple subagents in a single tool-call batch
  run concurrently.

**Why it matters.** For tasks like "explore this 4k-LOC file and report
back" the parent agent stays at a small context size while the
subagent burns through file reads. KimiFlare's single-loop architecture
forces all that exploration into the user-visible context, eating the
budget and slowing every subsequent turn.

**KimiFlare today:** strictly single-threaded loop, single context, no
delegation primitive.

**Build cost:** L. Requires context isolation in the loop, callback
marshalling between parent and child contexts, parallel orchestration
in the supervisor, and a worktree manager. Pairs naturally with the
`app.tsx` breakup (parent/child UI states).

**Counter-argument:** Code mode (`src/code-mode/`) is KimiFlare's stab
at a different solution to the same problem — batch many tool calls
into one model turn. Worth deciding whether subagents and code mode
coexist or one supersedes the other. My read: they solve different
problems. Code mode is for known-shape multi-tool sequences;
subagents are for open-ended delegated exploration.

### 2. Hooks — user-configured shell commands at lifecycle events

Claude Code reads `~/.claude/settings.json` (and project-local
overrides) for hook definitions: `PreToolUse`, `PostToolUse`, `Stop`,
`UserPromptSubmit`, `PreCompact`, etc. Each fires a shell command with
JSON context on stdin; the command can block the action or annotate
the result.

Real-world uses observed in the wild:

- Pre-commit linters as `PostToolUse` for `edit`.
- Secret scanners as `PreToolUse` for `write`.
- Slack/notification on `Stop`.
- Project-specific permission policies via `PreToolUse` shell scripts.

**KimiFlare today:** 22 internal callbacks in the loop, no user-
visible hook surface.

**Build cost:** M. The internal callback machinery already exists —
the work is in defining a stable JSON schema for hook context,
shelling out safely, and documenting the surface. Project-local
overrides need a discovery rule (probably `.kimiflare/settings.json`).

### 3. Pattern-based permissions

Claude Code permission entries are patterns, not booleans:
`"Bash(npm test:*)"`, `"Bash(git diff:*)"`, `"WebFetch(domain:github.com)"`,
`"Read(./src/**)"`. Allow / deny / ask tiers with deny winning over
allow.

**Why it matters.** Today KimiFlare users facing repeated permission
prompts have two choices: approve one-by-one (fatiguing) or switch to
`auto` mode (losing safety entirely). Pattern allowlists let power
users say "allow all bash git commands and npm scripts, ask for
everything else" in a config file once.

**KimiFlare today:** Permission gating in `executor.ts:125–139` is
keyed by tool name with a `bash:<first-token>` carve-out. No glob, no
config-file source.

**Build cost:** S–M. The permission key extractor in
`executor.ts:204–209` is the right hook point. Extend to read a
pattern list from settings; match argv against globs. Pair with
typed `askPermission` return (see OP-13).

### 4. Hierarchical context files

Claude Code reads `CLAUDE.md` from the working directory, walks up
to parent directories (monorepos), then `~/.claude/CLAUDE.md` for
user-global, then enterprise policy files. All concatenated into the
system prompt with provenance.

**KimiFlare today:** `KIMI.md` and `CLAUDE.md` per project, no
walking, no user-global tier.

**Build cost:** S. Pure pre-turn assembly logic. Pairs with the
existing `selectSkills()` path in `loop.ts:224–272`.

### 5. User-extensible slash commands

`.claude/commands/<name>.md` files become first-class slash commands.
Each file declares its allowed tools, optional model override, and
the prompt body with `$ARGUMENTS` interpolation. Users ship
`/review`, `/migrate`, `/security-check` without writing TypeScript.

**KimiFlare today:** Skills cover part of this, but conceptually
skills route into the prompt; commands route into the tool-execution
plan. Different primitive.

**Build cost:** M. The TUI's existing slash-command machinery (in
`app.tsx`) is the integration point. Need a command discovery pass,
arg parsing, and an execution shim.

### 6. Auto-compaction at context limit

When context approaches the model's hard limit, Claude Code summarizes
older turns into a compact narrative and continues seamlessly. The
user sees a transient "Compacting…" status. Compacted summaries
preserve recent tool results verbatim and lossy-summarize older ones.

**KimiFlare today:** `MAX_PROMPT_TOKENS = 240_000` at
`loop.ts:157` throws `BudgetExhaustedError` with exit code 42. Hard
wall, not a transition.

**Build cost:** M–L. Needs the summarizer prompt, a cache-friendly
insertion point (preserve everything before the "last cached point"
verbatim where possible), and rules for what survives verbatim. The
artifact store already separates raw from reduced — leverage that.

### 7. Enforced plan mode at the harness layer

In Claude Code, plan mode is enforced by the harness: every mutating
tool call errors at the boundary, regardless of what the model
attempts. The model can't write files; it's not a polite request.

**KimiFlare today:** Plan mode is enforced in `executor.ts`. Worth
auditing whether all paths respect it:

- MCP-injected tools (`mcp/manager.ts`) — do they go through the same
  gate?
- LSP rename — explicitly mentioned as blocked, verify.
- Code-mode sandbox — does it re-enter the executor for each internal
  call, so plan-mode gating still fires?
- Skill-provided tools — same question.

**Build cost:** S (audit) + S–M (any gaps found).

### 8. Structured `-p` output

Claude Code supports `--output-format json` and `--output-format
stream-json` for print mode. Output envelope includes `result`,
`usage`, `tool_calls`, `exit_code`, and per-event JSON for the stream
variant.

**KimiFlare today:** Print mode (`src/index.tsx`) emits human-
readable text only.

**Build cost:** S. A day of work. Critical for CI integrations,
scripting, and any product surface that wants to embed KimiFlare.

### 9. Background bash with monitoring

Claude Code's `Bash` tool accepts `run_in_background: true` and a
companion `Monitor` tool tails stdout from background processes. Long
deploys, long test runs, long builds don't block the agent loop.

**KimiFlare today:** Bash is synchronous, max 10-minute timeout
(`tools/bash.ts`). A failing 9-minute test run blocks the entire
loop until it dies.

**Build cost:** M. Needs a background-task table, stdout streaming
to the artifact store, and notification when a task completes
between turns. Naturally integrates with the existing artifact
system.

### 10. Status line, output styles, polish

Configurable status line (git branch, model, tokens remaining).
"Explanatory" output style for users who want verbose reasoning vs.
"concise" for power users. Theming.

**KimiFlare today:** Has theming. Status surface is implicit in the
TUI.

**Build cost:** S each. The kind of polish that signals seriousness.

## What KimiFlare does *better* than Claude Code

Worth protecting and amplifying — not just neutral parity points:

### Memory subsystem

`src/memory/` is substantively richer than Claude Code's memory
system. SQLite + WAL + FTS5 + BGE embeddings + 5-channel RRF recall
(topic 0.35 / FTS 0.20 / vector 0.20 / exact 0.15 / raw 0.10).
Deterministic extractors for `package_json`, `tsconfig`,
`entry_point`, plus an LLM-backed `edit_event` extractor.

**Implication:** Don't water this down. Lean in — a `/memory health`
command, recall-hit-rate telemetry, and a "memory inspector" TUI
would be differentiated features.

### Code mode

The `isolated-vm` TypeScript sandbox at `src/code-mode/` is a novel
direction. Claude Code doesn't have an analog. For multi-tool turns
where the sequence is known, executing one TypeScript program with
inline tool calls is materially faster than streaming each tool call
through the model.

**Implication:** Decide whether code mode and subagents (gap #1
above) coexist or compete. If they coexist, document when each is
preferred.

### Cost attribution

`src/cost-attribution/` classifies token spend per feature. Claude
Code users have to build this externally. KimiFlare users get
`/cost` and `history.jsonl` out of the box.

**Implication:** Surface it more aggressively in the TUI. A weekly
summary at session start. Multi-label classification (OP-25).

### Cloud mode

The Cloudflare Workers AI proxy with usage reporting
(`client.ts:165–182`) is a clean monetization path Claude Code
doesn't have a direct analog for.

**Implication:** Architectural leverage. Anything that can be
metered cleanly here is a future revenue lever.

### LSP integration as tools

`src/lsp/` exposes hover, definitions, references, rename, code
actions as agent tools. Claude Code reads files and greps; LSP gives
the agent semantic understanding for free. This is a real edge for
TypeScript / Rust / Go work.

**Implication:** Fix the auto-restart gap (RF-15) and the per-call
timeout gap (RF-16) so users actually keep LSP enabled. The
infrastructure is there; reliability is the missing piece.

## Architectural meta-observation

Claude Code's biggest advantage isn't any one feature. It's that the
harness-around-the-model is factored into composable pieces:

- Subagents (delegation primitive)
- Hooks (lifecycle extension)
- Slash commands (user-defined entry points)
- Skills (prompt-injection primitive)
- Permissions (security primitive)
- Plan mode (enforced gate)

Each piece can be extended by users or by the team independently. A
new feature usually slots in as a new file in `.claude/commands/` or
a new hook entry in `settings.json`, not a code change to the
harness.

KimiFlare has most of the same primitives, but they're more tightly
coupled inside `loop.ts` and `app.tsx`. Adding a hook surface today
means editing the loop. Adding subagents means editing the loop *and*
the TUI. Adding user commands means editing the TUI.

The `app.tsx` breakup (RF-14 / OP-19 in the findings doc) is the
upstream unblocker. Until it lands, every competitor-parity feature
becomes more expensive than it should be. This is why the development
roadmap puts that refactor on the critical path even though it's the
single largest item.

## Summary scoreboard

| Capability                       | Claude Code | KimiFlare today | Priority to close |
| -------------------------------- | :---------: | :-------------: | :---------------: |
| Subagents / delegation           |     ✅      |       ❌        |       **P0**      |
| Hooks (lifecycle)                |     ✅      |       ❌        |       **P0**      |
| Pattern-based permissions        |     ✅      |   partial       |       **P1**      |
| Hierarchical context files       |     ✅      |   partial       |       **P1**      |
| User slash commands              |     ✅      |   partial (skills) |  **P1**       |
| Auto-compaction                  |     ✅      |       ❌        |       **P1**      |
| Enforced plan mode (audit)       |     ✅      |   partial       |       **P2**      |
| Structured `-p` output           |     ✅      |       ❌        |       **P2**      |
| Background bash                  |     ✅      |       ❌        |       **P2**      |
| Status line / output styles      |     ✅      |   partial       |       **P3**      |
| **Memory (SQLite+RRF)**          |   partial   |       ✅        | *defend*          |
| **Code mode sandbox**            |     ❌      |       ✅        | *defend*          |
| **Cost attribution**             |     ❌      |       ✅        | *defend*          |
| **Cloud monetization path**      |     ❌      |       ✅        | *defend*          |
| **LSP as agent tools**           |     ❌      |       ✅        | *defend*          |

P0 = critical for closing the gap. P1 = high value, well-scoped.
P2 = important polish. P3 = nice-to-have.

See [`development-roadmap.md`](./development-roadmap.md) for how
these slot into milestone-scoped PRs.
