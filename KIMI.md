# kimiflare

**Project** — Terminal coding agent powered by Kimi-K2.6 on Cloudflare Workers AI. TypeScript / Node.js ≥20, React + Ink TUI. LSP integration for semantic code intelligence.

**Build / test / run**
- `npm run build` — bundle with tsup (`dist/` + `bin/kimiflare.mjs`)
- `npm run dev` — run via tsx (`tsx src/index.tsx`)
- `npm run typecheck` — `tsc --noEmit`
- `npm start` — run compiled bin
- `npm link` — symlink CLI for local development

**Layout**
- `src/index.tsx` — CLI entry (Commander args, print mode, TUI bootstrap)
- `src/app.tsx` — Ink TUI root (chat, status bar, permission modals, input)
- `src/agent/` — LLM client (`client.ts`), agent loop (`loop.ts`), system prompt builder, message compaction
- `src/tools/` — Tool specs & executors: `read`, `write`, `edit`, `bash`, `glob`, `grep`, `web_fetch`, `tasks`, `lsp_*`
- `src/lsp/` — Language Server Protocol integration: connection manager, client, protocol types, output formatters
- `src/ui/` — Ink components: chat, diff view, permission modal, task list, status bar, theme, text input
- `src/util/` — Helpers: SSE parser, paths, errors, update check
- `bin/` — Compiled CLI shim (`kimiflare.mjs`)
- `dist/` — tsup ESM output
- `docs/` — Documentation
- `src/cost-attribution/` — Cost attribution by task type (`kimiflare cost`)

**Conventions**
- ESM only (`"type": "module"`).
- Import paths **must** use `.js` extensions even for `.ts`/`.tsx` files (TypeScript `moduleResolution: Bundler`).
- Use `node:` prefix for all Node built-ins.
- TSX extension used throughout (even non-JSX files).
- Strict TS: `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`.
- React 19 + Ink 7 for terminal UI.
- tsup externalizes runtime deps (`ink`, `react`, `commander`, etc.); bundles source only.
- No test suite yet.
- Git branches: `feat/...`, `fix/...`, `chore/...`, `redesign/...`, `ui/...`. Releases managed by release-please; tags are `vX.Y.Z`.

**Cost Attribution (opt-in)**
- Enable with `costAttribution: true` in config or `KIMI_COST_ATTRIBUTION=1`.
- Run `kimiflare cost --week` to see spend by literal task type (e.g. `editing-source-code`, `running-tests`).
- Classification is lazy (runs on first `cost` invocation), deterministic heuristic with optional LLM fallback.
- Results cached in `usage.json`; no runtime cost when disabled.

**Do / Don't**
- Do keep agent responses terse; don't re-summarize tool output the user already sees inline.
- Do call `tasks_set` at the start of multi-step work and update it as steps complete; skip for trivial one-offs.
- Do read files and explore with `glob`/`grep` before editing; don't guess structure.
- Do state what you're about to do before any mutating tool call (`write`, `edit`, `bash`).
- Do stop when a task is finished; don't add closing summaries.
- Don't paste code in chat that could be applied via `edit` or `write`.
- Don't retry the same failed tool call blindly; read errors and adjust.
