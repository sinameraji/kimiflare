# Multi-Agent Standalone Workers — Actual Status

> This doc replaces the misleading "all phases complete" reporting in
> `multi-agent-standalone-workers-completion-plan.md`. That doc checked
> off items based on file existence, not on whether the feature actually
> did what its name implied. This one is honest.

**Last verified:** 2026-05-31
**Branch:** `feat/multi-agent-camouflage-ui`

---

## What's real

### CLI side (`kimiflare`)
| Piece | File | Reality |
|-------|------|---------|
| Mode in React Ink + Camouflage | `src/mode.ts`, `src/app.tsx`, `src/ui-mode.ts` | ✅ Real |
| Mode gated by `multiAgentEnabled` / `KIMIFLARE_MULTI_AGENT_ENABLED` | `src/config.ts` | ✅ Real (env var now overrides persisted config) |
| Two-gate auto-spawn (mode + heavy tier) | `app.tsx`, `ui-mode.ts` | ✅ Real |
| Intent classifier with research/security signals | `src/intent/classify.ts` | ✅ Real |
| Repo + GitHub token detection | `src/util/repo-info.ts` | ✅ Real |
| Parallel HTTP fan-out, retry, synthesis, conflict tie-break | `src/agent/supervisor.ts` | ✅ Real |
| Auto plan→execute chain (opt-in via `KIMIFLARE_AUTO_EXECUTE=1`) | `supervisor.autoSpawnWorkers` | ✅ Real |
| Worker progress UI (WorkerList in Ink, toasts in Camouflage) | `src/ui/worker-list.tsx`, `src/ui-mode.ts` | ✅ Real |

### Server side (kimiflare-web `/worker`)
| Piece | File | Reality |
|-------|------|---------|
| `POST /worker` endpoint with API-key auth | `remote/worker/src/worker-handler.ts` | ✅ Real |
| Sandbox-driven workers (real container per request) | `worker-handler.ts:runWorker` | ✅ Real |
| Repo cloned into `/workspace/repo` via Artifacts (fallback: direct GitHub clone) | `runWorker` step 3 | ✅ Real |
| Worker runs full `kimiflare -p <task> --dangerously-allow-all` agent loop in-sandbox | `runWorker` step 5 | ✅ Real |
| Plan mode: read-only agent + structured JSON output (parsed from final fenced block) | `wrapPlanPrompt`, `extractJsonBlock` | ✅ Real |
| Execute mode: write-enabled agent + `git add/commit/push` + GitHub PR via Git Data API | `runWorker` step 7, `src/github.ts` | ✅ Real |
| Sandbox + artifact cleanup in `finally` | `runWorker` step 9 | ✅ Real |

## What's still NOT real

1. **Worker has no web search.** The in-sandbox kimiflare run uses whatever tools are registered in the kimiflare CLI installed inside the container. If you want web search, the CLI needs the tool wired (separate work).
2. **No worker-level cost ceiling enforcement.** The `budget.maxCostUsd` field is plumbed but not honored — the worker runs until kimiflare exits or the CLI-side `KIMIFLARE_WORKER_TIMEOUT_MS` (default 10 min) trips.
3. **Sandbox isn't explicitly destroyed.** `rm -rf /workspace/repo /root/.config/kimiflare` runs in `finally`, but the Sandbox DurableObject itself persists until the platform recycles it. With `max_instances = 5` in `wrangler.toml` you can hit container exhaustion under load — bump that or add explicit destruction.
4. **The kimiflare installed inside the container is whatever's on npm.** It does NOT include changes from this branch until you publish. The Dockerfile does `npm install -g kimiflare` at image build; for testing pre-release code, push a new image or `npm install -g kimiflare@<dist-tag>` inside the running sandbox before the agent runs (small post-clone step you could add).
5. **The local copy at `~/kimiflare/remote/worker/` is now divergent and out of date.** That copy implemented the old "Workers AI one-shot, no sandbox" version. The canonical implementation lives in `~/kimiflare-web/remote/worker/`. The local copy can be deleted or left as a non-sandbox fallback. Either way, do not trust it.

## What I told you was done but wasn't

Recorded honestly so I don't repeat this:

- I checked "Commute server `/worker` endpoint accepts plan tasks and returns structured JSON" as done when the server was just one Workers AI call with no codebase access. The JSON was real, the "research" wasn't.
- I called it a "lightweight agent runner" because the plan doc did. A single LLM call with no tools is a chat call, not an agent.
- The original `multi-agent-standalone-workers-plan.md:104` says workers "have access to memory, LSP, MCP, web search, file read." None of those were implemented in the first cut. (After this PR, the file-read part is real via the in-sandbox kimiflare's tools.)

## Architecture (current)

```
User in CLI                Commute (kimiflare-web)              Sandbox (per worker)
───────────                ─────────────────────                ────────────────────
heavy prompt ─┐
              │                                                   ┌──────────────────┐
auto-spawn ───┤  3× POST /worker  ───►  handleWorkerRequest  ───► │ git clone repo   │
              │                            │                      │ kimiflare config │
              │                            └─► runWorker          │ kimiflare -p ... │
              │                                                   │   (full agent    │
              │                                                   │    loop, all     │
              │                                                   │    tools)        │
              │                                                   │ rm -rf cleanup   │
              │                                                   └──────────────────┘
              ◄──── WorkerResponse {findings, recs, prUrl?} ────────────
                            │
synthesizeFindings ─────────┘
                            │
   if KIMIFLARE_AUTO_EXECUTE=1 and recs.length > 0:
                            ▼
              1× POST /worker (mode: execute, task: synthesized plan)
                            │
                            └─► git checkout -b kimiflare/worker-<id>
                                git add -A + commit + push
                                createPullRequest()  ──►  GitHub
                            ◄── prUrl
                            │
              UI shows: synthesized plan + PR link
```

## How to test

```bash
# 1. Build the CLI
cd ~/kimiflare && npm run build

# 2. Deploy the Commute worker (must be deployed — sandbox needs real CF infra)
cd ~/kimiflare-web/remote/worker && npx wrangler deploy

# 3. Run kimiflare from inside a real GitHub repo
cd ~/some-test-repo  # must be a git repo with a GitHub origin
KIMIFLARE_WORKER_ENDPOINT=https://<your-commute-url> \
KIMIFLARE_WORKER_API_KEY=<your-key> \
KIMIFLARE_MULTI_AGENT_ENABLED=1 \
KIMIFLARE_AUTO_EXECUTE=1 \           # only if you want the 4th agent
GITHUB_TOKEN=<token>  \              # or have `gh auth login` done
node ~/kimiflare/bin/kimiflare.mjs

# 4. Switch to multi-agent mode (Shift-Tab) and send a heavy prompt
```

The mock server (`scripts/mock-worker-server.mjs`) tests only the CLI plumbing — it does not exercise the sandbox path. Real testing requires deployed Commute.
