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
  <strong>A terminal coding agent powered by <a href="https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/">Kimi-K2.6</a>, routed through your own <a href="https://developers.cloudflare.com/ai-gateway/">Cloudflare AI Gateway</a>.</strong><br>
  Moonshot's 1T-parameter open-source model, with first-class observability, caching, and authoritative cost — all on your Cloudflare account.
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="kimiflare TUI" width="900">
</p>

## How it works

You bring your own Cloudflare **Account ID** + **API Token**. KimiFlare provisions (or reuses) an **AI Gateway** in your account and routes every model request through it. Nothing leaves your Cloudflare tenancy.

You get this for free:

- **Per-request logs** with full payload, latency, and status — visible in the Cloudflare dashboard
- **Response caching** with configurable TTL (`/gateway cache-ttl <seconds>`)
- **Authoritative per-turn cost** pulled from the Gateway logs API — no estimates
- **Cache-hit ratio and per-feature cost breakdown** in `/cost`
- **Auto-tagging** of every request with `feature` / `sessionId` / `turnIdx` metadata for downstream attribution

## What to remember

- **262k context window** — Read entire modules, large configs, and full stack traces without the model losing track.
- **Image understanding** — Drop image paths (PNG, JPG, WebP, GIF, BMP up to 5 MB) into any prompt. Great for UI reviews, diagrams, and screenshots.
- **Plan / Edit / Auto modes** — `plan` is a whitelist-only research mode: only read-only tools (read, glob, grep, web search, GitHub read-only, browser fetch) are allowed. Writes, edits, mutating bash, MCP tools, and LSP renames are all blocked. `edit` (default) prompts per mutating call. `auto` approves everything for trusted tasks.
- **Windows support** — OS-aware shell auto-detects `cmd.exe` / PowerShell on Windows, `bash` on Unix. The `bash` tool works out of the box on all platforms.
- **Message queuing** — Submit multiple messages while the agent is busy; they queue and auto-drain. Escape interrupts the current turn but preserves the queue.
- **Smart permission modal** — Denying a tool opens inline feedback so you can tell the agent what to do instead. Keyboard-native navigation (`↑/↓`, `j/k`, `Alt+1/2/3`).
- **Loop guardrails** — Agent hard-stops when all tools in a turn are blocked, preventing infinite token-burning cycles.
- **Persistent all-time cost history** — Append-only `history.jsonl` tracks daily usage forever, so `/cost` shows true all-time and monthly totals that survive across sessions and version updates.
- **Live, gateway-confirmed cost tracking** — Status bar shows a fast local estimate (`≈$0.12`) that flips to the real, Cloudflare-billed number once the AI Gateway log reconciles. Per-turn latency renders next to cost.
- **LSP + MCP** — Semantic code intelligence (hover, go-to-definition, references, diagnostics) via Language Server Protocol. Extend with external tools via Model Context Protocol.
- **Local structured memory** — SQLite + embeddings cross-session memory. The agent recalls facts, instructions, and preferences across sessions via `remember`, `recall`, and `forget` tools.
- **Web search, GitHub, and headless browser** — Research the web, read GitHub repos, and fetch JavaScript-rendered pages without leaving your terminal.

## Recently shipped

- **OS-aware shell with Windows support** — Auto-detects `cmd.exe`, PowerShell, or bash based on platform. Override with `KIMIFLARE_SHELL` or `/shell`.
- **Smart permission modal with inline feedback** — Deny a tool and immediately tell the agent what to do instead. Keyboard-native navigation with `↑/↓`, `j/k`, `Alt+1/2/3`.
- **True message queuing** — Enter queues messages while the agent is busy; Escape interrupts and auto-drains the queue.
- **Hard-stop loop guardrail** — Stops token-burning cycles when all tools in a turn are blocked.
- **Persistent all-time usage history** — `history.jsonl` tracks daily usage forever; `/cost` shows true all-time and monthly totals.
- **Humanized Cloudflare API errors** — Actionable error codes and structured error display instead of raw JSON dumps.
- **429 rate limit retry** — Automatic backoff and retry when Cloudflare rate-limits requests.
- **Tool state visualization** — Queued, rejected, and cancelled tools are clearly labeled in the TUI.
- **Paste preview placeholders** — Pasted content shows a snippet preview with sequential IDs instead of random hashes.
- **Headless SDK** — Programmatic `createAgentSession` API and JSONL-over-stdio RPC mode for building on top of KimiFlare.

See the full changelog at [github.com/sinameraji/kimiflare/releases](https://github.com/sinameraji/kimiflare/releases).

## Quick start

```sh
npm install -g kimiflare
kimiflare
```

On first run, an interactive onboarding wizard collects your Cloudflare credentials and provisions (or picks) an AI Gateway. That's it.

Or run without installing:

```sh
npx kimiflare
```

Requires Node.js ≥ 20.

### Cloudflare API token

The onboarding wizard provisions or picks an AI Gateway in your account. Your Cloudflare API token needs:

- `Workers AI:Read`
- `AI Gateway:Read` (to list gateways)
- `AI Gateway:Edit` (to create gateways)

Edit your token at: https://dash.cloudflare.com/profile/api-tokens

Once configured, `/cost` shows the Gateway-confirmed totals, cache hit ratio, per-feature breakdown, and direct dashboard links to each request log. `/gateway status` shows the current TTL, skip-cache flag, metadata tags, and live cache-hit ratio.

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
    aiGatewayId: process.env.CLOUDFLARE_AI_GATEWAY_ID,
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
- `subscribe()` — receive typed events (`text_delta`, `tool_call`, `tool_result`, `task_update`, `usage`, `warning`, `error`, `done`, etc.)
- `prompt()` / `steer()` / `followUp()` — full conversation lifecycle
- `pause()` / `resume()` — graceful preemption
- `getStatus()` / `getUsage()` — inspect session state
- Custom `permissionHandler` — decide programmatically whether to allow mutating tools
- Optional `memoryEnabled`, `lspEnabled`, `costAttribution` flags

#### SDK Authentication

The SDK needs a Cloudflare **Account ID**, **API Token**, and AI Gateway ID. Credentials are resolved in this priority order:

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
| `/shell auto\|bash\|cmd\|powershell` | Show or set the shell for the bash tool |
| `/thinking low\|medium\|high` | Reasoning effort (persists) |
| `/theme` | Interactive theme picker (`Ctrl+T`) |
| `/resume` | Pick a past conversation to restore |
| `/compact` | Summarize older turns to free context |
| `/init` | Scan repo and write `KIMI.md` project context |
| `/memory` | Show memory stats and search |
| `/mcp list` / `/mcp reload` | Manage MCP servers |
| `/reasoning` | Toggle chain-of-thought display |
| `/cost` | Show Gateway-confirmed cost, cache hit ratio, and per-feature breakdown |
| `/gateway status` | Show AI Gateway config and live cache-hit ratio |
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
