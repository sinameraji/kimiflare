/**
 * Smooth self-hosted Commute deploy for /multi-agent.
 *
 * Each user gets their own Cloudflare Worker — no centralized service. The
 * flow streams progress as an async generator so the TUI can render it line
 * by line.
 *
 * Steps (least possible):
 *   1. Verify prerequisites: wrangler, git, user's CF account/token in cfg.
 *   2. Shallow-clone kimiflare-commute to a temp dir.
 *   3. Patch wrangler.toml to:
 *      - point the SANDBOX container at the published public image (no
 *        Docker required locally), and
 *      - inject a freshly-created OAUTH_KV namespace ID (auto-created via
 *        `wrangler kv namespace create`).
 *   4. Generate a random WORKER_API_KEY, set it as a Worker secret.
 *   5. `wrangler deploy` (uses CLOUDFLARE_API_TOKEN env so no interactive
 *      login is required).
 *   6. Parse the deployed URL from wrangler output.
 *   7. Persist { workerEndpoint, workerApiKey } in cfg.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig, saveConfig, type KimiConfig } from "../config.js";

export interface DeployStep {
  message: string;
  /** Terminal "all-done" — the generator is finished. */
  done?: boolean;
  /** Per-step success indicator (renders as a green ✓). Doesn't end the loop. */
  ok?: boolean;
  error?: boolean;
}

export interface DeployResult {
  workerEndpoint: string;
  workerApiKey: string;
}

const COMMUTE_REPO = "https://github.com/sinameraji/kimiflare-commute.git";
const COMMUTE_BRANCH = "main";
/** Pre-published public sandbox image. Patched into the cloned wrangler.toml
 *  so the user doesn't need Docker to run wrangler deploy. */
const PUBLIC_SANDBOX_IMAGE = "ghcr.io/sinameraji/kimiflare-remote-agent:latest";
/** Worker name kimiflare uses for its OWN multi-agent infra. Intentionally
 *  distinct from the kimiflare-commute default — users may already have a
 *  Worker named "kimiflare-commute" deployed for a different project (e.g.
 *  the /remote terminal sessions feature), and we MUST NOT clobber it.
 *  Also drives the KV namespace title + the tear-down target. */
const WORKER_NAME = "kimiflare-multi-agent";
const KV_TITLE = "kimiflare-multi-agent-OAUTH_KV";

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/** Run a command; return {stdout, stderr, code}. Doesn't throw on non-zero
 *  exit; callers decide what to do. */
function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; input?: string; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: [opts.input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    if (opts.input && child.stdin) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), code: -1 });
    });
  });
}

/** Detect whether a binary is on PATH by trying `<bin> --version`. */
async function hasBinary(bin: string): Promise<boolean> {
  const r = await runCmd(bin, ["--version"], { timeoutMs: 5000 });
  return r.code === 0;
}

/** Pull the deployed URL out of wrangler's deploy output. Wrangler prints
 *  something like "Published … (1.05 sec) https://kimiflare-commute.<sub>.workers.dev". */
function extractWorkerUrl(text: string): string | undefined {
  const match = text.match(/https:\/\/[^\s]+\.workers\.dev/);
  return match ? match[0] : undefined;
}

/** Pull a freshly-created KV namespace ID out of `wrangler kv namespace create`
 *  output. The CLI prints a JSON-ish block recommending the addition to
 *  wrangler.toml. */
function extractKvId(text: string): string | undefined {
  // `id = "abc123..."` or `"id": "abc123..."`
  const match = text.match(/id\s*[:=]\s*"([a-f0-9]{16,})"/);
  return match ? match[1] : undefined;
}

/** Build a user-actionable error message from a failed wrangler invocation.
 *  Tries to detect the common failure modes (missing token scope, auth) and
 *  point the user at a fix; falls back to surfacing the raw stderr tail. */
function explainWranglerFailure(cmd: string, stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`;
  const tail = combined.slice(-1200).trim();
  const lower = combined.toLowerCase();
  let hint = "";
  if (
    lower.includes("authentication error") ||
    lower.includes("unauthorized") ||
    /\bcode: 10000\b/.test(lower) ||
    /\bstatus 403\b/.test(lower) ||
    lower.includes("permission") ||
    lower.includes("not allowed")
  ) {
    hint =
      "\n\n⚠  Your Cloudflare API token is missing one or more required scopes.\n" +
      "\n" +
      "Open your tokens at:\n" +
      `  ${TOKEN_TEMPLATE_URL}\n` +
      "\n" +
      "Find the token kimiflare is using → Edit → add these Account permissions:\n" +
      "  • Workers Scripts:Edit\n" +
      "  • Workers KV Storage:Edit\n" +
      "  • Account Settings:Read\n" +
      "\n" +
      "Save the token. The value doesn't change, so no kimiflare config edit\n" +
      "is needed — just re-run /multi-agent → Set up.";
  } else if (lower.includes("not authenticated") || lower.includes("wrangler login")) {
    hint =
      "\n\n⚠  Wrangler isn't picking up CLOUDFLARE_API_TOKEN.\n" +
      "Verify the token is in your kimiflare config (`/init` if not),\n" +
      "or set CLOUDFLARE_API_TOKEN in your shell.";
  } else if (/IMAGE_REGISTRY_NOT_CONFIGURED/i.test(combined)) {
    hint =
      "\n\n⚠  Cloudflare rejected the container image:\n" +
      "    IMAGE_REGISTRY_NOT_CONFIGURED\n" +
      "\n" +
      "Containers in your account can only pull from registries it knows about.\n" +
      "By default that's just Cloudflare's managed registry — populated by\n" +
      "`wrangler deploy` building your Dockerfile locally.\n" +
      "\n" +
      "Verify Docker is running:  docker --version  (then try R to retry).\n" +
      "If you want to use an external registry instead, add it under\n" +
      "Workers & Pages → <Worker> → Container registries in the dashboard.";
  } else if (
    /\bforbidden\b/i.test(combined) ||
    /containers? .*(not enabled|disabled|denied|forbidden)/i.test(combined)
  ) {
    // Confirmed from a live debug run: the 403 originates from
    //   POST /accounts/<id>/containers/applications
    // with body `{ error: 'Authentication error' }`. Cloudflare's
    // Workers Scripts:Edit scope does NOT cover the Containers API —
    // that's a separate permission group.
    const containersHit = /containers\/applications/i.test(combined);
    const logMatch = combined.match(/Logs were written to "([^"]+)"/);
    const logHint = logMatch
      ? `\n\nFull Cloudflare API response is in:\n  ${logMatch[1]}\n  tail -n 80 "${logMatch[1]}" | grep -iE "error|forbidden|denied|status"`
      : "";
    if (containersHit) {
      hint =
        "\n\n⚠  Cloudflare Containers API returned 403 (Authentication error).\n" +
        "\n" +
        "The Worker script uploaded fine. The failure is on the step where\n" +
        "wrangler registers the container application. Your API token is\n" +
        "scoped for Workers Scripts:Edit etc., but the Containers API is\n" +
        "not covered by those scopes — it requires either:\n" +
        "\n" +
        "  (a) A Containers-specific token permission (Cloudflare's exact\n" +
        "      label varies — look in the token-edit picker for anything\n" +
        "      containing \"Container\"), OR\n" +
        "\n" +
        "  (b) OAuth auth via `wrangler login` — gives wrangler full\n" +
        "      account access. THIS IS HOW MOST EXISTING DEPLOYMENTS\n" +
        "      WORKED. If your other Containers-using Workers were\n" +
        "      deployed successfully, this is almost certainly how.\n" +
        "\n" +
        "Fastest fix (option b):\n" +
        "  1. In another terminal:  wrangler login\n" +
        "     (opens a browser; sign in to your CF account)\n" +
        "  2. Press R here to retry — the deploy will auto-detect your\n" +
        "     OAuth session and use it instead of the scoped API token." +
        logHint;
    } else {
      hint =
        "\n\n⚠  Cloudflare returned a bare \"Forbidden\". Common causes:\n" +
        "\n" +
        "  • Token missing a required scope (Workers Scripts:Edit,\n" +
        "    Workers KV Storage:Edit, Account Settings:Read).\n" +
        "  • Account isn't on Workers Paid plan ($5/mo).\n" +
        "  • Sub-account with restricted features.\n" +
        "\n" +
        "Edit your token at https://dash.cloudflare.com/profile/api-tokens" +
        logHint;
    }
  }
  return `${cmd} failed:\n${tail}${hint}`;
}

/** Cloudflare API tokens page. Deep-linking specific permission templates
 *  isn't a publicly documented URL contract, so we link to the canonical
 *  tokens page and spell out the scopes for the user. */
const TOKEN_TEMPLATE_URL = "https://dash.cloudflare.com/profile/api-tokens";

/** Names of Workers already deployed on the user's CF account that look
 *  like candidate multi-agent hosts (so the UI can offer "reuse one" vs
 *  "create fresh"). Returns just the names that actually exist. */
export async function findExistingCommuteWorkers(): Promise<string[]> {
  const cfg = await loadConfig();
  if (!cfg?.accountId || !cfg?.apiToken) return [];
  const env = {
    CLOUDFLARE_ACCOUNT_ID: cfg.accountId,
    CLOUDFLARE_API_TOKEN: cfg.apiToken,
    WRANGLER_LOG_SANITIZE: "false",
  };
  const candidates = ["kimiflare-multi-agent", "kimiflare-commute"];
  const exists: string[] = [];
  for (const name of candidates) {
    const r = await runCmd("wrangler", ["deployments", "list", "--name", name], {
      env,
      timeoutMs: 15_000,
    });
    if (r.code === 0 && !/(no deployments|could not find|not found)/i.test(r.stdout + r.stderr)) {
      exists.push(name);
    }
  }
  return exists;
}

export interface DeployOpts {
  /** Override the Worker name. Defaults to "kimiflare-multi-agent". When the
   *  user picks "reuse my existing kimiflare-commute" we pass that here so
   *  the deploy updates their existing Worker instead of creating a new one. */
  workerName?: string;
}

export async function* deployCommute(opts: DeployOpts = {}): AsyncGenerator<DeployStep, DeployResult, void> {
  const workerName = opts.workerName ?? WORKER_NAME;
  // KV title is derived so reusing an existing Worker also reuses (or
  // creates next to) a parallel-named KV namespace, avoiding cross-Worker
  // KV pollution.
  const kvTitle = workerName === WORKER_NAME ? KV_TITLE : `${workerName}-OAUTH_KV`;

  // ── 0. Load existing cfg to get CF creds ────────────────────────────
  const cfg = await loadConfig();
  if (!cfg?.accountId || !cfg?.apiToken) {
    yield { message: "Cloudflare credentials missing — run /init to set them up first.", error: true };
    throw new Error("missing CF creds");
  }
  // Auth selection. Two paths:
  //   - OAuth (via `wrangler login`): full account access including the
  //     Containers API. Preferred when present because scoped tokens often
  //     don't cover Containers, which yields a bare 403 at deploy time.
  //   - API token (CLOUDFLARE_API_TOKEN from our cfg): used when no OAuth
  //     session is found. Works for everything except Containers in many
  //     accounts.
  // We detect OAuth by running `wrangler whoami` with no CLOUDFLARE_*
  // env vars set — wrangler will then fall back to its persisted OAuth
  // session and exit 0 if one exists.
  const oauthCheck = await runCmd("wrangler", ["whoami"], { timeoutMs: 8_000 });
  const hasOAuth = oauthCheck.code === 0 && /Account ID|Email|You are logged in/i.test(oauthCheck.stdout + oauthCheck.stderr);
  const cfEnv: Record<string, string> = hasOAuth
    ? {
        CLOUDFLARE_ACCOUNT_ID: cfg.accountId,
        WRANGLER_LOG_SANITIZE: "false",
      }
    : {
        CLOUDFLARE_ACCOUNT_ID: cfg.accountId,
        CLOUDFLARE_API_TOKEN: cfg.apiToken,
        WRANGLER_LOG_SANITIZE: "false",
      };

  // ── 1. Prereqs ─────────────────────────────────────────────────────
  yield { message: "Checking prerequisites…" };
  if (!(await hasBinary("git"))) {
    yield { message: "git not found. Install git and retry.", error: true };
    throw new Error("git missing");
  }
  // Docker is required because we ship the container image via `./Dockerfile`
  // (wrangler builds locally and pushes to Cloudflare's managed registry).
  // The "use a published public image" shortcut fails on accounts that
  // haven't pre-configured an external registry (IMAGE_REGISTRY_NOT_CONFIGURED).
  if (!(await hasBinary("docker"))) {
    yield {
      message:
        "docker not found. Cloudflare Containers requires Docker for building\n" +
        "the sandbox image locally. Install: https://docs.docker.com/get-docker/\n" +
        "(macOS: `brew install --cask docker`)",
      error: true,
    };
    throw new Error("docker missing");
  }
  // Always install/upgrade wrangler@latest. The Cloudflare Containers API
  // is recent and the request/response shape has shifted between minor
  // versions — running an older wrangler against the current API can yield
  // bare 403s. Cheap insurance: upgrade on every deploy.
  yield { message: "Installing/upgrading wrangler to latest…" };
  const wranglerInstall = await runCmd("npm", ["install", "-g", "wrangler@latest"], { timeoutMs: 180_000 });
  if (wranglerInstall.code !== 0) {
    yield {
      message: `wrangler install failed. Install manually: npm install -g wrangler@latest\n${wranglerInstall.stderr.slice(-600)}`,
      error: true,
    };
    throw new Error("wrangler install failed");
  }
  const ver = await runCmd("wrangler", ["--version"], { timeoutMs: 5000 });
  const verStr = (ver.stdout || ver.stderr).trim().split("\n")[0] ?? "(unknown)";
  yield { message: `wrangler ready (${verStr})`, ok: true };
  yield {
    message: hasOAuth
      ? "Using wrangler OAuth session (full account access — best for Containers)"
      : "Using CLOUDFLARE_API_TOKEN from your kimiflare config (limited to the token's scopes)",
    ok: true,
  };
  yield { message: "Prerequisites ready", ok: true };

  // ── 2. Clone repo ──────────────────────────────────────────────────
  const tmpRoot = await mkdtemp(join(tmpdir(), "kimiflare-commute-"));
  const repoDir = join(tmpRoot, "kimiflare-commute");
  yield { message: `Fetching worker source from GitHub (${COMMUTE_REPO})…` };
  const clone = await runCmd("git", ["clone", "--depth", "1", "--branch", COMMUTE_BRANCH, COMMUTE_REPO, repoDir], { timeoutMs: 60_000 });
  if (clone.code !== 0) {
    yield { message: `git clone failed:\n${(clone.stderr || clone.stdout).slice(0, 400)}`, error: true };
    throw new Error("clone failed");
  }
  yield { message: "Source fetched from GitHub", ok: true };

  const workerDir = join(repoDir, "remote", "worker");
  const wranglerToml = join(workerDir, "wrangler.toml");

  // 2b. Install dependencies in the cloned Worker — wrangler's bundler
  // needs them at deploy time (e.g. @cloudflare/sandbox), and a fresh
  // clone has no node_modules.
  yield { message: "Installing Worker dependencies (npm install)…" };
  const install = await runCmd("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: workerDir,
    timeoutMs: 180_000,
  });
  if (install.code !== 0) {
    yield {
      message: `npm install failed in the cloned worker:\n${(install.stderr || install.stdout).slice(-1200).trim()}`,
      error: true,
    };
    throw new Error("npm install failed");
  }
  yield { message: "Worker dependencies installed", ok: true };

  // ── 3a. Create or reuse the OAUTH_KV namespace in the user's account ─
  // First try to find an existing one. wrangler kv namespace list emits
  // JSON; parse it instead of grepping (field order isn't guaranteed).
  let finalKvId = "";
  // Find existing KV by title. wrangler can print warnings/version-update
  // notices before the JSON array, so don't JSON.parse(stdout) directly —
  // extract just the array portion.
  const findKvByTitle = async (): Promise<{ id: string; title: string } | null> => {
    const r = await runCmd("wrangler", ["kv", "namespace", "list"], { env: cfEnv, timeoutMs: 30_000 });
    if (r.code !== 0) {
      throw new Error(explainWranglerFailure("wrangler kv namespace list", r.stdout, r.stderr));
    }
    const jsonMatch = r.stdout.match(/\[\s*{[\s\S]*}\s*\]/);
    if (!jsonMatch) return null;
    try {
      const items = JSON.parse(jsonMatch[0]) as Array<{ id?: string; title?: string }>;
      const exact = items.find((it) => it.title === kvTitle && it.id);
      if (exact?.id && exact.title) return { id: exact.id, title: exact.title };
      const legacy = items.find((it) => typeof it.title === "string" && /OAUTH_KV$/i.test(it.title) && it.id);
      if (legacy?.id && legacy.title) return { id: legacy.id, title: legacy.title };
      return null;
    } catch {
      return null;
    }
  };

  yield { message: `Looking up KV namespace "${kvTitle}"…` };
  try {
    const existing = await findKvByTitle();
    if (existing) {
      finalKvId = existing.id;
      yield { message: `KV namespace ready (reused ${existing.title} ${finalKvId.slice(0, 8)}…)`, ok: true };
    }
  } catch (err) {
    yield { message: err instanceof Error ? err.message : String(err), error: true };
    throw err;
  }

  if (!finalKvId) {
    yield { message: `Creating KV namespace "${kvTitle}"…` };
    const kvCreate = await runCmd("wrangler", ["kv", "namespace", "create", kvTitle], {
      cwd: workerDir,
      env: cfEnv,
      timeoutMs: 30_000,
    });
    finalKvId = extractKvId(kvCreate.stdout + "\n" + kvCreate.stderr) ?? "";
    if (!finalKvId) {
      // Common case: namespace exists from a prior partial deploy and our
      // lookup didn't catch it (e.g. wrangler output format drift). Re-list
      // and try once more before giving up.
      if (/already exists/i.test(kvCreate.stdout + kvCreate.stderr)) {
        yield { message: "Namespace already exists — re-checking…" };
        try {
          const found = await findKvByTitle();
          if (found?.id) {
            finalKvId = found.id;
            yield { message: `KV namespace ready (recovered ${found.title} ${finalKvId.slice(0, 8)}…)`, ok: true };
          }
        } catch { /* fall through to error */ }
      }
    }
    if (!finalKvId) {
      yield {
        message: explainWranglerFailure(`wrangler kv namespace create ${kvTitle}`, kvCreate.stdout, kvCreate.stderr),
        error: true,
      };
      throw new Error("kv create failed");
    }
    if (!finalKvId.length) {
      // unreachable but keeps tsc happy with the earlier ok-yield branch.
    } else if (!/already exists/i.test(kvCreate.stdout + kvCreate.stderr)) {
      yield { message: `KV namespace ready (created ${finalKvId.slice(0, 8)}…)`, ok: true };
    }
  }

  // Detect whether a Worker with this name already exists on the user's
  // account. Drives the migration-injection decision below: fresh deploys
  // need v1 with new_sqlite_classes to create the DOs; existing deploys
  // must NOT re-declare new_sqlite_classes on classes that already exist
  // (Cloudflare returns code 10074 "Cannot apply new-sqlite-class
  // migration to class … already depended on by existing Durable Objects").
  yield { message: `Checking if "${workerName}" already exists…` };
  const deployments = await runCmd("wrangler", ["deployments", "list", "--name", workerName], {
    env: cfEnv,
    timeoutMs: 30_000,
  });
  const workerExists =
    deployments.code === 0 &&
    !/(no deployments|could not find|not found)/i.test(deployments.stdout + deployments.stderr);
  yield {
    message: workerExists
      ? `Found existing Worker "${workerName}" — preserving its migration history`
      : `No Worker named "${workerName}" — will provision from scratch`,
    ok: true,
  };

  // ── 3b. Patch wrangler.toml ─────────────────────────────────────────
  // - set Worker name to the chosen target
  // - inject the live KV namespace ID we just resolved
  // - strip the [[artifacts]] block (beta binding the user's wrangler may
  //   not recognize; worker-handler has a direct-GitHub-clone fallback)
  // - add a [[migrations]] block ONLY on fresh deploys; existing Workers
  //   already have their DOs created and re-declaring new_sqlite_classes
  //   collides with the deployed history.
  // NOTE: we deliberately leave `image = "./Dockerfile"` alone. Wrangler
  // builds it locally with Docker and pushes to Cloudflare's managed
  // container registry. We tried pointing at a published public GHCR
  // image to avoid the Docker requirement, but that fails with
  // IMAGE_REGISTRY_NOT_CONFIGURED on accounts without a custom external
  // registry configured. Docker is the supported path.
  yield { message: "Patching wrangler.toml…" };
  let toml = await readFile(wranglerToml, "utf8");
  toml = toml.replace(/^name\s*=\s*"[^"]+"/m, `name = "${workerName}"`);
  toml = toml.replace(
    /(\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"OAUTH_KV"[\s\S]*?id\s*=\s*")[^"]+(")/,
    `$1${finalKvId}$2`,
  );
  // Strip [[artifacts]] block. Match the header + every following line
  // that isn't blank-then-section, until the next blank line or new [[.
  toml = toml.replace(/\n\[\[artifacts\]\][\s\S]*?(?=\n\[|\n*$)/g, "\n");
  // Always ensure the migrations block lists ALL current DO classes.
  // For existing workers, we bump the tag (v1 → v2 → v3) so Wrangler
  // knows to add any new classes (e.g. WorkerDO) without recreating
  // existing ones. Wrangler ignores already-created classes.
  const existingMigrations = toml.match(/\[\[migrations\]\]/);
  if (existingMigrations) {
    // Replace the existing migrations block with the current class list
    toml = toml.replace(
      /\[\[migrations\]\][\s\S]*?new_sqlite_classes\s*=\s*\[[^\]]*\]/,
      `[[migrations]]\ntag = "v2"\nnew_sqlite_classes = ["SessionDO", "WorkerDO", "Sandbox"]`,
    );
  } else {
    toml +=
      `\n# Auto-added by kimiflare /multi-agent → Set up (fresh deploy only)\n` +
      `[[migrations]]\n` +
      `tag = "v1"\n` +
      `new_sqlite_classes = ["SessionDO", "WorkerDO", "Sandbox"]\n`;
  }
  // Enable invocation logs so the multi-agent worker emits structured logs
  // to Cloudflare (visible in Workers & Pages → Logs). Keep the general
  // log stream disabled to avoid noise — we only want per-invocation records.
  if (!/\[observability\.logs\]/.test(toml)) {
    toml +=
      `\n# Auto-added by kimiflare /multi-agent → Set up\n` +
      `[observability.logs]\n` +
      `enabled = false\n` +
      `invocation_logs = true\n`;
  }
  await writeFile(wranglerToml, toml, "utf8");
  yield {
    message: workerExists
      ? "wrangler.toml patched (name, KV id, [[artifacts]] stripped)"
      : "wrangler.toml patched (name, KV id, [[artifacts]] stripped, DO migrations added)",
    ok: true,
  };

  // ── 4. Generate + set the WORKER_API_KEY secret ────────────────────
  const workerApiKey = generateSecret();
  yield { message: "Setting WORKER_API_KEY secret…" };
  const secret = await runCmd("wrangler", ["secret", "put", "WORKER_API_KEY"], {
    cwd: workerDir,
    env: cfEnv,
    input: workerApiKey + "\n",
    timeoutMs: 30_000,
  });
  if (secret.code !== 0) {
    yield {
      message: explainWranglerFailure("wrangler secret put WORKER_API_KEY", secret.stdout, secret.stderr),
      error: true,
    };
    throw new Error("secret put failed");
  }
  // ALSO set ACCOUNT_ID + CF_API_TOKEN as Worker secrets so the operator's
  // env is populated (the worker uses them as fallback when the request
  // doesn't carry the user's creds).
  await runCmd("wrangler", ["secret", "put", "ACCOUNT_ID"],   { cwd: workerDir, env: cfEnv, input: cfg.accountId + "\n", timeoutMs: 30_000 });
  await runCmd("wrangler", ["secret", "put", "CF_API_TOKEN"], { cwd: workerDir, env: cfEnv, input: cfg.apiToken + "\n",  timeoutMs: 30_000 });
  yield { message: "Worker secrets uploaded (WORKER_API_KEY, ACCOUNT_ID, CF_API_TOKEN)", ok: true };

  // ── 5. Deploy ──────────────────────────────────────────────────────
  yield { message: "Deploying Worker (this can take ~30s)…" };
  const deploy = await runCmd("wrangler", ["deploy"], {
    cwd: workerDir,
    env: cfEnv,
    timeoutMs: 180_000,
  });
  if (deploy.code !== 0) {
    yield {
      message: explainWranglerFailure("wrangler deploy", deploy.stdout, deploy.stderr),
      error: true,
    };
    throw new Error("deploy failed");
  }
  const workerUrl = extractWorkerUrl(deploy.stdout + "\n" + deploy.stderr);
  if (!workerUrl) {
    yield { message: "Deploy succeeded but couldn't parse the Worker URL — set it manually via /multi-agent.", error: true };
    throw new Error("url parse failed");
  }
  yield { message: `Worker deployed at ${workerUrl}`, ok: true };

  // ── 6. Persist to cfg ──────────────────────────────────────────────
  const next: KimiConfig = {
    ...cfg,
    workerEndpoint: workerUrl,
    workerApiKey,
    multiAgentEnabled: true,
  };
  await saveConfig(next);
  yield { message: "Saved to ~/.config/kimiflare/config.json", ok: true };

  // ── 7. Cleanup ─────────────────────────────────────────────────────
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

  yield { message: "Setup complete — multi-agent is ready to use.", done: true };
  return { workerEndpoint: workerUrl, workerApiKey };
}

/**
 * Tear down the user's multi-agent infrastructure: delete the Worker,
 * delete OAUTH_KV namespace(s) titled by the binding, clear cfg.
 *
 * Streams progress like deployCommute.
 */
export async function* teardownCommute(): AsyncGenerator<DeployStep, void, void> {
  const cfg = await loadConfig();
  if (!cfg?.accountId || !cfg?.apiToken) {
    yield { message: "Cloudflare credentials missing — nothing to tear down.", error: true };
    throw new Error("missing CF creds");
  }
  const cfEnv: Record<string, string> = {
    CLOUDFLARE_ACCOUNT_ID: cfg.accountId,
    CLOUDFLARE_API_TOKEN: cfg.apiToken,
  };

  if (!(await hasBinary("wrangler"))) {
    yield { message: "wrangler not found. Install: npm install -g wrangler", error: true };
    throw new Error("wrangler missing");
  }

  // 1. Delete the Worker. Pipe "y" to auto-confirm wrangler's interactive
  //    "Are you sure?" prompt.
  yield { message: `Deleting Worker "${WORKER_NAME}"…` };
  const del = await runCmd("wrangler", ["delete", "--name", WORKER_NAME], {
    env: cfEnv,
    input: "y\n",
    timeoutMs: 60_000,
  });
  if (del.code === 0) {
    yield { message: `Worker "${WORKER_NAME}" deleted`, ok: true };
  } else {
    const combined = (del.stdout + del.stderr).toLowerCase();
    if (combined.includes("not found") || combined.includes("does not exist") || combined.includes("10007")) {
      yield { message: "Worker not found (already deleted or never created)", ok: true };
    } else {
      yield {
        message: explainWranglerFailure(`wrangler delete --name ${WORKER_NAME}`, del.stdout, del.stderr),
        error: true,
      };
      // Don't throw — continue to KV + config cleanup so partial state can
      // still be cleared. The error is surfaced above.
    }
  }

  // 2. Find + delete OAUTH_KV namespace(s). User may have multiple from
  //    prior failed deploys; delete all titled OAUTH_KV-ish.
  yield { message: "Listing KV namespaces to find OAUTH_KV…" };
  const kvList = await runCmd("wrangler", ["kv", "namespace", "list"], { env: cfEnv, timeoutMs: 30_000 });
  if (kvList.code === 0) {
    try {
      const items = JSON.parse(kvList.stdout) as Array<{ id?: string; title?: string }>;
      const targets = items.filter((it) => typeof it.title === "string" && /OAUTH_KV$/i.test(it.title));
      if (targets.length === 0) {
        yield { message: "No OAUTH_KV namespaces found (nothing to delete)", ok: true };
      } else {
        for (const t of targets) {
          if (!t.id) continue;
          const r = await runCmd("wrangler", ["kv", "namespace", "delete", "--namespace-id", t.id], {
            env: cfEnv,
            input: "y\n",
            timeoutMs: 30_000,
          });
          if (r.code === 0) {
            yield { message: `KV namespace ${t.title} deleted (${t.id.slice(0, 8)}…)`, ok: true };
          } else {
            yield { message: `KV namespace ${t.title} delete warning: ${(r.stderr || r.stdout).slice(0, 200)}` };
          }
        }
      }
    } catch {
      yield { message: "(could not parse KV list — skipping KV cleanup)" };
    }
  } else {
    yield { message: "(could not list KV namespaces — skipping KV cleanup)" };
  }

  // 3. Clear multi-agent fields from cfg.
  const next: KimiConfig = {
    ...cfg,
    workerEndpoint: undefined,
    workerApiKey: undefined,
    multiAgentEnabled: false,
    autoExecute: false,
  };
  await saveConfig(next);
  yield { message: "Local multi-agent config cleared", ok: true };

  yield { message: "Tear-down complete — multi-agent is fully removed.", done: true };
}
