import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadConfig, saveConfig } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REMOTE_DIR = join(__dirname, "..", "..", "..", "remote");
const WORKER_DIR = join(REMOTE_DIR, "worker");

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

function runCapture(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

export interface DeployStep {
  message: string;
  done?: boolean;
  error?: boolean;
}

export async function* deployForTui(): AsyncGenerator<DeployStep, { workerUrl: string; authSecret: string }, void> {
  // -- 1. Prerequisites --
  yield { message: "Checking prerequisites..." };

  try {
    runCapture("wrangler --version");
  } catch {
    yield { message: "wrangler not found. Install: npm install -g wrangler", error: true };
    yield { message: "Then run: wrangler login", error: true };
    throw new Error("wrangler not installed");
  }
  yield { message: "wrangler OK" };

  try {
    runCapture("wrangler whoami");
  } catch {
    yield { message: "wrangler not authenticated. Run: wrangler login", error: true };
    throw new Error("wrangler not authenticated");
  }
  yield { message: "wrangler authenticated" };

  try {
    runCapture("docker --version");
  } catch {
    yield { message: "Docker not found. Install: https://docs.docker.com/get-docker/", error: true };
    throw new Error("docker not installed");
  }
  yield { message: "Docker OK" };

  // -- 2. Build agent bundle --
  yield { message: "Building remote agent bundle..." };
  try {
    runCapture("npm run build:remote-agent", join(REMOTE_DIR, ".."));
    yield { message: "Agent bundle built" };
  } catch (err) {
    yield { message: `Build failed: ${err instanceof Error ? err.message : String(err)}`, error: true };
    throw err;
  }

  // -- 3. Deploy Worker --
  yield { message: "Deploying Worker to Cloudflare..." };
  try {
    runCapture("wrangler deploy", WORKER_DIR);
    yield { message: "Worker deployed" };
  } catch (err) {
    yield { message: `Deploy failed: ${err instanceof Error ? err.message : String(err)}`, error: true };
    throw err;
  }

  // Extract Worker URL
  let workerUrl: string | undefined;
  try {
    const info = runCapture("wrangler info", WORKER_DIR);
    const match = info.match(/https:\/\/[^\s]+\.workers\.dev/);
    if (match) workerUrl = match[0];
  } catch { /* ignore */ }

  if (!workerUrl) {
    yield { message: "Could not auto-detect Worker URL", error: true };
    throw new Error("Worker URL not found");
  }
  yield { message: `Worker URL: ${workerUrl}` };

  // -- 4. Auto-generate and set secrets --
  const authSecret = generateSecret();
  const cfg = await loadConfig();
  const cfToken = process.env.CF_API_TOKEN ?? cfg?.apiToken;

  if (!cfToken) {
    yield { message: "CF_API_TOKEN not found. Set CF_API_TOKEN env var or apiToken in config", error: true };
    throw new Error("CF_API_TOKEN missing");
  }

  yield { message: "Setting Worker secrets..." };
  try {
    execSync(`wrangler secret put REMOTE_AUTH_SECRET`, {
      cwd: WORKER_DIR,
      input: authSecret,
      stdio: ["pipe", "pipe", "pipe"],
    });
    execSync(`wrangler secret put CF_API_TOKEN`, {
      cwd: WORKER_DIR,
      input: cfToken,
      stdio: ["pipe", "pipe", "pipe"],
    });
    yield { message: "Secrets set" };
  } catch (err) {
    yield { message: `Secret setup failed: ${err instanceof Error ? err.message : String(err)}`, error: true };
    throw err;
  }

  // -- 5. Build and push container --
  const imageTag = "ghcr.io/sinameraji/kimiflare-remote-agent:latest";

  yield { message: "Building container image..." };
  try {
    runCapture(`docker build -t ${imageTag} .`, REMOTE_DIR);
    yield { message: "Image built" };
  } catch (err) {
    yield { message: `Image build failed: ${err instanceof Error ? err.message : String(err)}`, error: true };
    throw err;
  }

  yield { message: `Pushing ${imageTag}...` };
  try {
    runCapture(`docker push ${imageTag}`, REMOTE_DIR);
    yield { message: "Image pushed" };
  } catch (err) {
    yield { message: `Push failed: ${err instanceof Error ? err.message : String(err)}`, error: true };
    yield { message: "Make sure you're logged into ghcr.io: docker login ghcr.io -u USERNAME -p GITHUB_TOKEN", error: true };
    throw err;
  }

  // -- 6. Save config --
  const nextCfg = {
    ...(cfg ?? { accountId: "", apiToken: "", model: "@cf/moonshotai/kimi-k2.6" }),
    remoteWorkerUrl: workerUrl,
    remoteAuthSecret: authSecret,
  };
  await saveConfig(nextCfg);
  yield { message: "Config saved" };

  yield { message: "Remote infrastructure ready!", done: true };
  return { workerUrl, authSecret };
}
