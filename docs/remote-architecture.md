# `/remote` Feature — Architecture Document & Implementation Plan

**Status:** Design complete, awaiting implementation.  
**Decisions confirmed:** OAuth Device Flow (C), Worker Relay (B), Rich Base + Auto-Setup (C), Persistent Baseline + Copy (A), TUI + CLI + Web (C).

---

## Table of Contents

1. [Codebase Findings](#1-codebase-findings)
2. [End-to-End Sequence Diagram](#2-end-to-end-sequence-diagram)
3. [Worker Design](#3-worker-design)
4. [Artifacts Repo Lifecycle](#4-artifacts-repo-lifecycle)
5. [Sandbox Lifecycle](#5-sandbox-lifecycle)
6. [Secret and Credential Flow](#6-secret-and-credential-flow)
7. [GitHub Integration](#7-github-integration)
8. [Local CLI Changes](#8-local-cli-changes)
9. [Failure Modes and Recovery](#9-failure-modes-and-recovery)
10. [Observability](#10-observability)
11. [Cost Model Per Session](#11-cost-model-per-session)
12. [Pre-Mortem](#12-pre-mortem)
13. [Phased Implementation Plan](#13-phased-implementation-plan)

---

## 1. Codebase Findings

### 1.1 Current Agent Loop

**Files:** `src/agent/loop.ts`, `src/agent/orchestrator.ts`, `src/agent/agent-session.ts`

The agent loop is well-factored and largely reusable for a headless remote variant.

- `runAgentTurn(opts: AgentTurnOpts)` (`src/agent/loop.ts:62`) is the core turn runner. It takes a prompt, messages array, tools, executor, callbacks, and an `AbortSignal`. It streams LLM events and executes tools in a loop until `maxToolIterations` (default 50) is hit.
- `AgentOrchestrator` (`src/agent/orchestrator.ts:51`) sits above `runAgentTurn` for multi-agent mode. It manages per-role `AgentSession` objects (message buffers, artifact stores) and handles hand-offs between `research` / `coding` / `generalist` agents.
- `AgentSession` (`src/agent/agent-session.ts:11`) is a plain object: `{ role, messages, recentToolCalls, artifactStore }`.

**Reusability assessment:**
- ✅ `runAgentTurn` can run headless with no TUI changes — it only calls callbacks.
- ✅ `AgentOrchestrator` can run headless — same callback pattern.
- ⚠️ The callback interface (`AgentCallbacks`, `src/agent/loop.ts:14`) is TUI-oriented (`onTextDelta`, `onReasoningDelta`, `onToolCallStart`, etc.). For `/remote`, we need a **structured progress serializer** that converts these callbacks into JSON lines for the Worker to relay. This is a thin adapter, not a refactor.
- ⚠️ `codeMode` (`src/agent/loop.ts:51`) and `memoryManager` are optional; the remote agent can disable them in v1.

**Key excerpt — the seam where headless mode diverges:**

```ts
// src/tools/executor.ts:91
async run(
  call: ToolInvocation,
  askPermission: PermissionAsker,  // <-- this is the seam
  ctx: ToolContext,
  onFileChange?: (path: string, content: string) => void,
): Promise<ToolResult> {
  // ...
  if (tool.needsPermission) {
    const sessionKey = this.permissionKey(tool, args);
    if (!this.sessionAllowed.has(sessionKey)) {
      const decision = await askPermission({ tool, args, sessionKey });
      // ...
    }
  }
}
```

In local `auto` mode, `askPermission` immediately resolves `"allow"` (`src/app.tsx:1528`). The remote agent will do the same — no permission gating changes needed in `ToolExecutor`, just a headless `askPermission` that always returns `"allow"`.

### 1.2 Config and Credential Handling

**File:** `src/config.ts`

Config lives at `~/.config/kimiflare/config.json` (XDG-compliant, falls back to `~/.kimiflare/config.json` for legacy).

```ts
// src/config.ts:25
export interface KimiConfig {
  accountId: string;
  apiToken: string;
  model: string;
  aiGatewayId?: string;
  // ... many other fields
}
```

Credentials are **BYOK-only today**: the user puts their Cloudflare `accountId` and `apiToken` into the config file. There is no OAuth, no hosted auth, no secret manager integration.

**How `/remote` secrets fit:**
- `remoteWorkerUrl`: new optional config field pointing to the user's deployed orchestrator Worker.
- `githubToken`: new optional config field (PAT or fine-grained PAT) for PR creation.
- These should follow the exact same pattern: read from config file, overridable by env vars (`KIMIFLARE_REMOTE_WORKER_URL`, `KIMIFLARE_GITHUB_TOKEN`).

### 1.3 CLI Command Framework

**Files:** `src/commands/builtins.ts`, `src/app.tsx` ( `handleSlash` )

Slash commands are dispatched in a single `handleSlash` callback inside the Ink `App` component. There is no separate command router — commands are hard-coded in `handleSlash` and matched by string prefix.

**Excerpt of the most similar existing command (`/cost`):**

```ts
// src/app.tsx:1766
if (c === "/cost") {
  if (!cfg) return true;
  if (arg === "on") {
    const next = { ...cfg, costAttribution: true };
    setCfg(next);
    void saveConfig(next).catch(() => {});
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "cost attribution enabled" }]);
    return true;
  }
  // ...
}
```

**Pattern for `/remote`:**
1. Add `{ name: "remote", argHint: "[status|cancel <id>]", description: "...", source: "builtin" }` to `BUILTIN_COMMANDS` in `src/commands/builtins.ts`.
2. Add a branch in `handleSlash` in `src/app.tsx`.
3. If the user types `/remote` with no args, open a prompt collector (similar to how `/init` builds a prompt and calls `runAgentTurn`, but instead calls the Worker).

### 1.4 GitHub Repo Identification

**Finding:** kimiflare has **no explicit GitHub repo detection today**. It operates entirely on `process.cwd()`. There is no `git remote` inspection, no `GITHUB_REPO` env var, no config field for repo identity.

**Implication for `/remote`:** We must add repo identification. The most natural place is:
- At `/remote` invocation, inspect `git remote get-url origin` in `process.cwd()`.
- Parse out `owner/repo`.
- Cache it in the local session file (or config) so the user doesn't re-enter it.
- This is new infrastructure; `/remote` invents it, but it should be minimal and automatic.

### 1.5 Local State Directory

**Files:** `src/sessions.ts`, `src/util/state.ts`, `src/usage-tracker.ts`

Local state is organized under `~/.config/kimiflare/`:

```ts
// src/sessions.ts:36
function sessionsDir(): string {
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "sessions");
}

// src/usage-tracker.ts:71
function usageDir(): string {
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "usage");
}

// src/util/state.ts:9
function statePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "state.json");
}
```

Sessions are JSON files named `{timestamp}-{sanitized-prompt}.json`. They contain messages, session state, artifact stores, and multi-agent state.

**Integration point for `/remote`:**
- Add a `remote/` subdirectory under `~/.config/kimiflare/` for remote session tracking.
- Each remote session gets a JSON file: `{sessionId}.json` with fields: `sessionId`, `prompt`, `repo`, `workerUrl`, `status`, `branch`, `prUrl`, `createdAt`, `updatedAt`.
- This mirrors the existing session persistence pattern exactly.

### 1.6 Tool Execution / File Edit Pipeline

**File:** `src/tools/executor.ts`

`ToolExecutor.run()` is the universal entrypoint. It:
1. Looks up the tool by name.
2. Parses JSON args.
3. Checks `tool.needsPermission` against `sessionAllowed` set.
4. If not allowed, calls `askPermission` (the seam).
5. Runs `tool.run(args, ctx)`.
6. Normalizes and reduces output via `reduceToolOutput()`.
7. Returns `ToolResult`.

**Headless variant:** The remote agent inside the Sandbox will instantiate `ToolExecutor` with `ALL_TOOLS` (or a subset), and pass an `askPermission` that always resolves `"allow"`. No changes to `ToolExecutor` or individual tools are required.

**The only Sandbox-specific consideration:** Some tools assume a local filesystem (`read`, `write`, `edit`, `bash`, `glob`, `grep`). Inside the Sandbox, `process.cwd()` will be `/workspace` and the repo will be cloned there. These tools will work unchanged because they operate on `ctx.cwd`.

### 1.7 Streaming and Output Rendering

**File:** `src/agent/loop.ts` ( `AgentCallbacks` )

Local streaming uses a rich callback interface:

```ts
// src/agent/loop.ts:14
export interface AgentCallbacks {
  onAssistantStart?: () => void;
  onReasoningDelta?: (text: string) => void;
  onTextDelta?: (text: string) => void;
  onToolCallStart?: (index: number, id: string, name: string) => void;
  onToolCallArgs?: (index: number, delta: string) => void;
  onToolCallFinalized?: (call: ToolCall) => void;
  onUsage?: (usage: Usage) => void;
  onUsageFinal?: (usage: Usage, gatewayMeta?: GatewayMeta) => void;
  onGatewayMeta?: (meta: GatewayMeta) => void;
  onAssistantFinal?: (msg: ChatMessage) => void;
  onToolResult?: (result: ToolResult) => void;
  onTasks?: (tasks: Task[]) => void;
  askPermission: PermissionAsker;
}
```

For `/remote`, the Sandbox agent will use the same callbacks but serialize them to **NDJSON progress events** that the Worker relays over SSE/WebSocket. Example event types:

```ts
type RemoteProgressEvent =
  | { type: "turn_start"; turn: number }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_result"; name: string; ok: boolean; content: string }
  | { type: "usage"; promptTokens: number; completionTokens: number }
  | { type: "tasks"; tasks: Task[] }
  | { type: "turn_end" }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string };
```

The local CLI will render these as a simplified TUI stream (no diff modals, no permission prompts — just a tail of agent activity).

### 1.8 Build, Test, and Release Tooling

**Files:** `package.json`, `tsup.config.ts`

- **Build:** `tsup` bundles `src/index.tsx` → `dist/index.js` (ESM, Node 20 target). Runtime deps (`ink`, `react`, `commander`, etc.) are externalized.
- **CLI shim:** `bin/kimiflare.mjs` is a small wrapper that imports `../dist/index.js`.
- **Test:** `tsx --test src/**/*.test.ts src/**/*.test.tsx` (Node native test runner).
- **Release:** `npm run build` then `npm publish`. No Docker, no CI/CD config in repo.

**Implication:** The `/remote` feature adds two new artifacts that do not fit the existing npm package:
1. A **Cloudflare Worker** (orchestrator) — needs its own `wrangler.toml`, `package.json`, and build step.
2. A **Sandbox container image** — needs a `Dockerfile` and a build/push workflow.

These should live in a new `remote/` directory at repo root, with their own build scripts. The main `package.json` gets a `build:remote` script that delegates. Release process should include pushing the container image to a registry (GHCR or Docker Hub) and deploying the Worker via `wrangler deploy`.

---

## 2. End-to-End Sequence Diagram

### 2.1 Session Start

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────┐     ┌─────────────┐
│ Local CLI   │     │ Orchestrator    │     │ Artifacts       │     │ Sandbox     │     │ GitHub      │
│ (kimiflare) │     │ Worker          │     │ (Git server)    │     │ Container   │     │ API         │
└──────┬──────┘     └────────┬────────┘     └────────┬────────┘     └──────┬──────┘     └──────┬──────┘
       │                     │                       │                     │                     │
       │  1. POST /remote/start                      │                     │                     │
       │  { prompt, repo, branch, githubToken,       │                     │                     │
       │   accountId, apiToken, model, config }      │                     │                     │
       │ ───────────────────────────────────────────>│                     │                     │
       │                     │                       │                     │                     │
       │                     │  2. Generate sessionId  │                     │                     │
       │                     │  (uuid, 8-char prefix)  │                     │                     │
       │                     │                       │                     │                     │
       │                     │  3. Create Artifacts repo                     │                     │
       │                     │  POST /repos  { name: "kf-<sessionId>" }      │                     │
       │                     │ ──────────────────────>│                     │                     │
       │                     │  { repoUrl, writeToken }                       │                     │
       │                     │ <──────────────────────│                     │                     │
       │                     │                       │                     │                     │
       │                     │  4. Sync baseline     │                     │                     │
       │                     │  (clone from GitHub or copy from cached baseline)
       │                     │ ──────────────────────>│                     │                     │
       │                     │                       │                     │                     │
       │                     │  5. Create Sandbox    │                     │                     │
       │                     │  sandbox.create({ id: sessionId, image: "kimiflare/remote-agent" })
       │                     │ ───────────────────────────────────────────────────────────────>│
       │                     │                       │                     │                     │
       │                     │  6. Start agent process in Sandbox            │                     │
       │                     │  exec("node", ["/opt/kimiflare/remote-agent.mjs"], {            │
       │                     │    env: { SESSION_ID, ARTIFACTS_URL, ARTIFACTS_TOKEN,           │
       │                     │           WORKER_RELAY_URL, REPO_OWNER, REPO_NAME,              │
       │                     │           GITHUB_BRANCH, PROMPT, MODEL, ... } })                │
       │                     │ ───────────────────────────────────────────────────────────────>│
       │                     │                       │                     │                     │
       │                     │  7. Stream SSE back to CLI                    │                     │
       │  { sessionId, status: "running", streamUrl }  │                     │                     │
       │ <───────────────────────────────────────────│                     │                     │
       │                     │                       │                     │                     │
       │  8. CLI opens SSE to streamUrl                │                     │                     │
       │ ────────────────────────────────────────────>│                     │                     │
       │  [progress events: turn_start, text_delta, tool_call, tool_result, usage, ...]        │
       │ <───────────────────────────────────────────│                     │                     │
       │                     │                       │                     │                     │
```

### 2.2 Agent Execution (Inside Sandbox)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Sandbox Agent   │     │ Orchestrator    │     │ Workers AI      │     │ Artifacts       │
│ Process         │     │ Worker          │     │ (Kimi K2.6)     │     │ Repo            │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │                       │
         │  1. POST /relay       │                       │                       │
         │  { model, messages, tools, temperature }      │                       │
         │ ─────────────────────>│                       │                       │
         │                       │  2. Forward to Workers AI                     │
         │                       │  (holds real API token)                       │
         │                       │ ─────────────────────>│                       │
         │                       │  [SSE stream: reasoning, text, tool_calls]    │
         │                       │ <─────────────────────│                       │
         │                       │                       │                       │
         │  3. Stream response back                      │                       │
         │ <─────────────────────│                       │                       │
         │                       │                       │                       │
         │  4. Execute tools (read, write, edit, bash, git)                      │
         │  → All operate on /workspace (cloned Artifacts repo)                  │
         │                       │                       │                       │
         │  5. git commit after each successful tool batch                       │
         │  → Commits land in the Artifacts repo (not GitHub yet)                │
         │                       │                       │                       │
         │  6. Stream progress events to Worker via POST /progress               │
         │  { sessionId, events: [...] }               │                       │
         │ ─────────────────────>│                       │                       │
         │                       │  7. Relay to CLI SSE stream                   │
         │                       │                       │                       │
         │                       │                       │                       │
```

### 2.3 Finalize (PR Creation)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Sandbox Agent   │     │ Orchestrator    │     │ Artifacts       │     │ GitHub          │
│ Process         │     │ Worker          │     │ Repo            │     │ API             │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │                       │
         │  1. Agent finishes    │                       │                       │
         │  → Final git commit + push to Artifacts       │                       │
         │                       │                       │                       │
         │  2. POST /finalize    │                       │                       │
         │  { sessionId, summary, commitCount }          │                       │
         │ ─────────────────────>│                       │                       │
         │                       │                       │                       │
         │                       │  3. Push branch from Artifacts to GitHub      │
         │                       │  git push https://<githubToken>@github.com/... │
         │                       │ ──────────────────────────────────────────────>│
         │                       │                       │                       │
         │                       │  4. Open PR via GitHub API                    │
         │                       │  POST /repos/{owner}/{repo}/pulls             │
         │                       │  { title, body, head: "kimiflare/remote/<sessionId>", base: "main" }
         │                       │ ──────────────────────────────────────────────>│
         │                       │  { html_url, number } │                       │
         │                       │ <──────────────────────────────────────────────│
         │                       │                       │                       │
         │                       │  5. Update session state: status="done"       │
         │                       │  Store PR URL, branch name, summary           │
         │                       │                       │                       │
         │  6. Stream final event to CLI                 │                       │
         │  { type: "done", prUrl, branch, summary }     │                       │
         │ <─────────────────────│                       │                       │
         │                       │                       │                       │
```

### 2.4 What Runs Where

| Component | Location | Responsibilities |
|-----------|----------|------------------|
| **Local CLI** | User's laptop | Collect prompt, auth with Worker, stream progress, persist session metadata, subcommands for status/cancel/list |
| **Orchestrator Worker** | Cloudflare Edge | Session lifecycle, Artifacts repo management, Sandbox creation/management, GitHub API calls, LLM relay, progress streaming, finalize/PR creation |
| **Sandbox Container** | Cloudflare Sandbox | Run headless kimiflare agent, execute tools on `/workspace`, call LLM via Worker relay, commit to Artifacts repo |
| **Artifacts Repo** | Cloudflare Artifacts | Per-session Git repo holding the agent's work. Durable across Sandbox restarts. |
| **GitHub** | GitHub.com | Source of truth for baseline code, destination for PRs |

---

## 3. Worker Design

### 3.1 Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/remote/start` | Bearer token (CLI → Worker shared secret) | Start a new remote session. Returns `{ sessionId, streamUrl }`. |
| `GET` | `/remote/stream/:sessionId` | None (URL contains random token) | SSE endpoint for progress events. Opened by local CLI. |
| `POST` | `/remote/cancel/:sessionId` | Bearer token | Cancel a running session. Signals Sandbox to terminate. |
| `GET` | `/remote/status/:sessionId` | None (or Bearer token) | JSON snapshot of session state (for CLI subcommands and web page). |
| `POST` | `/relay` | Internal (Sandbox → Worker, IP-restricted or mTLS) | LLM relay endpoint. Sandbox agent sends prompts here; Worker forwards to Workers AI. |
| `POST` | `/progress/:sessionId` | Internal (Sandbox → Worker) | Sandbox agent posts batched progress events. Worker relays to SSE stream. |
| `POST` | `/finalize/:sessionId` | Internal (Sandbox → Worker) | Agent signals completion. Worker pushes branch to GitHub and opens PR. |
| `GET` | `/remote/web/:sessionId` | None | Static HTML page that consumes the SSE stream. For mobile/status checking. |

### 3.2 Worker Authentication (Local CLI → Worker)

The Worker must verify that the local CLI is authorized to start sessions.

**Mechanism:** Shared secret + optional OAuth.

1. **Shared Secret (v1):** User generates a random secret (`wrangler secret put REMOTE_AUTH_SECRET`) and stores it in both the Worker and their local config (`remoteAuthSecret`). The CLI sends it as `Authorization: Bearer <secret>` on every request.
2. **OAuth Extension (v2):** For managed cloud, the Worker can accept a JWT issued by a kimiflare auth service. BYOK users continue using the shared secret.

**Why not just the GitHub token?** The GitHub token is for GitHub API calls, not for Worker authentication. Separating them means a leaked GitHub token can't be used to spawn arbitrary Sandbox sessions.

### 3.3 Worker → Artifacts

The Worker uses the **Artifacts Workers Binding API** (not REST) for performance.

```ts
// wrangler.toml
[[artifacts]]
binding = "ARTIFACTS"
```

```ts
// In the Worker
const repo = await env.ARTIFACTS.createRepo({
  name: `kf-${sessionId}`,
});
// repo.url, repo.writeToken, repo.readToken
```

For baseline sync, the Worker may need to read from an existing baseline repo. The binding provides read/write token generation scoped to specific repos.

### 3.4 Worker → Sandbox

The Worker uses the **Sandbox SDK binding**.

```ts
// wrangler.toml
[[sandbox]]
binding = "SANDBOX"
```

```ts
// In the Worker
const sandbox = await env.SANDBOX.create({
  id: sessionId,  // deterministic for routing
  image: "kimiflare/remote-agent:latest",
  env: {
    SESSION_ID: sessionId,
    ARTIFACTS_URL: repo.url,
    ARTIFACTS_TOKEN: repo.writeToken,
    WORKER_RELAY_URL: `https://${workerHost}/relay`,
    // ... other config
  },
});
```

**Sandbox ID strategy:** Derived directly from `sessionId` (e.g., `sandbox.id = sessionId`). This ensures stable routing: if the Worker needs to send a command to an existing Sandbox, it uses the same ID.

### 3.5 State Management

**Durable Object (DO) per session.**

Each `/remote` session gets its own Durable Object instance keyed by `sessionId`.

**Why Durable Object?**
- SSE streams require a persistent WebSocket-like connection. DOs maintain in-memory state and can hold the SSE `ReadableStream`.
- DOs survive Worker restarts and colocate compute with state.
- DOs provide atomic state updates and alarm-based timeouts.

**DO State Schema:**

```ts
interface SessionState {
  sessionId: string;
  status: "pending" | "running" | "paused" | "done" | "error" | "cancelled";
  prompt: string;
  repo: { owner: string; name: string };
  branch: string;
  artifactsRepo: { name: string; url: string; writeToken: string };
  sandboxId: string;
  githubToken: string;  // encrypted at rest (DO storage is encrypted)
  progressEvents: RemoteProgressEvent[];  // last 1000, for replay
  prUrl?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  maxTurns: number;
  currentTurn: number;
}
```

**Why not KV or D1?**
- KV is eventually consistent and has 60s propagation — unacceptable for real-time progress.
- D1 is SQL but doesn't support SSE streaming or alarms natively.
- DO is the right abstraction for session-oriented state + streaming.

---

## 4. Artifacts Repo Lifecycle

### 4.1 Naming Convention

Per-session repo name: `kf-<sessionId>`

- `sessionId` is a UUID v4, 36 chars. Prefix `kf-` makes it 39 chars.
- Artifacts limits: 3–63 chars, lowercase, a-z and hyphens only.
- UUID v4 contains hyphens, which are allowed. All lowercase.
- Collision probability: effectively zero (UUID v4).

### 4.2 Baseline Repo

**Persistent baseline:** `kf-baseline-<owner>-<repo>`

- Created lazily on first `/remote` invocation for a given GitHub repo.
- The Worker refreshes it from GitHub `main` before each session batch:
  1. Check if baseline exists.
  2. If not, create it and clone from GitHub.
  3. If it exists, fetch latest from GitHub and fast-forward.
- The baseline is updated in-place; it is not immutable.

**Why a baseline?**
- Artifacts-to-Artifacts copy is fast (same data center, no egress).
- GitHub clone bandwidth is saved.
- For `/parallel N`, all N sessions copy from the same baseline — instant.

### 4.3 Per-Session Repo Creation

For each session:
1. Worker creates a new Artifacts repo: `kf-<sessionId>`.
2. Worker clones the baseline repo into the new repo.
3. Worker creates a new branch: `kimiflare/remote/<sessionId>`.
4. The Sandbox agent works on this branch.

### 4.4 Token Strategy

| Token | Minted By | Lifetime | Scope |
|-------|-----------|----------|-------|
| **Artifacts write token** | Worker (via binding) | Per-session, 24h | Single repo: `kf-<sessionId>` |
| **Artifacts read token** | Worker (via binding) | Per-session, 24h | Single repo: `kf-<sessionId>` or baseline |
| **GitHub token** | User (OAuth or PAT) | OAuth: 8h access + refresh; PAT: until revoked | User's repos (PR + push) |
| **Workers AI token** | Worker (via binding or secret) | Per-request | Workers AI inference |

**Token flow:**
- Artifacts write token → injected into Sandbox env → agent uses it to `git push` to the session repo.
- GitHub token → **never** enters Sandbox. Held only by Worker. Used in finalize step to push branch to GitHub and open PR.
- Workers AI token → held by Worker. Sandbox calls `/relay`; Worker attaches the token.

### 4.5 Cleanup Policy

- **Session repos:** Deleted 7 days after session completion (success or error). Configurable via `REMOTE_REPO_TTL_DAYS` env var on Worker.
- **Baseline repos:** Kept indefinitely. Refreshed on demand. If unused for 30 days, Worker may delete and recreate lazily.
- **Cleanup mechanism:** DO alarm scheduled at session completion. Alarm fires after TTL; Worker calls `env.ARTIFACTS.deleteRepo(name)`.

---

## 5. Sandbox Lifecycle

### 5.1 Container Image

**Base:** `node:20-bookworm` (Debian 12, full build toolchain)

**Pre-installed:**
- `node` (20.x) + `npm`
- `git`
- `python3` + `pip`
- `build-essential` (gcc, g++, make)
- `curl`, `wget`, `jq`
- `rustup` (Rust toolchain)
- `golang` (Go compiler)

**Image layers:**
1. Base Debian + system packages
2. Node + npm
3. Language runtimes (Python, Rust, Go)
4. Pre-built kimiflare remote agent (`remote/agent/remote-agent.mjs`)

**Size:** ~1.5GB uncompressed. Cloudflare caches images after first pull, so cold start is ~10–30s, warm start is ~2–5s.

**Registry:** GitHub Container Registry (`ghcr.io/sinameraji/kimiflare-remote-agent`).

### 5.2 Sandbox ID Strategy

```ts
sandboxId = sessionId;  // deterministic 1:1 mapping
```

This means:
- The Worker can always address a Sandbox by its session ID.
- If a DO needs to send a command to a Sandbox, it uses `env.SANDBOX.get(sessionId)`.
- No separate ID namespace to manage.

### 5.3 Agent Launch

The Worker starts the agent via `sandbox.exec()`:

```ts
await sandbox.exec("node", ["/opt/kimiflare/remote-agent.mjs"], {
  env: {
    SESSION_ID: sessionId,
    ARTIFACTS_URL: artifactsRepo.url,
    ARTIFACTS_TOKEN: artifactsRepo.writeToken,
    WORKER_RELAY_URL: `https://${workerHost}/relay`,
    PROGRESS_URL: `https://${workerHost}/progress/${sessionId}`,
    FINALIZE_URL: `https://${workerHost}/finalize/${sessionId}`,
    REPO_OWNER: repo.owner,
    REPO_NAME: repo.name,
    GITHUB_BRANCH: `kimiflare/remote/${sessionId}`,
    PROMPT: prompt,
    MODEL: model,
    MAX_TURNS: String(maxTurns),
    REASONING_EFFORT: reasoningEffort,
  },
  cwd: "/workspace",
});
```

The agent process is long-running. It:
1. Clones the Artifacts repo into `/workspace`.
2. Checks out the session branch.
3. Runs the agent loop (`runAgentTurn` in headless mode).
4. Commits after each tool batch.
5. Posts progress events to `PROGRESS_URL`.
6. On completion, posts to `FINALIZE_URL`.

### 5.4 stdout/stderr/progress Streaming

The Sandbox agent writes progress events as **NDJSON lines** to stdout. The Sandbox SDK captures stdout and streams it to the Worker.

```ts
// Inside Sandbox agent
console.log(JSON.stringify({ type: "turn_start", turn: 1 }));
console.log(JSON.stringify({ type: "text_delta", text: "I'll start by..." }));
console.log(JSON.stringify({ type: "tool_call", name: "read", args: "{\"path\":\"README.md\"}" }));
// ...
```

The Worker parses these lines and relays them to the SSE stream connected to the local CLI.

**Why NDJSON to stdout instead of HTTP posts?**
- Simpler: no HTTP client needed inside the agent.
- The Sandbox SDK already captures stdout; we just need to parse it.
- For `/parallel N`, HTTP posts from N Sandboxes could overwhelm the Worker. stdout streaming is pull-based (Worker reads at its own pace).

**Alternative (HTTP posts):** If stdout parsing proves unreliable, the agent can POST batched events to `PROGRESS_URL`. This is a fallback, not the primary path.

### 5.5 Sandbox Sleep Behavior

Cloudflare Sandboxes sleep after a period of inactivity (exact timeout TBD by Cloudflare, typically 5–15 minutes).

**Impact on long-running agents:**
- If the agent is actively running (CPU usage > 0), the Sandbox stays warm.
- If the agent is waiting for an LLM response (which can take 30–60s), the Sandbox may sleep.
- **Mitigation:** The agent sends a heartbeat (empty NDJSON line or `{"type":"heartbeat"}`) every 60s while idle. This keeps the Sandbox warm.
- **Resume:** If the Sandbox does sleep, the Worker detects it on next stdout read and calls `sandbox.wake()` (or the SDK auto-wakes on next exec). The agent process resumes from where it left off — no state loss because all state is in the Artifacts repo and the DO.

### 5.6 Idle Timeout and Forced Shutdown

| Timeout | Value | Action |
|---------|-------|--------|
| **Max session duration** | 4 hours | DO alarm fires; Worker cancels Sandbox, sets status="error", notifies user. |
| **Idle timeout** | 30 minutes | If no stdout output for 30m, Worker assumes agent is stuck; cancels Sandbox. |
| **Tool iteration limit** | 50 (configurable) | Agent loop self-terminates after 50 turns. |
| **Token budget** | 1M tokens (configurable) | Agent loop self-terminates if cumulative usage exceeds budget. |

---

## 6. Secret and Credential Flow

### 6.1 Worker Secrets

Stored via `wrangler secret put`:

| Secret | Description |
|--------|-------------|
| `REMOTE_AUTH_SECRET` | Shared secret for CLI → Worker auth. |
| `CF_API_TOKEN` | Cloudflare API token for Workers AI relay. |
| `GITHUB_APP_CLIENT_SECRET` | For OAuth device flow (if using GitHub App). |
| `GITHUB_WEBHOOK_SECRET` | For GitHub webhook verification (optional). |

### 6.2 Sandbox Environment Variables

Injected by Worker at Sandbox creation:

| Env Var | Value | Sensitive? |
|---------|-------|------------|
| `ARTIFACTS_URL` | Session repo Git URL | No |
| `ARTIFACTS_TOKEN` | Short-lived write token | **Yes** — scoped to single repo |
| `WORKER_RELAY_URL` | `https://worker/relay` | No |
| `PROGRESS_URL` | `https://worker/progress/:id` | No |
| `FINALIZE_URL` | `https://worker/finalize/:id` | No |
| `SESSION_ID` | UUID | No |
| `REPO_OWNER` | GitHub owner | No |
| `REPO_NAME` | GitHub repo name | No |
| `GITHUB_BRANCH` | `kimiflare/remote/<id>` | No |
| `PROMPT` | User prompt | No |
| `MODEL` | Model ID | No |
| `MAX_TURNS` | Max iterations | No |
| `REASONING_EFFORT` | low/medium/high | No |

**Notably absent:** `CF_API_TOKEN` (Workers AI token) and `GITHUB_TOKEN` (GitHub PAT). These never enter the Sandbox.

### 6.3 GitHub Token

- Held only by the Worker (in DO storage, encrypted at rest).
- Used exclusively in the finalize step: `git push` to GitHub + `POST /repos/{owner}/{repo}/pulls`.
- Never logged, never sent to client, never injected into Sandbox.

### 6.4 Workers AI Token

- Held only by the Worker.
- The `/relay` endpoint attaches it to the outgoing Workers AI request.
- The Sandbox agent sends `{ model, messages, tools }` to `/relay`; the Worker adds auth and forwards.
- The Worker can enforce per-session rate limits and max-spend here.

### 6.5 Artifacts Write Token

- Minted by Worker via Artifacts binding.
- Scoped to a single repo (`kf-<sessionId>`).
- Lifetime: 24 hours.
- Injected into Sandbox env for `git push`.
- If leaked, attacker can only push to the session repo (which is deleted after 7 days anyway).

---

## 7. GitHub Integration

### 7.1 Repo Identification

At `/remote` invocation:
1. Local CLI runs `git remote get-url origin` in `process.cwd()`.
2. Parses URL to extract `owner/repo` (supports HTTPS and SSH formats).
3. If parsing fails, prompts user to enter `owner/repo` manually.
4. Caches result in local config (`githubRepo: "owner/repo"`) for future sessions.

**BYOK vs Managed Cloud:**
- BYOK: User's local CLI inspects their local git repo. Worker URL is configurable (`remoteWorkerUrl` in config).
- Managed Cloud: Same flow, but `remoteWorkerUrl` points to our hosted Worker.

### 7.2 Branch Naming Convention

```
kimiflare/remote/<sessionId>
```

- Prefix `kimiflare/remote/` makes it easy to identify and filter.
- `sessionId` is the UUID, ensuring uniqueness.
- Example: `kimiflare/remote/a1b2c3d4-e5f6-7890-abcd-ef1234567890`

### 7.3 How Commits Land on GitHub

**Worker pushes after agent finishes (not agent directly).**

Rationale:
- The GitHub token never enters the Sandbox.
- The Worker can handle push failures (retry, fallback, notify user).
- The Worker can rewrite the branch (e.g., squash commits) before pushing.
- If push fails, the work is not lost — it's still in the Artifacts repo.

**Flow:**
1. Agent finishes, commits final changes to Artifacts repo.
2. Agent POSTs `/finalize/:sessionId`.
3. Worker clones the Artifacts repo (or uses a local copy), checks out the session branch.
4. Worker force-pushes the branch to GitHub: `git push --force-with-lease origin kimiflare/remote/<sessionId>`.
5. Worker opens PR via GitHub API.

### 7.4 PR Body Template

```markdown
## 🤖 Kimiflare Remote Session

**Session ID:** `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
**Prompt:**
> Add OAuth device flow authentication to the CLI

**Summary:**
- Added `src/auth/github.ts` with device flow implementation
- Updated `src/config.ts` to store GitHub tokens
- Added `kimiflare auth github` subcommand
- All changes include tests

**Commits:** 12
**Turns:** 23 / 50
**Tokens used:** ~45,000
**Status:** ✅ Completed

**View live log:** [Session status page](https://worker.example.com/remote/web/a1b2c3d4-e5f6-7890-abcd-ef1234567890)

---
*This PR was generated by [kimiflare](https://github.com/sinameraji/kimiflare) in remote mode.*
```

---

## 8. Local CLI Changes

### 8.1 The `/remote` Command

**In TUI (`src/app.tsx`):**

```ts
if (c === "/remote") {
  if (!cfg?.remoteWorkerUrl) {
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "remote worker not configured. Set remoteWorkerUrl in config." }]);
    return true;
  }
  if (!arg) {
    // Open prompt collector (similar to /init)
    setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "Enter your remote prompt:" }]);
    // User types prompt, hits enter
    // → calls startRemoteSession(prompt)
    return true;
  }
  // /remote status, /remote cancel handled by subcommands
  return true;
}
```

**Subcommands (`src/index.tsx` via Commander):**

```ts
program
  .command("remote")
  .description("Manage remote sessions")
  .addCommand(
    new Command("list")
      .description("List remote sessions")
      .action(async () => { /* ... */ })
  )
  .addCommand(
    new Command("status")
      .description("Show remote session status")
      .argument("[session-id]", "Session ID (defaults to most recent)")
      .action(async (sessionId) => { /* ... */ })
  )
  .addCommand(
    new Command("cancel")
      .description("Cancel a remote session")
      .argument("<session-id>", "Session ID")
      .action(async (sessionId) => { /* ... */ })
  )
  .addCommand(
    new Command("auth")
      .description("Authenticate with GitHub")
      .addCommand(
        new Command("github")
          .description("Authenticate via OAuth device flow")
          .action(async () => { /* ... */ })
      )
  );
```

### 8.2 Status Streaming

When the user types `/remote <prompt>`:
1. CLI POSTs to Worker `/remote/start`.
2. Worker returns `{ sessionId, streamUrl }`.
3. CLI opens SSE connection to `streamUrl`.
4. CLI renders a simplified stream:
   - No diff modals, no permission prompts.
   - Shows: turn number, current action, tool calls, token usage.
   - Similar to `tail -f` but structured.

**Rendering example:**
```
🚀 Remote session a1b2c3d4 started
   Repo: sinameraji/kimiflare
   Branch: kimiflare/remote/a1b2c3d4

Turn 1/50  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  0 tokens
  → read README.md
  → read package.json

Turn 2/50  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  1,234 tokens
  → write src/auth/github.ts
  → bash npm run typecheck

...

✅ Done — PR opened: https://github.com/sinameraji/kimiflare/pull/123
```

### 8.3 Detach Behavior

- User closes laptop → SSE connection drops.
- Worker continues running the session (DO + Sandbox are independent of CLI connection).
- User reopens terminal, runs `kimiflare remote status` (no ID needed — defaults to most recent).
- CLI fetches current state from Worker and prints summary.
- If session is still running, CLI can re-open the SSE stream at the current position (Worker supports `Last-Event-ID` for replay).

### 8.4 Local Session Persistence

Remote sessions are stored in `~/.config/kimiflare/remote/`:

```ts
interface RemoteSessionFile {
  sessionId: string;
  prompt: string;
  repo: string;  // "owner/repo"
  workerUrl: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  branch?: string;
  prUrl?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}
```

---

## 9. Failure Modes and Recovery

### 9.1 Sandbox Crashes Mid-Task

**Detection:** Worker stops receiving stdout from Sandbox. DO idle timeout alarm fires.

**Recovery:**
1. Worker sets status="error".
2. Worker attempts to restart the Sandbox with the same `sessionId`.
3. On restart, the agent process checks the Artifacts repo for existing commits.
4. If commits exist, agent resumes from the last commit (replays the last turn's context from the DO).
5. If resumption fails, Worker notifies user with error message and Artifacts repo URL (work is not lost).

**Max retries:** 3. After 3 crashes, session is marked "error" and user is notified.

### 9.2 Agent Gets Stuck in a Loop

**Detection:**
- `maxToolIterations` (default 50) reached.
- `maxTokens` (default 1M) exceeded.
- Idle timeout (30 min with no output).
- DO alarm for max session duration (4 hours).

**Recovery:**
- Agent loop self-terminates, commits current work, calls `/finalize`.
- Worker opens PR with whatever work was completed.
- PR body notes: "Session terminated after N turns — work may be incomplete."

### 9.3 GitHub Push Fails

**Scenarios:**
- Token expired → Worker refreshes OAuth token (if using device flow) or reports error (if PAT).
- Branch conflict → Worker force-pushes (`--force-with-lease`) after warning.
- Network error → Retry with exponential backoff (3 attempts).
- Repo not found → Report error to user.

**Work preservation:** The Artifacts repo is durable. Even if GitHub push fails, the work exists in Artifacts. The user can manually pull from Artifacts or retry finalize.

### 9.4 User Cancels

**Flow:**
1. User runs `kimiflare remote cancel <sessionId>`.
2. CLI POSTs `/remote/cancel/:sessionId`.
3. Worker signals Sandbox to terminate (`sandbox.kill()` or `sandbox.exec("kill", [pid])`).
4. Worker sets status="cancelled".
5. Worker does NOT open a PR (unless user explicitly requests "cancel and save").

### 9.5 Worker Crash / DO Loss

**Mitigation:**
- DOs are backed by persistent storage. If the DO crashes, it recovers from storage on next request.
- SSE streams are re-establishable. CLI reconnects automatically.
- Sandbox continues running independently of Worker (it only needs the Worker for `/relay` and `/progress`). If Worker is down, Sandbox buffers progress events and retries.

---

## 10. Observability

### 10.1 Logging Strategy

| Layer | Destination | Contents |
|-------|-------------|----------|
| **Agent logs** | stdout (Sandbox) → Worker → DO storage | Every tool call, LLM request, commit, error. Stored in DO for 7 days. |
| **Worker logs** | Cloudflare Workers Logs | HTTP requests, session lifecycle, errors, token usage. |
| **Sandbox stdout** | Worker (via SDK) → DO storage | Raw NDJSON progress events. |

### 10.2 Debugging a Failed Session

**Developer (you) flow:**
1. Get `sessionId` from user or Worker logs.
2. Query DO directly: `wrangler d1 execute` or custom admin endpoint.
3. Retrieve stored progress events and agent logs from DO storage.
4. Check Artifacts repo: `git clone https://artifacts.cloudflare.com/.../kf-<sessionId>`.
5. Check Worker logs in Cloudflare dashboard.

**User flow:**
1. Run `kimiflare remote status <sessionId>` — shows error message and last known state.
2. Visit web status page — shows full event history.
3. If PR was opened, PR body links to session page.

### 10.3 Metrics

Worker emits metrics to Cloudflare Analytics (or optional external service):

- `remote_sessions_started_total`
- `remote_sessions_completed_total` (label: `status=done|error|cancelled`)
- `remote_session_duration_seconds` (histogram)
- `remote_turns_per_session` (histogram)
- `remote_tokens_per_session` (histogram)
- `relay_requests_total` (label: `model`, `status`)
- `sandbox_crashes_total` (label: `sessionId`)

---

## 11. Cost Model Per Session

### 11.1 Components

| Component | Unit | Rate | Typical Session |
|-----------|------|------|-----------------|
| **Sandbox CPU** | CPU-seconds | $0.0001 / CPU-s | 30 min × 1 CPU = 1,800s → $0.18 |
| **Sandbox Memory** | GB-seconds | $0.0001 / GB-s | 30 min × 2 GB = 3,600 GB-s → $0.36 |
| **Sandbox Egress** | GB | $0.09 / GB | ~0.1 GB (progress events) → $0.009 |
| **Artifacts Storage** | GB-month | $0.023 / GB-month | 0.1 GB × 7 days → ~$0.0005 |
| **Artifacts Ops** | Requests | $0.004 / 1,000 | ~500 requests → $0.002 |
| **Workers Invocations** | Requests | $0.50 / 1M | ~1,000 invocations → $0.0005 |
| **Workers AI (Kimi K2.6)** | Tokens | $0.95/M input, $4.00/M output | ~50K input + 20K output → $0.13 |
| **Durable Object** | Requests + Storage | $0.12/M requests, $0.12/GB-month | ~1,000 requests + negligible storage → $0.0001 |

### 11.2 Per-Session Estimate

**Typical session (30 min, 50K input tokens, 20K output tokens):**

| Cost Item | Amount |
|-----------|--------|
| Sandbox CPU | $0.18 |
| Sandbox Memory | $0.36 |
| Sandbox Egress | $0.01 |
| Artifacts | $0.00 |
| Workers | $0.00 |
| Workers AI | $0.13 |
| Durable Object | $0.00 |
| **Total** | **~$0.68** |

**Long session (2 hours, 200K input, 80K output):**

| Cost Item | Amount |
|-----------|--------|
| Sandbox CPU | $0.72 |
| Sandbox Memory | $1.44 |
| Sandbox Egress | $0.02 |
| Workers AI | $0.52 |
| **Total** | **~$2.70** |

### 11.3 Per-1,000-Sessions Estimate

| Scenario | Cost |
|----------|------|
| 1,000 typical sessions | **~$680** |
| 1,000 long sessions | **~$2,700** |

### 11.4 Cost Controls

- Per-session token budget (default 1M tokens).
- Per-session max duration (default 4 hours).
- Worker relay can enforce per-account daily spend limits.
- User-visible cost estimate before starting session: "Estimated cost: $0.50–$2.00".

---

## 12. Pre-Mortem

### 12.1 Failure 1: Sandbox Sleep Breaks Long-Running Agents

**Scenario:** Agent runs for 45 minutes. Sandbox sleeps during a long LLM inference. Agent process state is lost or corrupted on resume.

**Early signal:** Sessions consistently failing after ~30–40 minutes with "Sandbox disconnected" errors.

**Mitigation (build in v1):**
- Agent sends heartbeat every 60s while waiting for LLM response.
- Agent commits state to Artifacts repo after every turn (not just every batch).
- On restart, agent reads last commit from Artifacts and resumes from there.
- DO tracks "last known good turn" and can inject it into restarted agent.

### 12.2 Failure 2: Worker Relay Becomes Bottleneck at Scale

**Scenario:** `/parallel N` launches 10 Sandboxes. All 10 stream LLM requests through the single Worker relay. Worker hits CPU/memory limits, causing latency spikes and dropped SSE connections.

**Early signal:** Relay response times increase linearly with active sessions. P99 latency > 5s.

**Mitigation (build in v1):**
- Relay endpoint is stateless — can scale horizontally across multiple Worker instances.
- Use Cloudflare AI Gateway for caching and rate limiting (reduces duplicate requests).
- Stream relay responses directly (don't buffer in Worker).
- If relay is overloaded, return 429 to Sandbox; Sandbox retries with backoff.

### 12.3 Failure 3: GitHub OAuth Token Refresh Fails Mid-Session

**Scenario:** Session runs for 6 hours. OAuth access token expires after 8 hours, but refresh token is invalid (user revoked access, or GitHub App was uninstalled). Finalize step fails to push branch or open PR.

**Early signal:** High rate of "finalize failed: 401 Unauthorized" errors in Worker logs.

**Mitigation (build in v1):**
- Worker validates GitHub token at session start (quick API call to `/user`).
- If token expires during session, Worker attempts refresh once. If refresh fails, Worker:
  - Keeps the Artifacts repo alive (work is not lost).
  - Notifies user via CLI and web page: "Session complete, but PR creation failed. Token expired. Run `kimiflare remote auth github` to refresh, then `kimiflare remote finalize <sessionId>` to retry."
- Store refresh token in DO (encrypted) so retry doesn't require user intervention.

---

## 13. Phased Implementation Plan

### Phase 0: Spike — Validate Cloudflare APIs (1 day)

**Goal:** Confirm the Artifacts binding, Sandbox SDK, and DO SSE streaming work as expected before building the full system.

**Files/modules:**
- `remote/spike/` (temporary directory, deleted after spike)

**New dependencies:**
- `wrangler` (dev dependency for Worker deployment)
- `@cloudflare/artifacts` (if there's a types package)
- `@cloudflare/sandbox` (if there's a types package)

**Acceptance criteria:**
- [ ] Worker script deployed to `*.workers.dev`.
- [ ] Worker creates an Artifacts repo via binding.
- [ ] Worker creates a Sandbox, runs `echo "hello"`, and captures stdout.
- [ ] Worker streams 10 SSE events to a `curl` client.
- [ ] Document any API mismatches or gotchas.

---

### Phase 1: End-to-End Pipe — Hello World PR (1–2 days)

**Goal:** The smallest slice that produces a real PR on GitHub. The agent inside the Sandbox just runs `echo "hello" >> README.md && git commit && git push`.

**Files/modules created:**
- `remote/worker/` — Orchestrator Worker
  - `src/index.ts` — Hono or raw fetch handler, routes
  - `src/session-do.ts` — Durable Object class
  - `src/github.ts` — GitHub API client (push branch, open PR)
  - `src/artifacts.ts` — Artifacts binding wrapper
  - `src/sandbox.ts` — Sandbox binding wrapper
  - `wrangler.toml`
- `remote/agent/` — Headless agent (minimal)
  - `src/remote-agent.ts` — Entrypoint: clone repo, run hardcoded bash, commit, call finalize
- `remote/Dockerfile` — Container image

**Files/modules touched:**
- `src/commands/builtins.ts` — Add `/remote` to built-ins
- `src/app.tsx` — Add `/remote` handler (prompt collector, call Worker)
- `src/config.ts` — Add `remoteWorkerUrl`, `githubToken` fields

**New dependencies:**
- `hono` (Worker HTTP framework, optional)
- `octokit` (GitHub API client, optional — can use raw fetch)

**Acceptance criteria:**
- [ ] User types `/remote test prompt` in local TUI.
- [ ] CLI calls Worker, gets session ID and SSE URL.
- [ ] Worker creates Artifacts repo, creates Sandbox, starts agent.
- [ ] Agent clones repo, modifies README.md, commits, calls `/finalize`.
- [ ] Worker pushes branch to GitHub and opens a PR.
- [ ] CLI shows progress stream and final "PR opened" message.

---

### Phase 2: Real Agent Loop in Sandbox (1–2 days)

**Goal:** Replace the hardcoded bash script with the actual kimiflare agent loop (`runAgentTurn`).

**Files/modules created:**
- `remote/agent/src/agent-loop.ts` — Headless wrapper around `runAgentTurn`
- `remote/agent/src/progress-reporter.ts` — Serializes `AgentCallbacks` to NDJSON
- `remote/agent/src/headless-permission.ts` — `PermissionAsker` that always returns `"allow"`

**Files/modules touched:**
- `src/agent/loop.ts` — Ensure it can run without TUI (it already can, but verify)
- `src/tools/executor.ts` — No changes expected
- `remote/agent/src/remote-agent.ts` — Integrate real agent loop

**Acceptance criteria:**
- [ ] Agent inside Sandbox receives a real prompt (e.g., "Add a comment to README.md").
- [ ] Agent calls LLM via Worker relay.
- [ ] Agent executes tools (read, write, bash) on `/workspace`.
- [ ] Agent commits after each tool batch.
- [ ] Progress events stream to CLI in real-time.
- [ ] Session completes and opens PR with actual changes.

---

### Phase 3: Worker Relay + Progress Streaming (1 day)

**Goal:** Implement the LLM relay and robust progress streaming.

**Files/modules created/touched:**
- `remote/worker/src/relay.ts` — `/relay` endpoint
- `remote/worker/src/progress.ts` — `/progress/:sessionId` endpoint
- `remote/worker/src/stream.ts` — SSE stream management in DO

**Acceptance criteria:**
- [ ] Sandbox agent calls `/relay` for LLM inference; Worker forwards to Workers AI.
- [ ] Worker streams LLM response back to Sandbox without buffering.
- [ ] Sandbox agent posts progress events to `/progress`.
- [ ] Worker relays progress events to CLI SSE stream.
- [ ] CLI can disconnect and reconnect without losing events (Last-Event-ID support).

---

### Phase 4: GitHub OAuth + Local CLI Subcommands (1–2 days)

**Goal:** Replace PAT with OAuth device flow and add CLI subcommands.

**Files/modules created:**
- `src/auth/github.ts` — OAuth device flow implementation
- `src/remote/cli.ts` — `kimiflare remote list|status|cancel` subcommands
- `src/remote/session-store.ts` — Local remote session persistence

**Files/modules touched:**
- `src/index.tsx` — Add `remote` subcommand group
- `src/config.ts` — Add `githubOAuthToken`, `githubRefreshToken`, `githubTokenExpiry` fields

**Acceptance criteria:**
- [ ] `kimiflare auth github` initiates device flow.
- [ ] User completes auth in browser; CLI stores tokens.
- [ ] `kimiflare remote list` shows active/completed sessions.
- [ ] `kimiflare remote status` shows most recent session (no ID needed).
- [ ] `kimiflare remote cancel <id>` cancels a running session.

---

### Phase 5: Baseline Repo + Auto-Setup (1 day)

**Goal:** Add persistent baseline repo and auto-setup for project dependencies.

**Files/modules created/touched:**
- `remote/worker/src/baseline.ts` — Baseline repo sync logic
- `remote/agent/src/setup.ts` — Auto-detect project type and run setup

**Acceptance criteria:**
- [ ] Worker maintains a baseline repo per GitHub repo.
- [ ] New sessions copy from baseline instead of cloning GitHub.
- [ ] Sandbox agent detects `package.json` → runs `npm install`.
- [ ] Sandbox agent detects `Cargo.toml` → runs `cargo fetch`.
- [ ] Sandbox agent detects `requirements.txt` → runs `pip install`.

---

### Phase 6: Web Status Page + Polish (1 day)

**Goal:** Add the web status page and final polish.

**Files/modules created:**
- `remote/worker/src/web.html` — Static HTML status page (embedded in Worker)
- `remote/worker/src/web.ts` — `/remote/web/:sessionId` endpoint

**Files/modules touched:**
- `src/app.tsx` — Add `/remote` picker in TUI (like `/resume`)
- `src/ui/remote-status.tsx` — Remote session status component

**Acceptance criteria:**
- [ ] `https://worker.example.com/remote/web/<sessionId>` shows live status.
- [ ] Page works on mobile.
- [ ] Page auto-refreshes (SSE or polling fallback).
- [ ] PR body links to status page.
- [ ] TUI `/remote` with no args opens session picker.

---

### Phase 7: Failure Recovery + Observability (1 day)

**Goal:** Add retries, crash recovery, and logging.

**Files/modules created/touched:**
- `remote/worker/src/recovery.ts` — Sandbox restart and resume logic
- `remote/worker/src/alarms.ts` — DO alarms for timeouts
- `remote/worker/src/metrics.ts` — Analytics metrics emission

**Acceptance criteria:**
- [ ] Sandbox crash triggers automatic restart (up to 3 retries).
- [ ] Agent resumes from last commit after restart.
- [ ] Max session duration alarm (4h) terminates stuck sessions.
- [ ] Idle timeout alarm (30m) terminates frozen sessions.
- [ ] Worker logs include session lifecycle events.
- [ ] Metrics dashboard shows sessions started/completed/failed.

---

### Phase 8: `/parallel` Foundation (1 day)

**Goal:** Ensure the architecture supports multiple concurrent sessions without single-instance assumptions.

**Files/modules touched:**
- `remote/worker/src/session-do.ts` — Verify DO isolation
- `remote/worker/src/parallel.ts` — Batch session creation endpoint

**Acceptance criteria:**
- [ ] Worker can create 5 sessions simultaneously.
- [ ] Each session gets its own DO, Sandbox, and Artifacts repo.
- [ ] Progress streams are independent.
- [ ] Baseline repo is copied to all 5 sessions efficiently.
- [ ] No shared mutable state between sessions.

---

### Total Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 0. Spike | 1 day | 1 day |
| 1. Hello World PR | 1–2 days | 2–3 days |
| 2. Real Agent Loop | 1–2 days | 3–5 days |
| 3. Relay + Streaming | 1 day | 4–6 days |
| 4. OAuth + CLI | 1–2 days | 5–8 days |
| 5. Baseline + Auto-Setup | 1 day | 6–9 days |
| 6. Web Page + Polish | 1 day | 7–10 days |
| 7. Recovery + Observability | 1 day | 8–11 days |
| 8. `/parallel` Foundation | 1 day | 9–12 days |

**Estimated total: 2–2.5 weeks** for one developer working full-time.

---

## Appendix A: Directory Structure

```
kimiflare/
├── src/                          # Existing local CLI
│   ├── agent/
│   ├── tools/
│   ├── ui/
│   ├── auth/
│   │   └── github.ts             # NEW: OAuth device flow
│   ├── remote/
│   │   ├── cli.ts                # NEW: remote subcommands
│   │   ├── session-store.ts      # NEW: local session persistence
│   │   └── worker-client.ts      # NEW: HTTP client for Worker
│   ├── commands/builtins.ts      # MODIFIED: add /remote
│   ├── app.tsx                   # MODIFIED: add /remote handler
│   ├── config.ts                 # MODIFIED: add remote fields
│   └── index.tsx                 # MODIFIED: add remote subcommands
├── remote/                       # NEW: Cloudflare infrastructure
│   ├── worker/
│   │   ├── src/
│   │   │   ├── index.ts          # fetch handler / router
│   │   │   ├── session-do.ts     # Durable Object
│   │   │   ├── github.ts         # GitHub API client
│   │   │   ├── artifacts.ts      # Artifacts binding wrapper
│   │   │   ├── sandbox.ts        # Sandbox binding wrapper
│   │   │   ├── relay.ts          # LLM relay endpoint
│   │   │   ├── progress.ts       # Progress ingestion
│   │   │   ├── stream.ts         # SSE stream management
│   │   │   ├── baseline.ts       # Baseline repo sync
│   │   │   ├── recovery.ts       # Crash recovery
│   │   │   ├── alarms.ts         # DO alarms
│   │   │   ├── metrics.ts        # Analytics
│   │   │   └── web.ts            # Web status page
│   │   ├── wrangler.toml
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── agent/
│   │   ├── src/
│   │   │   ├── remote-agent.ts   # Entrypoint
│   │   │   ├── agent-loop.ts     # Headless runAgentTurn wrapper
│   │   │   ├── progress-reporter.ts
│   │   │   ├── headless-permission.ts
│   │   │   └── setup.ts          # Auto-setup detection
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── Dockerfile                # Sandbox container image
├── docs/
│   ├── remote-architecture.md    # This document
│   └── remote-feature-findings-and-decisions.md
├── package.json                  # MODIFIED: add build:remote script
└── tsup.config.ts                # Unchanged
```

---

## Appendix B: Config Schema Additions

```ts
// src/config.ts
export interface KimiConfig {
  // ... existing fields ...

  // Remote feature
  remoteWorkerUrl?: string;
  remoteEnabled?: boolean;

  // GitHub auth (OAuth device flow)
  githubOAuthToken?: string;
  githubRefreshToken?: string;
  githubTokenExpiry?: number;  // Unix timestamp

  // GitHub repo (auto-detected, cached)
  githubRepo?: string;  // "owner/repo"
}
```

**Environment variable overrides:**
- `KIMIFLARE_REMOTE_WORKER_URL`
- `KIMIFLARE_GITHUB_REPO`
- `KIMIFLARE_REMOTE_ENABLED`

---

*Document version: 1.0*  
*Last updated: 2026-05-03*
