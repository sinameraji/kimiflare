# kimiflare Remote Infrastructure

This directory contains the Cloudflare Worker and Sandbox container that power the `/remote` feature.

## Structure

- `worker/` — Hono-based Cloudflare Worker with Durable Objects
- `agent/` — Headless kimiflare agent that runs inside the Sandbox
- `Dockerfile` — Container image for the Sandbox

## Deploying

```bash
# From the repo root
npm run build:remote-agent
npm run remote:deploy
```

Or manually:

```bash
cd remote/worker
npm install
wrangler secret put REMOTE_AUTH_SECRET
wrangler secret put CF_API_TOKEN
wrangler deploy
```

## Architecture

1. User types `/remote <prompt>` in the TUI
2. Local CLI sends `POST /remote/start` to the Worker
3. Worker creates a Durable Object instance
4. DO creates an Artifacts repo and a Sandbox container
5. Sandbox clones the user's GitHub repo
6. Sandbox runs the headless agent with the prompt
7. Agent streams progress back via SSE
8. On completion, DO pushes branch and opens PR/issue
9. DO cleans up sandbox and artifacts
