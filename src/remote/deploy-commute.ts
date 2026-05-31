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
  yield { message: `Cloning ${COMMUTE_REPO}…` };
  const clone = await runCmd("git", ["clone", "--depth", "1", "--branch", COMMUTE_BRANCH, COMMUTE_REPO, repoDir], { timeoutMs: 60_000 });
  if (clone.code !== 0) {
    yield { message: `git clone failed:\n${(clone.stderr || clone.stdout).slice(0, 400)}`, error: true };
    throw new Error("clone failed");
  }
  yield { message: "Source cloned." };

  const workerDir = join(repoDir, "remote", "worker");
  const wranglerToml = join(workerDir, "wrangler.toml");

  // ── 3a. Create the KV namespace in the user's account ───────────────
  yield { message: "Creating OAUTH_KV namespace in your Cloudflare account…" };
  const kvCreate = await runCmd("wrangler", ["kv", "namespace", "create", "OAUTH_KV"], {
    cwd: workerDir,
    env: cfEnv,
    timeoutMs: 30_000,
  });
  const kvOutput = kvCreate.stdout + "\n" + kvCreate.stderr;
  const kvId = extractKvId(kvOutput);
  if (kvCreate.code !== 0 || !kvId) {
    // KV might already exist from a prior run; try to list and reuse.
    yield { message: "KV create failed or already exists; attempting to reuse existing namespace…" };
    const kvList = await runCmd("wrangler", ["kv", "namespace", "list"], { env: cfEnv, timeoutMs: 30_000 });
    const reuseMatch = kvList.stdout.match(/"title":\s*"[^"]*OAUTH_KV[^"]*",\s*"id":\s*"([a-f0-9]+)"/);
    if (!reuseMatch) {
      yield { message: `Could not create or find OAUTH_KV.\n${kvOutput.slice(0, 400)}`, error: true };
      throw new Error("kv setup failed");
    }
    yield { message: `Reusing existing namespace ${reuseMatch[1]?.slice(0, 8)}…` };
  }
  const finalKvId = kvId ?? extractKvId(kvOutput) ?? "";

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
    yield { message: `secret put failed:\n${secret.stderr.slice(0, 400)}`, error: true };
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
    yield { message: `wrangler deploy failed:\n${(deploy.stderr || deploy.stdout).slice(0, 600)}`, error: true };
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

  yield { message: "Commute is live — /multi-agent is ready.", done: true };
  return { workerEndpoint: workerUrl, workerApiKey };
}
