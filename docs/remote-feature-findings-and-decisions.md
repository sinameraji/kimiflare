# `/remote` Feature — Codebase Findings & Design Decisions

> Research and planning deliverable. No implementation code yet.

---

## 1. Codebase Findings

### 1.1 Current Agent Loop

**Files:** `src/agent/loop.ts`, `src/agent/orchestrator.ts`, `src/agent/agent-session.ts`

The agent loop is **well-factored and largely reusable** for a headless remote variant.

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
  if (arg === "off") { /* ... */ }
  void getCostReport(sessionIdRef.current ?? undefined)
    .then(async (report) => { /* ... */ })
    .catch((err) => { /* ... */ });
  return true;
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

## 2. Design Decisions Needed

Below are the genuine choices where the codebase provides no answer and your judgment is required. Each has 2–3 options with tradeoffs and my recommendation.

---

### Decision 1: GitHub Authentication Model

`/remote` must push a branch and open a PR. How does the user authenticate kimiflare against their GitHub repo?

**Option A — Personal Access Token (PAT)**
- User generates a fine-grained PAT (or classic PAT) with `contents:write` and `pull_requests:write` scopes.
- Stores it in `~/.config/kimiflare/config.json` as `githubToken` (or env `KIMIFLARE_GITHUB_TOKEN`).
- The local CLI sends it to the Worker on session start. The Worker holds it and uses it for push + PR creation.
- **Pros:** Simplest to implement, no hosted infrastructure, works for BYOK immediately.
- **Cons:** Token has broad scope; if leaked, attacker has write access to all repos the token can access. User must manually rotate.

**Option B — GitHub App**
- We (or the user) create a GitHub App. User installs it on their repo.
- The App gives us an installation token with scoped permissions.
- **Pros:** Fine-grained per-repo permissions, no long-lived PAT, org-friendly.
- **Cons:** Requires a GitHub App creation flow (either we host one or users create their own). For BYOK self-hosters, creating a GitHub App is a significant onboarding hurdle. Adds OAuth/App authentication logic to the Worker.

**Option C — OAuth Device Flow**
- User runs `kimiflare auth github`, gets a device code, completes auth in browser.
- GitHub returns a short-lived access token + refresh token.
- **Pros:** Best UX, no manual token copying, standard GitHub flow.
- **Cons:** Requires a hosted OAuth callback endpoint (or device flow support). For BYOK, the user would need to set up a GitHub OAuth App. Adds the most complexity to v1.

**My recommendation:** Option A (PAT) for v1. It unblocks the entire feature with a single config field. We can add Option B (GitHub App) in v2 for orgs and managed-cloud users. Option C is overkill until we have a hosted service.

**Your pick?**

---

### Decision 2: Sandbox → Workers AI Inference Path

The agent running inside the Cloudflare Sandbox needs to call Kimi K2.6 on Workers AI. How?

**Option A — Direct HTTP from Sandbox to Workers AI**
- The Worker mints a short-lived Workers AI API token and injects it into the Sandbox as an env var (`CF_API_TOKEN`).
- The agent inside the Sandbox makes HTTPS calls directly to `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/{model}`.
- **Pros:** Simplest, no relay latency, Sandbox egress proxy can control outbound domains.
- **Cons:** The API token is visible to the agent process inside the Sandbox. A malicious prompt could exfiltrate it (though the Sandbox egress proxy can block non-CF domains).

**Option B — Relay through the Orchestrator Worker**
- The Sandbox agent streams LLM requests to a `/relay` endpoint on the orchestrator Worker.
- The Worker holds the real API token, forwards the request to Workers AI, and streams the response back.
- **Pros:** API token never enters the Sandbox. The Worker can enforce rate limits, logging, and request inspection.
- **Cons:** Adds ~20–50ms latency per request. The Worker becomes a bandwidth bottleneck for large streaming responses. More complex — needs a streaming relay implementation.

**Option C — Workers AI Binding via Sandbox SDK Egress Proxy**
- Use the Sandbox SDK's egress proxy / credential injection feature to transparently route Workers AI calls without exposing the token to the agent process.
- **Pros:** Best of both worlds — token is hidden, no relay latency.
- **Cons:** Depends on the exact Sandbox SDK surface. From the docs, the Sandbox SDK supports environment variable injection and egress proxying, but it's unclear if it supports transparent credential injection for arbitrary HTTP headers. May require experimentation.

**My recommendation:** Option A for v1, with egress proxy locked to `api.cloudflare.com` only. The token is scoped to Workers AI (not the user's Cloudflare account broadly) and can be rotated easily. Option B adds too much complexity and cost for v1. Option C is the ideal end state but needs a spike to validate.

**Your pick?**

---

### Decision 3: Container Image Strategy

What runs inside the Sandbox? The agent needs Node.js, git, and likely Python/build tools for the repos it will edit.

**Option A — Fixed Universal Image**
- A single `kimiflare/remote-agent` image based on `node:20-slim` (or `ubuntu:22.04` + Node).
- Pre-installs: `node`, `npm`, `git`, `python3`, `make`, `gcc`, `g++`, `curl`, `jq`.
- The kimiflare source is baked into the image at build time (or fetched from npm/GitHub at Sandbox startup).
- **Pros:** Fast startup (image is cached), predictable, no per-repo configuration.
- **Cons:** Bloated (~500MB–1GB), may lack project-specific dependencies (e.g., Rust toolchain, specific Python versions).

**Option B — Project-Specific Dockerfile**
- User can place a `Dockerfile.remote` (or similar) in their repo root.
- The Worker builds or references this image for the Sandbox.
- **Pros:** Perfect dependency match for the project.
- **Cons:** Slower startup (build step or large custom image pull), massive support burden (users will write broken Dockerfiles), adds complexity to the Worker (image registry management).

**Option C — Hybrid: Fixed Base + Runtime Install**
- Fixed base image with Node + git + common tools.
- At Sandbox startup, run a user-provided setup script (e.g., `.kimiflare/remote-setup.sh`) to install additional deps.
- **Pros:** Faster than full custom image, more flexible than fixed.
- **Cons:** Setup script runs on every session startup (slow), still requires user to write scripts.

**My recommendation:** Option A for v1. The image should be based on `node:20-bookworm` (Debian-based, more build tools available than `-slim`) and include a pre-built kimiflare agent binary. For v2, we can add a `remote.setupScript` config option for lightweight customization.

**Your pick?**

---

### Decision 4: Baseline Repo Strategy (Artifacts)

For each `/remote` session, we need a Git repo in Artifacts that contains the user's code. How do we get it there?

**Option A — Persistent Baseline + Per-Session Fork**
- Maintain a single baseline Artifacts repo (e.g., `kimiflare-baseline-{owner}-{repo}`) that mirrors the user's GitHub `main`.
- The Worker updates the baseline periodically (or on demand) by cloning from GitHub.
- For each session, the Worker "forks" the baseline into a new Artifacts repo (or creates a new repo and pushes the baseline's contents).
- **Pros:** Very fast session startup (no GitHub clone bandwidth), bandwidth-efficient.
- **Cons:** Adds baseline lifecycle complexity (when to update? what if main diverges during a session?). Artifacts "fork" behavior needs validation — the docs mention repo creation but not explicit fork semantics.

**Option B — Fresh Clone Per Session**
- For each session, the Worker creates a new empty Artifacts repo and runs `git clone --depth 1 https://github.com/{owner}/{repo}.git` inside the Sandbox (or Worker) into it.
- **Pros:** Simplest, always up-to-date with `main`, no baseline to maintain.
- **Cons:** Slower session startup (clones entire repo from GitHub each time), uses more GitHub bandwidth, Artifacts storage grows faster.

**Option C — Shallow Clone + Reference**
- Create a new Artifacts repo per session, but do a shallow clone (`--depth 1`) from GitHub directly into the Sandbox's `/workspace`, then push to the session's Artifacts repo.
- **Pros:** Reasonable middle ground.
- **Cons:** Still clones from GitHub every session.

**My recommendation:** Option B for v1. It is the simplest and most reliable. The baseline optimization (Option A) is premature — we don't know typical repo sizes yet. If repos are large, we can add baseline caching in v2 without changing the architecture.

**Your pick?**

---

### Decision 5: Local CLI Detach / Reattach UX

After typing `/remote <prompt>`, the user sees a status stream. They close their laptop. Later, they want to know what happened.

**Option A — Subcommand Only (`kimiflare remote status|cancel|list`)**
- Add `kimiflare remote <subcommand>` to the Commander CLI in `src/index.tsx`.
- `kimiflare remote list` — shows active/completed remote sessions.
- `kimiflare remote status <session-id>` — polls the Worker for current status and prints a summary.
- `kimiflare remote cancel <session-id>` — sends cancel signal.
- **Pros:** Clean separation from the TUI, works from any terminal, easy to script.
- **Cons:** User must remember the session ID or run `list` first.

**Option B — TUI Integration (`/remote status`)**
- Inside the running kimiflare TUI, `/remote` with no args opens a picker showing active remote sessions (like `/resume` shows past local sessions).
- Selecting one shows a live stream of its progress.
- **Pros:** Consistent with existing UX patterns (`/resume`, pickers).
- **Cons:** Only works while the TUI is running. If the user closed their terminal, they can't reattach via TUI.

**Option C — Both**
- TUI shows `/remote` picker for in-session discovery.
- Subcommands exist for out-of-band access.
- **Pros:** Best of both worlds.
- **Cons:** More code to write and maintain.

**My recommendation:** Option C, but implement Option A first (subcommands) because it's the only way to check status after closing the terminal. The TUI picker can be added in a later phase as a polish item.

**Your pick?**

---

## 3. What I Was Unable to Verify from Cloudflare Docs

I fetched the Artifacts and Sandbox overview pages, but the HTML-heavy docs site made deep extraction difficult. I was loop-detected before I could read:

- The exact Artifacts REST API for repo creation and token minting.
- The Sandbox SDK TypeScript API surface for `exec()`, file operations, and environment variable injection.
- Whether Artifacts supports true "fork" semantics or only repo creation + push.
- The Sandbox egress proxy configuration details.

**Mitigation:** Your architecture description in the prompt is detailed and I will treat it as the source of truth for API surfaces. During implementation, we will validate against the actual SDK types and docs. The phased plan (below, pending your answers) includes a "spike" phase for Worker + Sandbox + Artifacts integration to surface any API mismatches early.

---

## Next Step

Please reply with your picks for Decisions 1–5 (or just the ones you care about — I have defaults for all). I will then produce the full architecture document (11 sections) and the phased implementation plan.
