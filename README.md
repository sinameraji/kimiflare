<p align="center">
  <img src="docs/logo.png" alt="kimiflare" width="180">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kimiflare"><img src="https://img.shields.io/npm/v/kimiflare?style=flat-square&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/kimiflare"><img src="https://img.shields.io/npm/dm/kimiflare?style=flat-square&color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/sinameraji/kimiflare/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sinameraji/kimiflare?style=flat-square&color=2ea44f" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/typescript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <a href="https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/"><img src="https://img.shields.io/badge/powered%20by-Kimi--K2.6-f59e0b?style=flat-square" alt="Powered by Kimi-K2.6"></a>
</p>

<p align="center">
  <strong>A terminal coding agent powered by <a href="https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/">Kimi-K2.6</a> on Cloudflare Workers AI.</strong><br>
  Moonshot's 1T-parameter open-source model, running directly on your Cloudflare account.
</p>

> 💸 **Heads up — this runs on your Cloudflare account.**
> We recommend setting a [budget cap](https://developers.cloudflare.com/workers-ai/platform/pricing/) on Workers AI and checking your [Cloudflare billing](https://dash.cloudflare.com/) regularly while using KimiFlare.
>
> 🚀 **Stay up to date.** Newer versions are significantly more token-efficient and cheaper to run. Run `/update` inside KimiFlare or `npm update -g kimiflare` to get the latest release.

<p align="center">
  <img src="docs/screenshot.png" alt="kimiflare TUI" width="900">
</p>

## Stay in the loop

Kimiflare is shipping quickly.

Get:
- release notes,
- technical write-ups,
- early experimental features,
- architecture notes on building coding agents on Cloudflare.

→ Get updates: https://kimiflare.com

## Shipping fast

Recently shipped:
- Cloudflare Code Mode support
- Local agent memory
- Major token cost reductions (70–90% lower)
- Better session compaction

Coming next:
- OpenCode parity improvements
- Cost attribution dashboard
- Cloudflare Artifacts experiments

Full changelog and notes at https://kimiflare.com

## Why kimiflare

- **262k context window** — Read entire modules, large configs, and full stack traces without the model losing track.
- **Image understanding** — Drop image paths into your prompt (PNG, JPG, WebP, GIF, BMP). The model sees them inline — great for UI reviews, diagrams, screenshots, and mockups.
- **Direct by default** — No proxy, no OpenAI SDK. Your traffic goes straight to Workers AI from your account, with optional AI Gateway routing for user-owned logging, caching, and analytics.
- **Plan mode** — Ask the agent to research and produce a plan without touching your filesystem. Review it, then exit plan mode to execute.

## Quick start

```sh
npm install -g kimiflare
kimiflare
```

On first run, an interactive onboarding wizard asks for your Cloudflare Account ID and API Token. That's it — you're ready.

Or run without installing:

```sh
npx kimiflare
```

Requires Node.js ≥ 20.

> For release notes and rapid feature drops: https://kimiflare.com

## Features

| Feature | What it does |
|---------|-------------|
| **Plan / Edit / Auto modes** | `plan` blocks all mutating tools for safe research. `edit` (default) prompts per mutating call. `auto` approves everything for trusted tasks. |
| **Live task panel** | For multi-step work, the agent publishes a task list with progress icons (■ active, ☐ pending, ✓ done), elapsed time, and token deltas. |
| **14 terminal themes** | dark, light, high-contrast, dracula, nord, one-dark, monokai, solarized-dark/light, tokyo-night, gruvbox-dark/light, catppuccin-mocha, rose-pine. Interactive picker with live preview (`Ctrl+T`). |
| **Paste collapse** | Large pastes (≥200 chars or ≥2 newlines) collapse to `[pasted N lines #id]`. Full content still goes to the model — scrollback stays clean. |
| **Type-ahead queue** | Type your next prompt while the model is still working. Queued prompts show as `⏳ …` and fire in order. `Ctrl-C` aborts current + clears queue. |
| **Auto-compaction** | At ~80% context usage, kimiflare nudges you to run `/compact`. It summarizes older turns into a dense summary, keeping the last 4 turns intact. |
| **Streaming reasoning** | Toggle the model's chain-of-thought with `/reasoning` or `Ctrl-R`. See how it thinks in real time. |
| **Image understanding** | Drop image paths (PNG, JPG, WebP, GIF, BMP up to 5 MB) into any prompt. The model sees them inline — perfect for UI reviews, diagrams, and screenshots. |
| **Live cost tracking** | Status bar shows real-time cost based on Cloudflare pricing: `$0.95/M input`, `$0.16/M cached`, `$4.00/M output`. |
| **Optional AI Gateway** | Route Workers AI traffic through your own Cloudflare AI Gateway for request logs, cache status, and analytics while keeping your API token local. |
| **Session persistence** | Every turn is auto-saved. `/resume` lists past sessions (with message counts) in a paginated picker. |
| **Smart permissions** | Bash session-allow is keyed by the first token (e.g., allow all `git` commands). Write/edit show a unified diff before you approve. |
| **Project context (`/init`)** | Scans your repo and writes a concise `KIMI.md` — build commands, layout, conventions. Auto-loaded on every launch. |
| **MCP server integration** | Plug in external tools via the Model Context Protocol — local stdio servers or remote SSE endpoints. GitHub, Sentry, docs search, databases, etc. |
| **Co-author auto-append** | Detects `git commit` commands and auto-injects `Co-authored-by: kimiflare <kimiflare@proton.me>`. |
| **Local structured memory** | SQLite + embeddings cross-session memory. Extracts facts, instructions, and preferences at compaction time; recalls them via hybrid search (FTS5 + vector + exact) in future sessions. Team-shareable via `.kimiflare/memory.db`. |
| **Resilient transport** | Retries Cloudflare capacity errors (code 3040) and 5xx with exponential backoff up to 5 attempts. |

## Configure

Get credentials from Cloudflare:

1. https://dash.cloudflare.com → your account → copy **Account ID**.
2. https://dash.cloudflare.com/profile/api-tokens → **Create Token** → Custom token with **Account › Workers AI › Read** on your account → **Create** → copy.

Then either export them each shell:

```sh
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
# Optional: route through a Cloudflare AI Gateway you own
export KIMIFLARE_AI_GATEWAY_ID=...
# Optional: enable local structured memory
export KIMIFLARE_MEMORY_ENABLED=1
export KIMIFLARE_MEMORY_DB_PATH=.kimiflare/memory.db
export KIMIFLARE_MEMORY_MAX_AGE_DAYS=90
export KIMIFLARE_MEMORY_MAX_ENTRIES=1000
```

or save them once (`chmod 600` automatically):

```sh
mkdir -p ~/.config/kimiflare
cat > ~/.config/kimiflare/config.json <<'EOF'
{
  "accountId": "YOUR_ACCOUNT_ID",
  "apiToken":  "YOUR_API_TOKEN",
  "model":     "@cf/moonshotai/kimi-k2.6",
  "aiGatewayId": "YOUR_GATEWAY_NAME"
}
EOF
chmod 600 ~/.config/kimiflare/config.json
```

### Optional AI Gateway

kimiflare talks directly to Workers AI unless `aiGatewayId` is configured. When set, chat completions are sent to Cloudflare's native Workers AI Gateway endpoint:

```text
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/workers-ai/{model_id}
```

Create a gateway in the Cloudflare dashboard under **AI > AI Gateway**, then set `aiGatewayId` in `~/.config/kimiflare/config.json` or export `KIMIFLARE_AI_GATEWAY_ID`. The same Workers AI API token stays on your machine and is sent to Cloudflare.

Optional per-request controls:

```json
{
  "aiGatewayCacheTtl": 3600,
  "aiGatewaySkipCache": false,
  "aiGatewayCollectLogPayload": false,
  "aiGatewayMetadata": { "tool": "kimiflare" }
}
```

`cf-aig-cache-status` from AI Gateway is shown separately from Workers AI prompt-token caching (`cached_tokens`). If you enable gateway logs, kimiflare records metadata such as log id, cache hit/miss, tokens, duration, and status when Cloudflare returns it; prompt and response bodies are not stored by kimiflare.

## MCP servers (Model Context Protocol)

kimiflare supports external tools via MCP. Add servers to your `~/.config/kimiflare/config.json`:

```json
{
  "accountId": "YOUR_ACCOUNT_ID",
  "apiToken": "YOUR_API_TOKEN",
  "mcpServers": {
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" }
    },
    "fetch": {
      "type": "local",
      "command": ["uvx", "mcp-server-fetch"]
    },
    "my-remote": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer token123" }
    }
  }
}
```

- `type`: `"local"` (stdio subprocess) or `"remote"` (SSE/HTTP endpoint)
- `command`: array with executable and args (local only)
- `url`: endpoint URL (remote only)
- `env`: environment variables for local servers
- `headers`: HTTP headers for remote servers
- `enabled`: set to `false` to skip a server

MCP tools appear prefixed as `mcp_<server>_<tool>` alongside built-in tools.

**Commands:**
- `/mcp list` — show connected servers and tool counts
- `/mcp reload` — disconnect and reconnect all configured servers

## Local structured memory

kimiflare can remember facts, instructions, and preferences across sessions using a local SQLite database with vector search.

**How it works:**
- At compaction time, the agent extracts structured memories from the conversation
- Memories are stored with embeddings (`@cf/baai/bge-base-en-v1.5`) in a local SQLite database
- On future sessions, relevant memories are recalled via hybrid search (FTS5 full-text + vector similarity + exact file-path matching)
- Supports team-shared memory: `.kimiflare/memory.db` in your repo root (add to `.gitignore`)

**Enable:**
```sh
export KIMIFLARE_MEMORY_ENABLED=1
```

Or in `~/.config/kimiflare/config.json`:
```json
{
  "memoryEnabled": true,
  "memoryDbPath": ".kimiflare/memory.db",
  "memoryMaxAgeDays": 90,
  "memoryMaxEntries": 1000,
  "memoryEmbeddingModel": "@cf/baai/bge-base-en-v1.5"
}
```

**Commands:**
- `/memory` — show memory stats (total count, DB size, by category)
- `/memory search <query>` — manual hybrid search over stored memories
- `/memory clear` — wipe all memories for the current repo

**Storage & cleanup:**
- Default retention: 90 days, 1000 memories per repo
- Automatic deduplication of near-identical memories
- Cleanup runs on startup and after every compaction
- Typical size: ~4–5 KB per memory; ~15 MB/month under heavy use

## Usage

### Interactive TUI

```sh
kimiflare                             # launch TUI
kimiflare --model @cf/moonshotai/kimi-k2.6   # override model
```

### Print mode (one-shot, non-interactive)

```sh
kimiflare -p "summarize PLAN.md"                    # stream answer to stdout
kimiflare -p "..." --dangerously-allow-all          # auto-approve mutating tools (for scripts)
kimiflare -p "..." --reasoning                      # include chain-of-thought in stderr
```

### Image understanding

Reference image files directly in your prompt — the model sees them inline:

```sh
kimiflare
› fix the layout bug in this screenshot docs/bug.png
› convert this mockup design.png to Tailwind HTML
› explain this architecture diagram.png
```

Supported formats: PNG, JPG, JPEG, WebP, GIF, BMP (up to 5 MB each, 10 per message).

### CLI flags

| Flag | Short | Description |
|------|-------|-------------|
| `--print <prompt>` | `-p` | One-shot mode: send prompt, stream reply, exit |
| `--model <id>` | `-m` | Model ID (default: `@cf/moonshotai/kimi-k2.6`) |
| `--dangerously-allow-all` | — | Auto-approve every permission prompt (print mode only) |
| `--reasoning` | — | Stream chain-of-thought to stderr (print mode only) |
| `--version` | `-V` | Show version |
| `--help` | `-h` | Show help |

## Slash commands

| Command | Effect |
|---------|--------|
| `/mode edit\|plan\|auto` | Switch mode. `edit` prompts for permission (default), `plan` is read-only research, `auto` auto-approves every tool call. |
| `/plan` `/auto` `/edit` | Shortcuts for the three modes. |
| `/thinking low\|medium\|high` | Reasoning effort. `low` = fastest, shallow; `medium` = balanced (default); `high` = deepest, slowest. Saved to config. |
| `/theme` | Interactive theme picker with live preview (`Ctrl+T`). Saved to config. |
| `/theme NAME` | Set theme by name directly. |
| `/resume` | Pick a past conversation to restore. |
| `/compact` | Summarize older turns to free context. Suggested automatically at ~80% full. Extracts memories if memory is enabled. |
| `/init` | Scan the repo and write a `KIMI.md` so future agents have project context. |
| `/memory` | Show memory stats (total count, DB size, by category). |
| `/memory search <query>` | Search stored memories manually. |
| `/memory clear` | Wipe all memories for the current repo. |
| `/mcp list` | List connected MCP servers and their tools. |
| `/mcp reload` | Disconnect and reconnect all configured MCP servers. |
| `/reasoning` | Toggle chain-of-thought display. |
| `/clear` | Reset the current conversation. |
| `/cost` | Show token usage for the current turn. |
| `/model` | Show current model. |
| `/update` | Check for updates manually. |
| `/logout` | Clear saved credentials. |
| `/help` | List all commands. |
| `/exit` | Quit. |

## Keyboard shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` / `Esc` | Interrupt current turn when busy; exit when idle |
| `Ctrl+R` | Toggle reasoning display |
| `Ctrl+O` | Toggle verbose tool output |
| `Ctrl+T` | Open theme picker |
| `Shift+Tab` | Cycle mode (edit → plan → auto) |
| `↑` / `↓` | Walk prompt history |

### Editing (macOS / Linux)

| Shortcut | Action |
|----------|--------|
| `⌥←` / `⌥→` | Jump word left/right |
| `⌘←` / `⌘→` | Jump to start / end of line |
| `⌥⌫` | Delete word backward |
| `⌘⌫` | Delete to start of line |
| `⌥⌦` | Delete word forward |
| `Ctrl+A` / `Ctrl+E` | Start / end of line |
| `Ctrl+W` / `Ctrl+U` / `Ctrl+K` | Delete word backward / to start / to end of line |

## Modes

- **edit** — default. The agent calls tools freely for read-only work; mutating tools (`write`, `edit`, `bash`) pause for your approval.
- **plan** — read-only. Mutating tools are hard-blocked. Ask "plan a refactor" and the agent will investigate and produce a plan without touching the filesystem. Exit plan mode to execute.
- **auto** — autonomous. Every tool call is auto-approved. Use for trusted, well-scoped tasks.

## Thinking level (quality vs speed)

Kimi-K2.6 always reasons, but you can cap the effort:

- **low** — fastest. Best for chat, small edits, running commands.
- **medium** — balanced (default). Solid reasoning on real edits without the latency of deep thinking on trivial prompts.
- **high** — deepest. Best for multi-file refactors, subtle bugs, architectural decisions.

Set with `/thinking medium` (persists), or per-launch via `KIMI_REASONING_EFFORT=high`.

## Tools

All tool calls show inline; mutating ones require per-call approval the first time, with an option to allow for the rest of the session.

| Tool | Permission | What it does |
|------|------------|--------------|
| `read` | auto | Read a text file (≤ 2MB) with optional line range. |
| `write` | prompt | Create or overwrite a file. Shows a unified diff before you approve. |
| `edit` | prompt | Replace an exact substring. Fails unless `old_string` is unique (or `replace_all=true`). |
| `bash` | prompt | Run a shell command via `bash -lc`. Session-allow is keyed by the first token of the command. |
| `glob` | auto | Match files by pattern (`**/*.ts`), sorted by mtime. |
| `grep` | auto | Regex search. Uses `rg` if installed; falls back to a JS walk. |
| `web_fetch` | auto | Fetch a URL, convert HTML → markdown (≤ 100KB). |
| `tasks_set` | auto | Publish a live task list for multi-step work. |

## How it works

```
           ┌───────────────────────────────────────────────────────────┐
           │ kimiflare (Node.js TUI)                                   │
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

Direct `fetch` to Workers AI by default, or the native Workers AI AI Gateway endpoint when `aiGatewayId` is configured. The payload remains OpenAI-compatible `messages` + `tools`, with an SSE stream containing reasoning + content + tool-call deltas accumulated by index.

## Development

```sh
git clone https://github.com/sinameraji/kimiflare
cd kimiflare
npm install
npm run build
npm link          # or: ln -s "$PWD/bin/kimiflare.mjs" ~/.local/bin/kimiflare
```

Scripts:
- `npm run build` — bundle with tsup (`dist/` + `bin/kimiflare.mjs`)
- `npm run dev` — run via tsx (`tsx src/index.tsx`)
- `npm run typecheck` — `tsc --noEmit`
- `npm start` — run compiled bin

## Contributing

Contributions are welcome!

1. Fork the repository
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run `npm run typecheck` and `npm run build`
5. Commit: `git commit -m "feat: description"`
6. Push: `git push origin feat/your-feature`
7. Open a Pull Request

## Testing MCP locally

You don't need a real MCP server to test the integration. Here's a minimal test server you can save as `test-mcp-server.js`:

```js
// test-mcp-server.js — a minimal MCP server for testing
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "greet",
      description: "Greet someone by name",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    {
      name: "add",
      description: "Add two numbers",
      inputSchema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
    },
  ],
}));

server.setRequestHandler("tools/call", async (req) => {
  if (req.params.name === "greet") {
    return { content: [{ type: "text", text: `Hello, ${req.params.arguments.name}!` }] };
  }
  if (req.params.name === "add") {
    const sum = req.params.arguments.a + req.params.arguments.b;
    return { content: [{ type: "text", text: String(sum) }] };
  }
  throw new Error("Unknown tool");
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

Then add it to your config:

```json
{
  "mcpServers": {
    "test": {
      "type": "local",
      "command": ["node", "/path/to/test-mcp-server.js"]
    }
  }
}
```

Launch kimiflare and try:
- `/mcp list` — should show `test (local) — 2 tools`
- `use mcp_test_greet with name "kimiflare"` — should return `Hello, kimiflare!`
- `use mcp_test_add with a 3 and b 5` — should return `8`

For a real-world test, try the [official GitHub MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/github):

```json
{
  "mcpServers": {
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" }
    }
  }
}
```

Then ask: `search for issues labeled bug in sinameraji/kimiflare`

## Credits

- **Cloudflare Agent Memory** — This feature was inspired by [Cloudflare's Agent Memory](https://blog.cloudflare.com/introducing-agent-memory/) announcement. While Cloudflare's managed service requires a platform binding, kimiflare implements a local self-hosted equivalent using SQLite + Workers AI embeddings so you can use it today with your own account.

## License

[MIT](LICENSE) © Sina Meraji
