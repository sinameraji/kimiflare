# kimiflare `/remote` Feature

Run autonomous coding tasks on Cloudflare infrastructure. The agent works in a Sandbox container, commits to an Artifacts repo, and opens a PR on GitHub when done.

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────┐
│ Local CLI   │────▶│ Orchestrator    │────▶│ Artifacts       │◀────│ Sandbox     │
│ (kimiflare) │◀────│ Worker (DO)     │     │ (Git server)    │────▶│ Container   │
└─────────────┘     └─────────────────┘     └─────────────────┘     └─────────────┘
                           │                                               │
                           ▼                                               ▼
                    ┌─────────────┐                               ┌─────────────┐
                    │ GitHub API  │                               │ Workers AI  │
                    │ (PR, push)  │                               │ (LLM relay) │
                    └─────────────┘                               └─────────────┘
```

## Quick Start

### 1. Deploy the Worker

```bash
cd remote/worker
# Set secrets
wrangler secret put REMOTE_AUTH_SECRET
wrangler secret put CF_API_TOKEN
# Deploy
wrangler deploy
```

### 2. Build and push the container image

```bash
# Build the remote agent bundle
npm run build:remote-agent

# Build and push the Docker image
cd remote
docker build -t ghcr.io/sinameraji/kimiflare-remote-agent:latest .
docker push ghcr.io/sinameraji/kimiflare-remote-agent:latest
```

### 3. Configure the CLI

```bash
# Set your Worker URL
kimiflare config remoteWorkerUrl https://kimiflare-remote.your-account.workers.dev

# Authenticate with GitHub
kimiflare auth github

# Set shared secret (must match Worker secret)
kimiflare config remoteAuthSecret your-secret-here
```

### 4. Run a remote session

```bash
# In your project directory
kimiflare

# In the TUI
/remote Add OAuth device flow authentication
```

## Components

### `remote/worker/` — Orchestrator Worker

Cloudflare Worker with Durable Objects that manages:
- Session lifecycle
- Artifacts repo creation/deletion
- Sandbox creation/management
- GitHub API integration
- LLM relay (Workers AI)
- Progress streaming (SSE)

### `remote/agent/` — Headless Agent

Node.js application that runs inside the Sandbox:
- Clones the Artifacts repo
- Runs the kimiflare agent loop in headless mode
- Auto-approves all tool calls
- Commits after each tool batch
- Streams progress as NDJSON

### `src/remote/` — Local CLI Integration

- `worker-client.ts` — HTTP client for the Worker
- `session-store.ts` — Local session persistence
- `cli.ts` — `kimiflare remote list|status|cancel` subcommands

### `src/auth/github.ts` — GitHub OAuth

Device flow implementation for CLI authentication.

## Environment Variables

### Worker Secrets

| Secret | Description |
|--------|-------------|
| `REMOTE_AUTH_SECRET` | Shared secret for CLI → Worker auth |
| `CF_API_TOKEN` | Cloudflare API token for Workers AI relay |

### CLI Config

| Config Key | Description |
|------------|-------------|
| `remoteWorkerUrl` | URL of your deployed Worker |
| `remoteAuthSecret` | Shared secret (must match Worker) |
| `githubOAuthToken` | GitHub OAuth token (set via `kimiflare auth github`) |
| `githubRepo` | Cached repo identifier (`owner/repo`) |

## Development

### Local testing

The Worker and Sandbox bindings require Cloudflare infrastructure. For local development:
1. Use `wrangler dev` for the Worker
2. Use `wrangler sandbox` (if available) for Sandbox testing
3. Or mock the bindings for unit tests

### Building

```bash
# Main project
npm run build

# Remote agent bundle
npm run build:remote-agent

# Worker (typecheck only — deployed via wrangler)
npm run build:worker
```

## Cost Estimate

Per typical session (~30 min, 50K input tokens):
- Sandbox CPU/memory: ~$0.55
- Workers AI: ~$0.13
- Workers/Artifacts: ~$0.01
- **Total: ~$0.70**

See `docs/remote-architecture.md` for detailed cost breakdown.
