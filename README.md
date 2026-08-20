<p align="center">
  <img src="docs/logo.png" alt="kimiflare" width="180">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kimiflare"><img src="https://img.shields.io/npm/v/kimiflare?style=flat-square&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/kimiflare"><img src="https://img.shields.io/npm/dm/kimiflare?style=flat-square&color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/sinameraji/kimiflare/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sinameraji/kimiflare?style=flat-square&color=2ea44f" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/typescript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <a href="https://developers.cloudflare.com/workers-ai/models/kimi-k2"><img src="https://img.shields.io/badge/powered%20by-Kimi%20K2.7-f59e0b?style=flat-square" alt="Powered by Kimi K2.7"></a>
</p>

<p align="center">
  <strong>A terminal coding agent powered by <a href="https://developers.cloudflare.com/workers-ai/models/kimi-k2">Kimi K2.7</a> on <a href="https://developers.cloudflare.com/workers-ai/">Cloudflare Workers AI</a> — with optional routing through your own <a href="https://developers.cloudflare.com/ai-gateway/">AI Gateway</a> for first-class observability, caching, and authoritative cost.</strong><br>
  All on your Cloudflare account.
</p>

<p align="center">
  <img src="docs/demos/onboarding.gif" alt="kimiflare TUI demo" width="900">
</p>
<p align="center">
  <a href="https://kimiflare.com">Watch full demos →</a>
</p>

## How it works

KimiFlare runs on **your own Cloudflare account**. On first run you **Log in with Cloudflare** — the CLI opens a browser page, Cloudflare asks you to approve kimiflare once, and you're in (no API token to mint, no Account ID to copy; pasting a token manually still works). KimiFlare calls **Workers AI** directly by default — fastest path, fewest moving parts. You can optionally turn on routing through an **AI Gateway** in your account (provisioned or reused on first run) for observability, caching, and cost reporting. Either way, nothing leaves your Cloudflare tenancy.

With AI Gateway enabled you get this for free:

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

On first run, an interactive onboarding wizard connects your Cloudflare account — **Log in with Cloudflare** in the browser (recommended) or paste an API token — then provisions (or picks) an AI Gateway. That's it.

Or run without installing:

```sh
npx kimiflare
```

Requires Node.js ≥ 20.

### Connecting your Cloudflare account

**Log in with Cloudflare (recommended).** Pick it in the wizard, or run `kimiflare auth cloudflare` any time. Cloudflare's consent screen shows exactly what kimiflare asks for (Workers AI, AI Gateway, Secrets Store, and read access to your account list so it can pick your Account ID). Tokens are short-lived and refreshed automatically; `/logout` revokes the grant, and you can review it at <https://dash.cloudflare.com/?to=/profile/access-management/authorization>. Details for maintainers (registering the OAuth client) are in [`docs/login-with-cloudflare.md`](docs/login-with-cloudflare.md).

**Or paste an API token.** Create one at https://dash.cloudflare.com/profile/api-tokens with:

- `Workers AI:Read`
- `AI Gateway:Read` (to list gateways)
- `AI Gateway:Edit` (to create gateways)

then enter it with your Account ID in the wizard, or set `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (env credentials override a stored login).

Once configured, `/cost` shows the Gateway-confirmed totals, cache hit ratio, per-feature breakdown, and direct dashboard links to each request log. `/gateway status` shows the current TTL, skip-cache flag, metadata tags, and live cache-hit ratio.

### Custom gateway endpoint

Point every model call at your own OpenAI-compatible endpoint instead of Cloudflare — useful when a
host application (CI, an agents platform, a container) fronts AI Gateway with its own broker and
doesn't want to hand kimiflare a raw Cloudflare token:

```sh
export KIMIFLARE_BASE_URL="https://your-broker.example.com/v1"  # /chat/completions is appended
export KIMIFLARE_API_KEY="<bearer for that endpoint>"           # optional; header omitted if unset
kimiflare -p "..."        # or --mode rpc — no Cloudflare login, token, or account id needed
```

The same pair can be persisted in `~/.config/kimiflare/config.json` as `baseUrl` / `apiKey`
(env vars win over the file, field by field). When a base URL is configured it takes precedence
over **every** Cloudflare path:

- Requests go to `<baseUrl>/chat/completions` with `Authorization: Bearer $KIMIFLARE_API_KEY`
  (no `Authorization` header at all when the key is unset — e.g. a local llama.cpp/Ollama server).
- No `cf-aig-*` headers, no BYOK / Unified Billing logic, no account-id URLs, and no Cloudflare
  token validation or OAuth refresh — Cloudflare credentials become entirely optional.
- Model ids pass through in the request body unchanged; your endpoint owns provider dispatch.
- Cloudflare-only extras (AI Gateway `/cost` reconciliation, memory embeddings via Workers AI)
  still need a Cloudflare account — leave them disabled when running endpoint-only.

### Model

KimiFlare runs on **Kimi K2.7** via Cloudflare Workers AI — no API key needed beyond your Cloudflare token:

- `@cf/moonshotai/kimi-k2.7-code` — 262k context, reasoning, tools, vision

`@cf/moonshotai/kimi-k2.6`, `@cf/moonshotai/kimi-k2.5`, and `@cf/zai-org/glm-5.2`
(Zhipu AI, 262k context, reasoning + tools) are also available.

**Kimi K3** (`moonshotai/kimi-k3` — 1M context, vision, always-on reasoning) is available as a
third-party model in Cloudflare's model catalog: pick it with `/model` and it is billed from your
account's **AI Gateway credits** (Unified Billing) — no Moonshot key needed. Top up credits in the
AI Gateway dashboard.

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
    model: "@cf/moonshotai/kimi-k2.7-code",
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

The SDK needs a Cloudflare **Account ID**, **API Token**, and AI Gateway ID — or a
[custom gateway endpoint](#custom-gateway-endpoint) (`baseUrl` / `apiKey` in `config`, or
`KIMIFLARE_BASE_URL` / `KIMIFLARE_API_KEY`), in which case no Cloudflare credentials are required.
Credentials are resolved in this priority order:

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

RPC mode also runs against a [custom gateway endpoint](#custom-gateway-endpoint) alone: set
`KIMIFLARE_BASE_URL` + `KIMIFLARE_API_KEY` on the subprocess and no Cloudflare credentials are
needed — ideal for host apps that broker model access themselves.

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

// Resume a previous session after a process restart (the `new_session`
// response echoes back the sessionId to store for later)
proc.stdin.write(JSON.stringify({ type: "new_session", sessionId: "sdk-session-…" }) + "\n");
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

## Logs

KimiFlare writes structured JSON logs of agent-side activity (tool calls,
permission decisions, MCP/LSP lifecycle, session events, errors) to
`~/.config/kimiflare/logs/<date>.jsonl`, one file per day, with 7-day
retention pruned automatically at startup.

The logs deliberately exclude prompts and completions — those live in
[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
already, and each log entry includes the Gateway `request_id` so you
can join them when you need the network side.

```sh
kimiflare logs path             # today's file
kimiflare logs dir              # log directory
kimiflare logs prune            # delete files older than 7 days

# Tail this session's activity, formatted:
tail -f $(kimiflare logs path) | jq

# Find the slowest tool calls in the last day:
jq -r 'select(.event == "tool:end") | "\(.data.duration_ms)\t\(.data.tool)"' \
  $(kimiflare logs path) | sort -rn | head
```

Disable the file sink entirely with `KIMIFLARE_LOG_SINK=off`. The
separate `KIMIFLARE_LOG_LEVEL` env var (default `off`) controls stderr
output — independent of the file sink.

### Shipping to an OpenTelemetry collector

If you set `KIMIFLARE_OTEL_ENDPOINT`, KimiFlare also ships each log
entry to that endpoint over [OTLP/HTTP](https://opentelemetry.io/docs/specs/otlp/)
so it lands in Datadog, Honeycomb, Grafana Loki, an internal collector,
or any other backend that speaks OTel. Batched every 5 s (or every
100 entries, whichever first) and best-effort — never blocks the agent
loop.

```sh
# Full path:
export KIMIFLARE_OTEL_ENDPOINT="https://otel.example.com/v1/logs"
# Or just the base URL (we auto-append /v1/logs):
export KIMIFLARE_OTEL_ENDPOINT="https://otel.example.com"

# Optional headers (comma-separated key=value pairs) — e.g. for auth:
export KIMIFLARE_OTEL_HEADERS="Authorization=Bearer xyz,X-Tenant=acme"
```

Each log entry maps to one OTel `LogRecord`. Correlation IDs
(`session_id`, `turn_id`, `request_id`) become record attributes,
`data.*` fields are flattened to attributes with type-preserving
encoding, and a `service.name=kimiflare` + `service.version` pair sits
on the resource. The same `request_id` joins to Cloudflare AI Gateway's
per-request log without any extra work.

## Hooks

KimiFlare can fire shell commands at five points in an agent turn,
configured per-project (`.kimiflare/settings.json`) or globally
(`~/.config/kimiflare/settings.json`):

| Event              | Fires when                                      | Veto? |
|--------------------|-------------------------------------------------|-------|
| `PreToolUse`       | A tool call is about to run                     | Yes   |
| `PostToolUse`      | A tool call just finished                       | No    |
| `UserPromptSubmit` | You hit Enter on a prompt                       | Yes   |
| `Stop`             | A turn ended cleanly                            | No    |
| `PreCompact`       | Auto-compaction is about to run                 | No    |

Hooks receive the event payload as JSON on stdin **and** as
`KIMIFLARE_HOOK_*` env vars (for shell-one-liner ergonomics).
Non-zero exit on a veto event cancels the underlying action and
surfaces the hook's stdout as the rejection reason.

### Browse + enable from the TUI

```text
/hooks                            # list configured hooks
/hooks recommended                # list starter hooks shipped with kimiflare
/hooks enable stop-bell           # enable one (writes to .kimiflare/settings.json)
/hooks enable stop-bell global    # ...or the global file
/hooks disable stop-bell
/hooks path                       # print settings.json paths
/hooks reload                     # re-read settings.json after a manual edit
```

The recommended catalog includes terminal bells / macOS notifications
on `Stop`, secret-file guards on `PreToolUse` (e.g. block edits to
`*.env`), auto-format-with-prettier on `PostToolUse`, and a tool-call
audit log. All ship disabled — `/hooks recommended` lists them.

### Schema example

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "id": "no-secrets",
        "matcher": "^(edit|write)$",
        "command": "case \"$KIMIFLARE_HOOK_PATH\" in *.env|*.pem) echo 'blocked'; exit 1;; esac"
      }
    ],
    "PostToolUse": [
      {
        "id": "format-ts",
        "matcher": "^(edit|write)$",
        "command": "npx --no-install prettier --write \"$KIMIFLARE_HOOK_PATH\" >/dev/null 2>&1 || true"
      }
    ],
    "Stop": [
      { "id": "bell", "command": "printf '\\a'" }
    ]
  }
}
```

Per-hook fields:
- `command` (required) — the shell command.
- `matcher` (optional) — anchored regex matched against the tool name
  for `PreToolUse` / `PostToolUse`. Ignored for other events.
- `id` (optional) — stable handle for `/hooks enable|disable`.
  Auto-derived from `event + command` when omitted.
- `enabled` (default `true`) — set `false` to keep a hook in config
  but skip it.
- `timeoutMs` (default `30000`) — hard kill if the hook hangs.
- `description` (optional) — shown by `/hooks list`.

Hooks are always-on infrastructure: they fire whether the TUI is open
or kimiflare is running in `--print` mode. They also fire for tool
calls generated from inside the Code Mode sandbox (heavy-tier turns),
because hook firing lives on the `ToolExecutor` itself — every call
path uses the same plumbing.

When intent classification has assigned a tier, hook payloads include
it as `tier: "light" | "medium" | "heavy"` (on `UserPromptSubmit`,
`PreToolUse`, `PostToolUse`) and as `$KIMIFLARE_HOOK_TIER`. Useful for
"skip auto-format on light turns" or "audit every heavy-turn write."

SDK consumers opt in to hooks with `enableHooks: true` on
`createAgentSession`. Default is off because the SDK is a primitive,
not the TUI.

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
