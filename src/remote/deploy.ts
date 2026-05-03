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

function run(cmd: string, cwd?: string, input?: string): void {
  execSync(cmd, {
    cwd,
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    input,
  });
}

function runOutput(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }).trim();
}

export async function runDeploy(): Promise<void> {
  console.log("kimiflare remote deploy\n");

  // -- 1. Prerequisites --
  try {
    run("wrangler --version");
  } catch {
    console.error("wrangler not found. Install: npm install -g wrangler");
    console.error("Then run: wrangler login");
    process.exit(1);
  }

  try {
    run("wrangler whoami");
  } catch {
    console.error("wrangler not authenticated. Run: wrangler login");
    process.exit(1);
  }

  try {
    run("docker --version");
  } catch {
    console.error("Docker not found. Install: https://docs.docker.com/get-docker/");
    process.exit(1);
  }

  // -- 2. Build agent bundle --
  console.log("Building remote agent bundle...");
  run("npm run build:remote-agent", join(REMOTE_DIR, ".."));
  console.log("Bundle built\n");

  // -- 3. Deploy Worker --
  console.log("Deploying Worker...");
  run("wrangler deploy", WORKER_DIR);
  console.log("Worker deployed\n");

  // Extract Worker URL from wrangler output or config
  let workerUrl: string | undefined;
  try {
    const info = runOutput("wrangler info", WORKER_DIR);
    const match = info.match(/https:\/\/[^\s]+\.workers\.dev/);
    if (match) workerUrl = match[0];
  } catch { /* ignore */ }

  if (!workerUrl) {
    console.error("Could not auto-detect Worker URL from wrangler.");
    console.error("Check your Cloudflare dashboard for the deployed Worker URL.");
    process.exit(1);
  }
  console.log(`Worker URL: ${workerUrl}\n`);

  // -- 4. Auto-generate and set secrets --
  const authSecret = generateSecret();

  // Try to get CF_API_TOKEN from env or existing config
  const cfg = await loadConfig();
  const cfToken = process.env.CF_API_TOKEN ?? cfg?.apiToken;

  if (!cfToken) {
    console.error("CF_API_TOKEN not found.");
    console.error("Set it via: export CF_API_TOKEN=your_token");
    console.error("Or add apiToken to ~/.config/kimiflare/config.json");
    process.exit(1);
  }

  console.log("Setting Worker secrets...");
  run(`wrangler secret put REMOTE_AUTH_SECRET`, WORKER_DIR, authSecret);
  run(`wrangler secret put CF_API_TOKEN`, WORKER_DIR, cfToken);
  console.log("Secrets set\n");

  // -- 5. Build and push container --
  const imageTag = "ghcr.io/sinameraji/kimiflare-remote-agent:latest";

  console.log("Building container image...");
  run(`docker build -t ${imageTag} .`, REMOTE_DIR);
  console.log("Image built\n");

  console.log(`Pushing ${imageTag}...`);
  try {
    run(`docker push ${imageTag}`, REMOTE_DIR);
    console.log("Image pushed\n");
  } catch {
    console.error("Failed to push image.");
    console.error("Make sure you're logged into ghcr.io:");
    console.error("docker login ghcr.io -u USERNAME -p GITHUB_TOKEN");
    process.exit(1);
  }

  // -- 6. Save config --
  const nextCfg = {
    ...(cfg ?? { accountId: "", apiToken: "", model: "@cf/moonshotai/kimi-k2.6" }),
    remoteWorkerUrl: workerUrl,
    remoteAuthSecret: authSecret,
  };
  await saveConfig(nextCfg);
  console.log("Saved remoteWorkerUrl and remoteAuthSecret to config\n");

  // -- 7. Done --
  console.log("Remote infrastructure ready!\n");
  console.log("Next step: authenticate with GitHub");
  console.log("  kimiflare auth github\n");
  console.log("Then start coding remotely:");
  console.log("  kimiflare");
  console.log('  /remote "Your prompt here"');
}

export async function checkDeployStatus(): Promise<{
  wrangler: boolean;
  wranglerAuth: boolean;
  docker: boolean;
  workerUrl?: string;
}> {
  let wrangler = false;
  let wranglerAuth = false;
  let docker = false;
  let workerUrl: string | undefined;

  try {
    run("wrangler --version");
    wrangler = true;
  } catch { /* ignore */ }

  if (wrangler) {
    try {
      run("wrangler whoami");
      wranglerAuth = true;
    } catch { /* ignore */ }
  }

  try {
    run("docker --version");
    docker = true;
  } catch { /* ignore */ }

  const cfg = await loadConfig();
  if (cfg?.remoteWorkerUrl) {
    try {
      const res = await fetch(`${cfg.remoteWorkerUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) workerUrl = cfg.remoteWorkerUrl;
    } catch { /* ignore */ }
  }

  return { wrangler, wranglerAuth, docker, workerUrl };
}
