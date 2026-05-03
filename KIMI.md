# kimiflare

**Project** — Terminal coding agent powered by Kimi-K2.6 on Cloudflare Workers AI. TypeScript / Node.js ≥20, React + Ink TUI. LSP, MCP, and persistent memory integration.

**Build / test / run**
- `npm run build` — bundle with tsup (`dist/` + `bin/kimiflare.mjs`)
- `npm run dev` — run via tsx (`tsx src/index.tsx`)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Node.js built-in test runner (`tsx --test src/**/*.test.ts*`)
- `npm start` — run compiled bin
- `npm link` — symlink CLI for local development

**Layout**
- `src/index.tsx` — CLI entry (Commander args, print mode, TUI bootstrap)
- `src/app.tsx` — Ink TUI root (chat, status bar, permission modals, input)
- `src/agent/` — LLM client, agent loop, system prompt builder, message compaction, session state
- `src/tools/` — Tool specs & executors: `read`, `write`, `edit`, `bash`, `glob`, `grep`, `web_fetch`, `tasks`, `lsp_*`, `memory`, `expand-artifact`
- `src/lsp/` — Language Server Protocol integration: connection manager, client, protocol types, output formatters
- `src/ui/` — Ink components: chat, diff view, permission modal, task list, status bar, theme, text input, pickers, wizards
- `src/util/` — Helpers: SSE parser, paths, errors, update check, fuzzy search, config
- `src/commands/` — Slash command loader, renderer, builtins, and custom command support
- `src/memory/` — Persistent cross-session memory: SQLite DB, embedding search, extraction, cleanup
- `src/mcp/` — Model Context Protocol server integration
- `src/code-mode/` — Sandboxed code execution mode
- `src/cost-attribution/` — Cost attribution by task type (`kimiflare cost`)
- `feedback-worker/` — Cloudflare Worker for feedback collection
- `bin/` — Compiled CLI shim (`kimiflare.mjs`)
- `dist/` — tsup ESM output
- `docs/` — Documentation, plans, guardrails, and learnings
- `scripts/` — Build and utility scripts

**Conventions**
- ESM only (`"type": "module"`).
- Import paths **must** use `.js` extensions even for `.ts`/`.tsx` files (TypeScript `moduleResolution: Bundler`).
- Use `node:` prefix for all Node built-ins.
- TSX extension used throughout (even non-JSX files).
- Strict TS: `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`.
- React 19 + Ink 7 for terminal UI.
- tsup externalizes runtime deps (`ink`, `react`, `commander`, etc.); bundles source only.
- Tests use Node.js built-in test runner (`node:test`).
- Git branches: `feat/...`, `fix/...`, `chore/...`, `redesign/...`, `ui/...`. Releases managed by release-please; tags are `vX.Y.Z`.

**Cost Attribution (opt-in)**
- Enable with `costAttribution: true` in config or `KIMI_COST_ATTRIBUTION=1`.
- Run `kimiflare cost --week` to see spend by literal task type (e.g. `editing-source-code`, `running-tests`).
- Classification is lazy (runs on first `cost` invocation), deterministic heuristic with optional LLM fallback.
- Results cached in `usage.json`; no runtime cost when disabled.

**@ File Mention Picker (opt-in)**
- Enable with `filePicker: true` in config or `KIMIFLARE_FILE_PICKER=1`.
- Type `@` in the chat input to open a file picker with inline filtering and keyboard navigation.
- Searches the current working directory, respecting `.gitignore` and common ignore patterns.

**/ Slash Command Picker**
- Type `/` at the start of the chat input to open a picker with all built-in and custom slash commands.
- Filters as you type (fuzzy match); arrow keys navigate, Enter inserts the command name (does not auto-submit), Esc cancels.

**Do / Don't**
- Do keep agent responses terse; don't re-summarize tool output the user already sees inline.
- Do call `tasks_set` at the start of multi-step work and update it as steps complete; skip for trivial one-offs.
- Do read files and explore with `glob`/`grep` before editing; don't guess structure.
- Do state what you're about to do before any mutating tool call (`write`, `edit`, `bash`).
- Do stop when a task is finished; don't add closing summaries.
- Don't paste code in chat that could be applied via `edit` or `write`.
- Don't retry the same failed tool call blindly; read errors and adjust.
