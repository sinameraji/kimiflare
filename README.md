<p align="center">
  <img src="assets/logo.svg" alt="kimiflare" width="320">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kimiflare"><img src="https://img.shields.io/npm/v/kimiflare?style=flat-square&color=cb3837" alt="npm version"></a>
  <a href="https://github.com/sinameraji/kimiflare/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sinameraji/kimiflare?style=flat-square&color=2ea44f" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/typescript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <a href="https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/"><img src="https://img.shields.io/badge/powered%20by-Kimi--K2.6-f59e0b?style=flat-square" alt="Powered by Kimi-K2.6"></a>
</p>

<p align="center">
  A terminal coding agent powered by <strong><a href="https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/">Kimi-K2.6</a></strong> on Cloudflare Workers AI. Moonshot's 1T-parameter open-source model runs directly on your Cloudflare account. You bring the token, your traffic goes straight to Cloudflare.
</p>

```
$ kimiflare
kimiflare · /help for commands · ctrl-c to exit

› what files are here?
  ✓ glob(*)
    /Users/you/proj/package.json
    /Users/you/proj/src/index.ts
    ...

› add a /health endpoint to server.ts
  ✓ read(src/server.ts)
  ◐ edit src/server.ts
    ─── permission requested ──────────────────
    @@ -42,6 +42,10 @@
       app.get('/', …)
    +  app.get('/health', (_, res) => res.json({ ok: true }))
    ─────────────────────────────────────────────
    [Allow once] [Allow for session] [Deny]
```

## Install

```sh
npm install -g kimiflare
```

Or run without installing:

```sh
npx kimiflare
```

Requires Node.js ≥ 20.

## Configure

Get credentials from Cloudflare:

1. https://dash.cloudflare.com → your account → copy **Account ID**.
2. https://dash.cloudflare.com/profile/api-tokens → **Create Token** → Custom token with **Account › Workers AI › Read** on your account → **Create** → copy.

Then either export them each shell:

```sh
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
```

or save them once (`chmod 600` automatically):

```sh
mkdir -p ~/.config/kimiflare
cat > ~/.config/kimiflare/config.json <<'EOF'
{
  "accountId": "YOUR_ACCOUNT_ID",
  "apiToken":  "YOUR_API_TOKEN",
  "model":     "@cf/moonshotai/kimi-k2.6"
}
EOF
chmod 600 ~/.config/kimiflare/config.json
```

## Usage

```sh
kimiflare                             # interactive TUI
kimiflare -p "summarize PLAN.md"      # one-shot, streams answer to stdout
kimiflare -p "..." --dangerously-allow-all   # auto-approve mutating tools (for scripts)
kimiflare --model @cf/moonshotai/kimi-k2.6   # override model
kimiflare --reasoning                 # (print mode) stream chain-of-thought to stderr
```

Interactive slash commands:

| Command                     | Effect                                                                          |
|-----------------------------|---------------------------------------------------------------------------------|
| `/mode edit\|plan\|auto`     | Switch mode. `edit` prompts for permission (default), `plan` is read-only research, `auto` auto-approves every tool call. |
| `/plan` `/auto` `/edit`     | Shortcuts for the three modes.                                                  |
| `/thinking low\|medium\|high` | Reasoning effort. `low` = fastest, shallow; `medium` = balanced (default); `high` = deepest, slowest. Saved to config. |
| `/theme NAME`               | Switch color scheme: `dark` (default), `light` (bright terminals), `high-contrast`. Saved to config. |
| `/resume`                   | Pick a past conversation to restore.                                            |
| `/compact`                  | Summarize older turns to free context. Suggested automatically at ~80% full.    |
| `/init`                     | Scan the repo and write a `KIMI.md` so future agents have project context.      |
| `/reasoning`                | Toggle chain-of-thought display.                                                |
| `/clear`                    | Reset the current conversation.                                                 |
| `/cost` `/model` `/update`  | Info commands.                                                                  |
| `/logout`                   | Clear saved credentials.                                                        |
| `/help` `/exit`             | List commands / quit.                                                           |

Keys: `Shift+Tab` cycles mode · `Ctrl-R` toggles reasoning · `Ctrl-O` toggles verbose tool output · `Ctrl-C` interrupts an in-flight turn (press again to exit) · `↑`/`↓` walks prompt history.

Editing keys (macOS):

- `⌥←` / `⌥→` — jump word left/right (also works with `Esc b` / `Esc f`)
- `⌘←` / `⌘→` — jump to start / end of line (in iTerm2's default profile; in Terminal.app you may need to map these to send `Ctrl-A` / `Ctrl-E`)
- `⌥⌫` — delete word backward
- `⌘⌫` — delete to start of line (iTerm2 sends this as `Ctrl-U`; map in Terminal.app if needed)
- `⌥⌦` — delete word forward
- `Ctrl-A` / `Ctrl-E` — start / end of line (always works)
- `Ctrl-W` / `Ctrl-U` / `Ctrl-K` — delete word backward / to start of line / to end of line

### Modes

- **edit** — default. The agent calls tools freely for read-only work; mutating tools (`write`, `edit`, `bash`) pause for your approval.
- **plan** — read-only. Mutating tools are hard-blocked. Ask "plan a refactor" and the agent will investigate and produce a plan without touching the filesystem. Exit plan mode to execute.
- **auto** — autonomous. Every tool call is auto-approved. Use for trusted, well-scoped tasks.

### Thinking level (quality vs speed)

Kimi-K2.6 always reasons, but you can cap the effort:

- **low** — fastest. Best for chat, small edits, running commands.
- **medium** — balanced (default). Solid reasoning on real edits without the latency of deep thinking on trivial prompts.
- **high** — deepest. Best for multi-file refactors, subtle bugs, architectural decisions.

Set with `/thinking medium` (persists), or per-launch via `KIMI_REASONING_EFFORT=high`.

### Type-ahead queue

You can type the next prompt while the model is still executing. Submitted prompts show up as `⏳ …` and fire in order as each turn completes. `Ctrl-C` aborts the current turn and clears the queue.

### Session persistence

Sessions are saved to `~/.local/share/kimiflare/sessions/` after each turn. `/resume` lists the most recent (with first prompt + message count) so you can pick one up later.

### Task panel

For multi-step requests, the agent can publish a live task list via the `tasks_set` tool. The panel shows progress inline with status icons (`■` active, `☐` pending, `✓` done), elapsed time, and tokens consumed for the current task batch. Press `Ctrl-O` while a turn is running to switch tool output between compact (first line) and verbose (full output) modes.

### Paste collapse

Paste a large block (≥ 200 chars or ≥ 3 newlines in one paste) into the prompt and the input collapses it to `[pasted N lines #id]`. The full content still goes to the model on submit — only the on-screen display and chat history are collapsed, so scrollback doesn't get buried by a wall of code.

### Project context (KIMI.md)

Run `/init` inside a repo and kimiflare scans the project (reads `package.json`, `README`, source layout, etc.) and writes a concise `KIMI.md` at the repo root — project overview, build/test commands, conventions, quirks. On every subsequent launch in that directory, `KIMI.md` (or `KIMIFLARE.md` or `AGENT.md`, whichever exists) is auto-loaded into the system prompt so the agent already "knows" the project. If the file already exists, `/init` refuses so you don't overwrite hand-edited context.

## Why

- **262k context.** Read entire modules without pagination.
- **Native tool use.** File I/O, shell, globs, grep, web fetch — all wired up, with per-call approval for anything mutating.
- **Streaming reasoning + content.** The model's chain-of-thought streams separately; toggle with `/reasoning` or `Ctrl-R`.
- **Pay your own way.** Your Cloudflare account, your credits, your rate limits. `$0.95 / M input`, `$0.16 / M cached input`, `$4.00 / M output`. The bottom status line shows live cost.

## Tools

All tool calls show inline; mutating ones require per-call approval the first time, with an option to allow for the rest of the session.

| Tool        | Permission | What it does |
|-------------|------------|--------------|
| `read`      | auto       | Read a text file (≤ 2MB) with optional line range. |
| `write`     | prompt     | Create or overwrite a file. Shows a unified diff before you approve. |
| `edit`      | prompt     | Replace an exact substring. Fails unless `old_string` is unique (or `replace_all=true`). |
| `bash`      | prompt     | Run a shell command via `bash -lc`. Session-allow is keyed by the first token of the command. |
| `glob`      | auto       | Match files by pattern (`**/*.ts`), sorted by mtime. |
| `grep`      | auto       | Regex search. Uses `rg` if installed; falls back to a JS walk. |
| `web_fetch` | auto       | Fetch a URL, convert HTML → markdown (≤ 100KB). |

## How it works

```
           ┌───────────────────────────────────────────────────────────┐
           │ kimiflare (Node + Ink TUI)                                │
 user ─▶   │                                                           │
           │   user msg ─▶ agent loop ─▶ runKimi() ──[POST SSE]──▶     │
           │                       ▲                                   │
           │                       │                                   │
           │      tool result ◀──tool executor──◀ tool_calls           │
           │           (permission modal for write / edit / bash)      │
           └───────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
                                       api.cloudflare.com/client/v4
                                       /accounts/{ID}/ai/run/
                                       @cf/moonshotai/kimi-k2.6
```

Direct `fetch` to Workers AI, OpenAI-compatible `messages` + `tools` payload, SSE stream with reasoning + content + tool-call deltas accumulated by index.

## Development

```sh
git clone https://github.com/sinameraji/kimiflare
cd kimiflare
npm install
npm run build
npm link          # or: ln -s "$PWD/bin/kimiflare.mjs" ~/.local/bin/kimiflare
```

## Status

Early but functional. Transport + tools + agent loop + print mode are verified end-to-end. Interactive TUI ships modes, themes, thinking levels, session resume, compaction, and type-ahead queue.

## License

[MIT](LICENSE) © Sina Meraji
