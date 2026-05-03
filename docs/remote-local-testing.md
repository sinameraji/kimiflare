# Testing `/remote` Locally

## What You Can Test Right Now (No Cloudflare Account Needed)

### 1. Build the remote agent bundle

```bash
npm run build:remote-agent
```

This should produce `remote/agent/dist/remote-agent.mjs` without errors.

### 2. Run the local CLI commands

```bash
# The help text should show the new commands
kimiflare --help

# The remote subcommand should be available
kimiflare remote --help

# List sessions (will be empty initially)
kimiflare remote list
```

### 3. Test GitHub OAuth device flow

```bash
kimiflare auth github
```

This will:
1. Print a verification URL and user code
2. Open your browser (or print the URL)
3. Poll GitHub for the token
4. Save it to `~/.config/kimiflare/config.json`

**Note:** This requires a GitHub OAuth App. The PR includes a default client ID, but you can override it:

```bash
KIMIFLARE_GITHUB_CLIENT_ID=your_client_id kimiflare auth github
```

### 4. Verify config persistence

```bash
cat ~/.config/kimiflare/config.json
```

You should see `githubOAuthToken`, `githubRefreshToken`, `githubTokenExpiry` fields.

### 5. Test repo auto-detection

In a git repo with a GitHub remote:

```bash
cd /path/to/your/repo
kimiflare
# Then type: /remote test
```

It will detect the repo from `git remote get-url origin` and either:
- Start the session (if `remoteWorkerUrl` is configured)
- Tell you to configure `remoteWorkerUrl` (expected if you haven't deployed the Worker)

### 6. Run the test suite

```bash
npm test
```

All 310 tests should pass, including any new tests.

---

## What Requires Cloudflare Infrastructure

The end-to-end flow needs:

| Component | Why it needs Cloudflare |
|-----------|------------------------|
| **Worker** | Uses Durable Objects, Artifacts binding, Sandbox binding |
| **Sandbox** | Cloudflare Sandbox is a managed container runtime |
| **Artifacts** | Cloudflare Artifacts is a managed Git server |
| **LLM Relay** | Calls Workers AI API via the Worker |

**You cannot run the full end-to-end flow locally.** The Worker bindings are Cloudflare-specific.

---

## Mock Mode for Local Development

For development without Cloudflare infra, you can run a mock Worker:

```bash
# Terminal 1: Start the mock Worker
node scripts/mock-remote-worker.js

# Terminal 2: Configure CLI to use mock
kimiflare config remoteWorkerUrl http://localhost:8787
kimiflare config remoteAuthSecret dev-secret

# Terminal 3: Start a session
kimiflare
/remote "Add a README"
```

The mock Worker simulates:
- Session creation
- SSE progress streaming (sends fake events)
- Status queries
- Cancellation

It does **not**:
- Run actual code
- Call Workers AI
- Create GitHub PRs

See `scripts/mock-remote-worker.js` below.

---

## Deploying to Cloudflare (Required for Real Testing)

### Step 1: Deploy the Worker

```bash
cd remote/worker

# Install dependencies
npm install

# Set secrets
wrangler secret put REMOTE_AUTH_SECRET
# Enter a strong random string

wrangler secret put CF_API_TOKEN
# Enter your Cloudflare API token (needs Workers AI + Account read)

# Deploy
wrangler deploy
```

### Step 2: Build and push the container image

```bash
# Build the agent bundle
npm run build:remote-agent

# Build the Docker image
cd remote
docker build -t ghcr.io/sinameraji/kimiflare-remote-agent:latest .

# Push (requires GitHub Container Registry auth)
docker push ghcr.io/sinameraji/kimiflare-remote-agent:latest
```

**Note:** The Worker references `ghcr.io/sinameraji/kimiflare-remote-agent:latest`. Change this in `remote/worker/src/session-do.ts` if you use a different registry.

### Step 3: Configure the CLI

```bash
# Set your deployed Worker URL
kimiflare config remoteWorkerUrl https://kimiflare-remote.your-account.workers.dev

# Set the same secret you used in wrangler
kimiflare config remoteAuthSecret your-secret-here

# Authenticate with GitHub
kimiflare auth github
```

### Step 4: Run a real session

```bash
cd /path/to/your/repo
kimiflare
/remote "Refactor the auth module"
```

You'll see:
1. "Starting remote session..."
2. Live progress streaming in the TUI
3. "✅ Done — PR: https://github.com/..." when finished

---

## Troubleshooting

### "Remote worker not configured"

Set `remoteWorkerUrl` in your config:

```bash
kimiflare config remoteWorkerUrl https://your-worker.workers.dev
```

### "GitHub not authenticated"

Run the OAuth flow:

```bash
kimiflare auth github
```

### "Could not detect GitHub repo"

Either:
- Run from a git repo with a GitHub remote
- Or set it explicitly: `kimiflare config githubRepo owner/repo`

### Worker deployment fails

Check that your Cloudflare account has:
- Workers enabled
- Durable Objects available
- Artifacts beta access (if required)
- Sandbox beta access (if required)

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `kimiflare auth github` | Authenticate with GitHub |
| `kimiflare remote list` | List all remote sessions |
| `kimiflare remote status [id]` | Show session status |
| `kimiflare remote cancel <id>` | Cancel a running session |
| `kimiflare config remoteWorkerUrl <url>` | Set Worker URL |
| `kimiflare config remoteAuthSecret <secret>` | Set auth secret |
| `kimiflare config githubRepo owner/repo` | Set default repo |
| `/remote <prompt>` | Start session from TUI |
