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
  Moonshot's 1T-parameter open-source model, running directly in your terminal.
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="kimiflare TUI" width="900">
</p>

## Two ways to run

| Mode | How it works | Best for |
|------|-------------|----------|
| **BYOK** | Bring your own Cloudflare Account ID + API Token. Traffic goes straight to Workers AI from your account. | Power users who want full control and direct billing. |
| **Kimiflare Cloud** | Device auth — no API key needed. We proxy requests through our managed endpoint. | Getting started quickly without a Cloudflare account. |

> 🎁 **Try Kimiflare Cloud free** — sign up and get **5 million tokens** on us until May 14, 2026. Run `kimiflare --cloud` or pick "Cloud (managed)" during onboarding.

## What to remember

- **262k context window** — Read entire modules, large configs, and full stack traces without the model losing track.
- **Image understanding** — Drop image paths (PNG, JPG, WebP, GIF, BMP up to 5 MB) into any prompt. Great for UI reviews, diagrams, and screenshots.
- **Plan / Edit / Auto modes** — `plan` blocks mutating tools for safe research. `edit` (default) prompts per mutating call. `auto` approves everything for trusted tasks.
- **Live cost tracking** — Status bar shows real-time spend based on Cloudflare pricing. Know exactly what each turn costs.
- **LSP + MCP** — Semantic code intelligence (hover, go-to-definition, references, diagnostics) via Language Server Protocol. Extend with external tools via Model Context Protocol.
- **Local structured memory** — SQLite + embeddings cross-session memory. The agent recalls facts, instructions, and preferences across sessions via `remember`, `recall`, and `forget` tools.
- **Web search, GitHub, and headless browser** — Research the web, read GitHub repos, and fetch JavaScript-rendered pages without leaving your terminal.

## Recently shipped

- **Turn supervisor architecture** — graceful preemption, visual cleanup, and better multi-step task management.
- **Web search, GitHub read-only, and headless browser tools** — research without leaving the terminal.
- **Tiered skill routing** — the agent picks the right skill depth for the task, with visible TUI indicators.
- **Extensible JSON themes** — WCAG contrast-validated, fully customizable color palettes.
- **KIMI.md drift detection** — memory-based staleness indicators warn when your project context file is out of date.
- **Fuzzy @ file picker** — type `@` to mention files with fuzzy matching and inline filtering.
- **Kimiflare Cloud mode** — device auth, no API key needed, with real-time token budget tracking.
- **Context-window guardrails** — prevents runs that would exceed the model's limit before they start.

See the full changelog at [github.com/sinameraji/kimiflare/releases](https://github.com/sinameraji/kimiflare/releases).

## Quick start

```sh
npm install -g kimiflare
kimiflare
```

On first run, an interactive onboarding wizard asks how you want to connect — BYOK or Cloud. That's it.

Or run without installing:

```sh
npx kimiflare
```

Requires Node.js ≥ 20.

### One-shot mode

```sh
kimiflare -p "summarize PLAN.md"                    # stream answer to stdout
kimiflare -p "..." --dangerously-allow-all          # auto-approve mutating tools (for scripts)
kimiflare -p "..." --reasoning                      # include chain-of-thought in stderr
```

### Headless SDK

Use KimiFlare programmatically from your own application — no TUI required.

```ts
import { createAgentSession } from "kimiflare/sdk";

const { session } = await createAgentSession({
  cwd: "/path/to/project",
  config: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    model: "@cf/moonshotai/kimi-k2.6",
  },
});

// Stream every event: text deltas, tool calls, tasks, usage
session.subscribe((event) => {
  console.log(event.type, event);
});

// Send a prompt
await session.prompt("Refactor auth to JWT + Redis");

// Mid-flight correction while the agent is still running
await session.steer("Use Redis instead of in-memory store");

// After the turn finishes
await session.followUp("Also add unit tests");

// Clean up
session.dispose();
```

**Key features:**
- `subscribe()` — receive typed events (`text_delta`, `tool_call`, `tool_result`, `task_update`, `usage`, `error`, `done`, etc.)
- `prompt()` / `steer()` / `followUp()` — full conversation lifecycle
- `pause()` / `resume()` — graceful preemption
- `getStatus()` / `getUsage()` — inspect session state
- Custom `permissionHandler` — decide programmatically whether to allow mutating tools
- Optional `memoryEnabled`, `lspEnabled`, `costAttribution` flags

#### SDK Authentication

The SDK needs a Cloudflare **Account ID** and **API Token** to call Workers AI directly. Credentials are resolved in this priority order:

1. **Explicit `config` object** (recommended for apps)
2. **Environment variables**: `CLOUDFLARE_ACCOUNT_ID` / `CF_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN`
3. **Config file**: `~/.config/kimiflare/config.json`

**For Electron / desktop apps**, we recommend storing credentials in the OS keychain (e.g. Electron `safeStorage` or `keytar`) and passing them explicitly:

```ts
import { createAgentSession } from "kimiflare/sdk";

const accountId = await keytar.getPassword("kimiflare", "accountId");
const apiToken = await keytar.getPassword("kimiflare", "apiToken");

const { session } = await createAgentSession({
  cwd: projectPath,
  config: { accountId, apiToken },
});
```

**For zero-credential onboarding**, use KimiFlare Cloud mode. The user authenticates via GitHub device flow and a Cloudflare Worker proxies AI requests. Your app never sees raw Cloudflare credentials — only a GitHub token and `remoteWorkerUrl`.

#### RPC mode (subprocess)

If you need process isolation or a non-Node consumer, run KimiFlare in JSONL-over-stdio RPC mode:

```sh
node bin/kimiflare.mjs --mode rpc
```

```ts
import { spawn } from "node:child_process";

const proc = spawn("npx", ["kimiflare", "--mode", "rpc"], {
  cwd: projectPath,
  stdio: ["pipe", "pipe", "pipe"],
});

// Read events
proc.stdout.on("data", (chunk) => {
  for (const line of chunk.toString().split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    console.log(event.type, event);
  }
});

// Send commands
proc.stdin.write(JSON.stringify({ type: "new_session" }) + "\n");
proc.stdin.write(JSON.stringify({ type: "prompt", message: "Hello" }) + "\n");

// Resolve a permission request
proc.stdin.write(
  JSON.stringify({ type: "resolve_permission", requestId: "req_0", decision: "allow" }) + "\n"
);
```

### Image understanding

```sh
kimiflare
› fix the layout bug in this screenshot docs/bug.png
› convert this mockup design.png to Tailwind HTML
```

## Slash commands

| Command | Effect |
|---------|--------|
| `/mode edit\|plan\|auto` | Switch permission mode |
| `/thinking low\|medium\|high` | Reasoning effort (persists) |
| `/theme` | Interactive theme picker (`Ctrl+T`) |
| `/resume` | Pick a past conversation to restore |
| `/compact` | Summarize older turns to free context |
| `/init` | Scan repo and write `KIMI.md` project context |
| `/memory` | Show memory stats and search |
| `/mcp list` / `/mcp reload` | Manage MCP servers |
| `/reasoning` | Toggle chain-of-thought display |
| `/cost` | Show token usage for current turn |
| `/update` | Check for updates |
| `/help` | List all commands |

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` / `Esc` | Interrupt current turn when busy; exit when idle |
| `Ctrl+R` | Toggle reasoning display |
| `Ctrl+O` | Toggle verbose tool output |
| `Ctrl+T` | Open theme picker |
| `Shift+Tab` | Cycle mode (edit → plan → auto) |
| `↑` / `↓` | Walk prompt history |

## Development

```sh
git clone https://github.com/sinameraji/kimiflare
cd kimiflare
npm install
npm run build
npm link
```

Scripts:
- `npm run build` — bundle with tsup
- `npm run dev` — run via tsx
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — run tests

## Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run `npm run typecheck` and `npm run build`
5. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
6. Open a Pull Request

---

Built by [Sina Meraji](https://github.com/sinameraji) and [contributors](https://github.com/sinameraji/kimiflare/graphs/contributors) · MIT License
