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
  done?: boolean;
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
/** Worker name the kimiflare-commute wrangler.toml ships with. We use this to
 *  target the right Worker for tear-down. */
const WORKER_NAME = "kimiflare-commute";

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
  }
  return `${cmd} failed:\n${tail}${hint}`;
}

/** Cloudflare API tokens page. Deep-linking specific permission templates
 *  isn't a publicly documented URL contract, so we link to the canonical
 *  tokens page and spell out the scopes for the user. */
const TOKEN_TEMPLATE_URL = "https://dash.cloudflare.com/profile/api-tokens";

export async function* deployCommute(): AsyncGenerator<DeployStep, DeployResult, void> {
  // ── 0. Load existing cfg to get CF creds ────────────────────────────
  const cfg = await loadConfig();
  if (!cfg?.accountId || !cfg?.apiToken) {
    yield { message: "Cloudflare credentials missing — run /init to set them up first.", error: true };
    throw new Error("missing CF creds");
  }
  const cfEnv: Record<string, string> = {
    CLOUDFLARE_ACCOUNT_ID: cfg.accountId,
    CLOUDFLARE_API_TOKEN: cfg.apiToken,
  };

  // ── 1. Prereqs ─────────────────────────────────────────────────────
  yield { message: "Checking prerequisites…" };
  if (!(await hasBinary("git"))) {
    yield { message: "git not found. Install git and retry.", error: true };
    throw new Error("git missing");
  }
  if (!(await hasBinary("wrangler"))) {
    yield { message: "wrangler not found. Installing via npm…" };
    const install = await runCmd("npm", ["install", "-g", "wrangler"], { timeoutMs: 120_000 });
    if (install.code !== 0) {
      yield {
        message: `wrangler install failed. Install manually: npm install -g wrangler\n${install.stderr.slice(0, 300)}`,
        error: true,
      };
      throw new Error("wrangler install failed");
    }
    yield { message: "wrangler installed." };
  }
  yield { message: "Prereqs OK." };

  // ── 2. Clone repo ──────────────────────────────────────────────────
  const tmpRoot = await mkdtemp(join(tmpdir(), "kimiflare-commute-"));
  const repoDir = join(tmpRoot, "kimiflare-commute");
  yield { message: `Fetching worker source from GitHub (${COMMUTE_REPO})…` };
  const clone = await runCmd("git", ["clone", "--depth", "1", "--branch", COMMUTE_BRANCH, COMMUTE_REPO, repoDir], { timeoutMs: 60_000 });
  if (clone.code !== 0) {
    yield { message: `git clone failed:\n${(clone.stderr || clone.stdout).slice(0, 400)}`, error: true };
    throw new Error("clone failed");
  }
  yield { message: "Source cloned." };

  const workerDir = join(repoDir, "remote", "worker");
  const wranglerToml = join(workerDir, "wrangler.toml");

  // ── 3a. Create or reuse the OAUTH_KV namespace in the user's account ─
  // First try to find an existing one. wrangler kv namespace list emits
  // JSON; parse it instead of grepping (field order isn't guaranteed).
  let finalKvId = "";
  yield { message: "Looking up existing OAUTH_KV namespace…" };
  const kvList = await runCmd("wrangler", ["kv", "namespace", "list"], { env: cfEnv, timeoutMs: 30_000 });
  if (kvList.code === 0) {
    try {
      const items = JSON.parse(kvList.stdout) as Array<{ id?: string; title?: string }>;
      const match = items.find((it) => typeof it.title === "string" && /OAUTH_KV$/i.test(it.title));
      if (match?.id) {
        finalKvId = match.id;
        yield { message: `Reusing existing namespace ${match.title} (${finalKvId.slice(0, 8)}…).` };
      }
    } catch {
      // Fall through to create.
    }
  } else {
    // Listing failed — most likely token doesn't have KV permissions. Surface
    // the actual wrangler stderr so the user can act on it.
    yield {
      message: explainWranglerFailure("wrangler kv namespace list", kvList.stdout, kvList.stderr),
      error: true,
    };
    throw new Error("kv list failed");
  }

  if (!finalKvId) {
    yield { message: "Creating OAUTH_KV namespace…" };
    const kvCreate = await runCmd("wrangler", ["kv", "namespace", "create", "OAUTH_KV"], {
      cwd: workerDir,
      env: cfEnv,
      timeoutMs: 30_000,
    });
    finalKvId = extractKvId(kvCreate.stdout + "\n" + kvCreate.stderr) ?? "";
    if (!finalKvId) {
      yield {
        message: explainWranglerFailure("wrangler kv namespace create OAUTH_KV", kvCreate.stdout, kvCreate.stderr),
        error: true,
      };
      throw new Error("kv create failed");
    }
    yield { message: `Created namespace ${finalKvId.slice(0, 8)}….` };
  }

  // ── 3b. Patch wrangler.toml: KV id + remote image (so no Docker needed) ─
  yield { message: "Patching wrangler.toml (KV id + public image)…" };
  let toml = await readFile(wranglerToml, "utf8");
  toml = toml.replace(
    /(\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"OAUTH_KV"[\s\S]*?id\s*=\s*")[^"]+(")/,
    `$1${finalKvId}$2`,
  );
  toml = toml.replace(
    /image\s*=\s*"\.\/Dockerfile"/,
    `image = "${PUBLIC_SANDBOX_IMAGE}"`,
  );
  await writeFile(wranglerToml, toml, "utf8");
  yield { message: "wrangler.toml patched." };

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
  yield { message: `Deployed: ${workerUrl}` };

  // ── 6. Persist to cfg ──────────────────────────────────────────────
  const next: KimiConfig = {
    ...cfg,
    workerEndpoint: workerUrl,
    workerApiKey,
    multiAgentEnabled: true,
  };
  await saveConfig(next);
  yield { message: "Saved to ~/.config/kimiflare/config.json." };

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
    yield { message: "Worker deleted." };
  } else {
    const combined = (del.stdout + del.stderr).toLowerCase();
    if (combined.includes("not found") || combined.includes("does not exist") || combined.includes("10007")) {
      yield { message: "Worker not found (already deleted or never created)." };
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
        yield { message: "No OAUTH_KV namespaces found." };
      } else {
        for (const t of targets) {
          if (!t.id) continue;
          yield { message: `Deleting KV namespace ${t.title} (${t.id.slice(0, 8)}…)` };
          const r = await runCmd("wrangler", ["kv", "namespace", "delete", "--namespace-id", t.id], {
            env: cfEnv,
            input: "y\n",
            timeoutMs: 30_000,
          });
          if (r.code !== 0) {
            yield { message: `  (warning: ${(r.stderr || r.stdout).slice(0, 200)})` };
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
  yield { message: "Clearing local multi-agent config…" };
  const next: KimiConfig = {
    ...cfg,
    workerEndpoint: undefined,
    workerApiKey: undefined,
    multiAgentEnabled: false,
    autoExecute: false,
  };
  await saveConfig(next);

  yield { message: "Tear-down complete — multi-agent is fully removed.", done: true };
}
