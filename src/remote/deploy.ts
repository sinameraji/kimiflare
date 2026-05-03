import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, type KimiConfig } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REMOTE_DIR = join(__dirname, "..", "..", "..", "remote");
const WORKER_DIR = join(REMOTE_DIR, "worker");

interface DeployStatus {
  wranglerInstalled: boolean;
  wranglerAuthenticated: boolean;
  dockerInstalled: boolean;
  dockerAuthenticated: boolean;
  workerDeployed: boolean;
  workerUrl?: string;
  imagePushed: boolean;
  secretsSet: boolean;
}

export async function checkDeployStatus(): Promise<DeployStatus> {
  const status: DeployStatus = {
    wranglerInstalled: false,
    wranglerAuthenticated: false,
    dockerInstalled: false,
    dockerAuthenticated: false,
    workerDeployed: false,
    imagePushed: false,
    secretsSet: false,
  };

  // Check wrangler
  try {
    execSync("wrangler --version", { stdio: "ignore" });
    status.wranglerInstalled = true;
  } catch {
    // not installed
  }

  if (status.wranglerInstalled) {
    try {
      execSync("wrangler whoami", { stdio: "ignore" });
      status.wranglerAuthenticated = true;
    } catch {
      // not authenticated
    }
  }

  // Check docker
  try {
    execSync("docker --version", { stdio: "ignore" });
    status.dockerInstalled = true;
  } catch {
    // not installed
  }

  if (status.dockerInstalled) {
    try {
      // Check if logged into ghcr.io
      const info = execSync("docker info --format '{{.IndexServerAddress}}'", { encoding: "utf8" });
      status.dockerAuthenticated = info.includes("ghcr.io") || info.includes("docker.io");
    } catch {
      // not authenticated
    }
  }

  // Check if worker is already deployed
  const cfg = await loadConfig();
  if (cfg?.remoteWorkerUrl) {
    try {
      const res = await fetch(`${cfg.remoteWorkerUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        status.workerDeployed = true;
        status.workerUrl = cfg.remoteWorkerUrl;
      }
    } catch {
      // not reachable
    }
  }

  return status;
}

export async function runDeployWizard(): Promise<void> {
  console.log("🚀 kimiflare remote deployment wizard\n");

  const status = await checkDeployStatus();

  // Step 1: Prerequisites
  console.log("Checking prerequisites...\n");

  if (!status.wranglerInstalled) {
    console.log("❌ wrangler CLI not found. Install it:");
    console.log("   npm install -g wrangler");
    console.log("   Then run: wrangler login\n");
    return;
  }
  console.log("✅ wrangler installed");

  if (!status.wranglerAuthenticated) {
    console.log("❌ wrangler not authenticated. Run:");
    console.log("   wrangler login\n");
    return;
  }
  console.log("✅ wrangler authenticated");

  if (!status.dockerInstalled) {
    console.log("❌ Docker not found. Install Docker Desktop:");
    console.log("   https://docs.docker.com/get-docker/\n");
    return;
  }
  console.log("✅ Docker installed");

  // Step 2: Build agent bundle
  console.log("\n📦 Building remote agent bundle...");
  try {
    execSync("npm run build:remote-agent", {
      cwd: join(REMOTE_DIR, ".."),
      stdio: "inherit",
    });
    console.log("✅ Agent bundle built\n");
  } catch (err) {
    console.error("❌ Failed to build agent bundle:", err instanceof Error ? err.message : String(err));
    return;
  }

  // Step 3: Deploy Worker
  console.log("🌐 Deploying Worker...");
  try {
    execSync("wrangler deploy", {
      cwd: WORKER_DIR,
      stdio: "inherit",
    });
    console.log("✅ Worker deployed\n");
  } catch (err) {
    console.error("❌ Failed to deploy Worker:", err instanceof Error ? err.message : String(err));
    return;
  }

  // Get Worker URL from wrangler
  let workerUrl: string | undefined;
  try {
    const output = execSync("wrangler info", { cwd: WORKER_DIR, encoding: "utf8" });
    // Try to extract URL from wrangler output
    const match = output.match(/https:\/\/[^\s]+\.workers\.dev/);
    if (match) workerUrl = match[0];
  } catch {
    // ignore
  }

  if (!workerUrl) {
    console.log("⚠️  Could not auto-detect Worker URL.");
    console.log("   Check your Cloudflare dashboard or wrangler output.\n");
  } else {
    console.log(`✅ Worker URL: ${workerUrl}\n`);
  }

  // Step 4: Set secrets
  console.log("🔐 Setting Worker secrets...");
  console.log("   You'll need to enter these interactively.\n");

  console.log("   Setting REMOTE_AUTH_SECRET...");
  console.log("   (Enter a strong random string, or press Enter to generate one)");
  // We can't easily do interactive input here, so we document it
  console.log("   Run: cd remote/worker && wrangler secret put REMOTE_AUTH_SECRET\n");

  console.log("   Setting CF_API_TOKEN...");
  console.log("   (Create at https://dash.cloudflare.com/profile/api-tokens with Workers AI + Account read)");
  console.log("   Run: cd remote/worker && wrangler secret put CF_API_TOKEN\n");

  // Step 5: Build and push container
  console.log("🐳 Building container image...");
  const imageTag = "ghcr.io/sinameraji/kimiflare-remote-agent:latest";
  try {
    execSync(`docker build -t ${imageTag} .`, {
      cwd: REMOTE_DIR,
      stdio: "inherit",
    });
    console.log("✅ Image built\n");
  } catch (err) {
    console.error("❌ Failed to build image:", err instanceof Error ? err.message : String(err));
    return;
  }

  console.log(`📤 Pushing image to ${imageTag}...`);
  console.log("   (Make sure you're logged into ghcr.io: docker login ghcr.io -u USERNAME)");
  try {
    execSync(`docker push ${imageTag}`, {
      cwd: REMOTE_DIR,
      stdio: "inherit",
    });
    console.log("✅ Image pushed\n");
  } catch (err) {
    console.error("❌ Failed to push image:", err instanceof Error ? err.message : String(err));
    console.log("   You may need to authenticate with GitHub Container Registry first.\n");
    return;
  }

  // Step 6: Save config
  if (workerUrl) {
    const cfg = (await loadConfig()) ?? {
      accountId: "",
      apiToken: "",
      model: "@cf/moonshotai/kimi-k2.6",
    };
    await saveConfig({
      ...cfg,
      remoteWorkerUrl: workerUrl,
    });
    console.log(`💾 Saved remoteWorkerUrl to config\n`);
  }

  console.log("🎉 Deployment complete!");
  console.log("\nNext steps:");
  console.log("  1. Set the Worker secrets (see above)");
  console.log("  2. Authenticate with GitHub: kimiflare auth github");
  console.log("  3. Set the auth secret in config: kimiflare config remoteAuthSecret YOUR_SECRET");
  console.log("  4. Start a session: kimiflare → /remote <prompt>\n");
}
