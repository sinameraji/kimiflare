#!/usr/bin/env node
/**
 * kimiflare Remote Agent
 * Headless agent that runs inside a Cloudflare Sandbox.
 */

import { execSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { runAgentTurn } from "../../../src/agent/loop.js";
import { buildSystemPrompt } from "../../../src/agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS } from "../../../src/tools/executor.js";
import type { ChatMessage } from "../../../src/agent/messages.js";
import { createProgressReporter, postFinalize } from "./progress-reporter.js";

const SESSION_ID = process.env.SESSION_ID ?? "unknown";
const ARTIFACTS_URL = process.env.ARTIFACTS_URL ?? "";
const ARTIFACTS_TOKEN = process.env.ARTIFACTS_TOKEN ?? "";
const WORKER_RELAY_URL = process.env.WORKER_RELAY_URL ?? "";
const PROGRESS_URL = process.env.PROGRESS_URL ?? "";
const FINALIZE_URL = process.env.FINALIZE_URL ?? "";
const REPO_OWNER = process.env.REPO_OWNER ?? "";
const REPO_NAME = process.env.REPO_NAME ?? "";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? `kimiflare/remote/${SESSION_ID}`;
const PROMPT = process.env.PROMPT ?? "Do something useful";
const MODEL = process.env.MODEL ?? "@cf/moonshotai/kimi-k2.6";
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? "50", 10);
const REASONING_EFFORT = (process.env.REASONING_EFFORT ?? "medium") as "low" | "medium" | "high";
const ACCOUNT_ID = process.env.ACCOUNT_ID ?? "";
const API_TOKEN = process.env.API_TOKEN ?? "";

const WORKSPACE = "/workspace";

function logInfo(msg: string): void {
  console.log(JSON.stringify({ type: "info", message: msg }));
}

function logError(msg: string): void {
  console.log(JSON.stringify({ type: "error", message: msg }));
}

function setupGit(): void {
  execSync("git config --global user.email 'kimiflare@proton.me'");
  execSync("git config --global user.name 'kimiflare'");
}

function cloneRepo(): void {
  if (!ARTIFACTS_URL || !ARTIFACTS_TOKEN) {
    throw new Error("ARTIFACTS_URL and ARTIFACTS_TOKEN must be set");
  }
  const authUrl = ARTIFACTS_URL.replace("https://", `https://token:${ARTIFACTS_TOKEN}@`);
  execSync(`git clone ${authUrl} ${WORKSPACE}`, { stdio: "inherit" });
}

function createBranch(): void {
  execSync(`git checkout -b ${GITHUB_BRANCH}`, { cwd: WORKSPACE });
}

function gitCommit(message: string): void {
  try {
    execSync("git add -A", { cwd: WORKSPACE });
    execSync(`git commit -m "${message}" --no-verify`, { cwd: WORKSPACE });
  } catch {
    // No changes to commit
  }
}

function pushRepo(): void {
  if (!ARTIFACTS_URL || !ARTIFACTS_TOKEN) return;
  const authUrl = ARTIFACTS_URL.replace("https://", `https://token:${ARTIFACTS_TOKEN}@`);
  execSync(`git push ${authUrl} ${GITHUB_BRANCH}`, { cwd: WORKSPACE });
}

async function runRemoteAgent(): Promise<void> {
  logInfo(`Starting remote session ${SESSION_ID}`);
  logInfo(`Model: ${MODEL}`);
  logInfo(`Max turns: ${MAX_TURNS}`);

  setupGit();

  if (!existsSync(WORKSPACE)) {
    mkdirSync(WORKSPACE, { recursive: true });
  }

  // Check if workspace is empty
  const workspaceFiles = execSync("ls -A", { cwd: WORKSPACE, encoding: "utf8" });
  if (workspaceFiles.trim().length === 0) {
    logInfo("Cloning repository...");
    cloneRepo();
  } else {
    logInfo("Workspace already populated, skipping clone");
  }

  // Create or checkout branch
  try {
    execSync(`git checkout -b ${GITHUB_BRANCH}`, { cwd: WORKSPACE });
    logInfo(`Created branch ${GITHUB_BRANCH}`);
  } catch {
    execSync(`git checkout ${GITHUB_BRANCH}`, { cwd: WORKSPACE });
    logInfo(`Checked out existing branch ${GITHUB_BRANCH}`);
  }

  // Detect project type and run setup
  await runProjectSetup();

  const tools = ALL_TOOLS;
  const executor = new ToolExecutor(tools);
  const callbacks = createProgressReporter();

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        cwd: WORKSPACE,
        tools,
        model: MODEL,
        mode: "auto",
      }),
    },
    {
      role: "user",
      content: PROMPT,
    },
  ];

  const controller = new AbortController();

  // Handle SIGTERM gracefully
  process.on("SIGTERM", () => {
    logInfo("Received SIGTERM, shutting down gracefully...");
    controller.abort();
  });

  // Heartbeat to keep Sandbox warm
  const heartbeat = setInterval(() => {
    console.log(JSON.stringify({ type: "heartbeat" }));
  }, 60000);

  try {
    await runAgentTurn({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      model: MODEL,
      messages,
      tools,
      executor,
      cwd: WORKSPACE,
      signal: controller.signal,
      callbacks,
      maxToolIterations: MAX_TURNS,
      reasoningEffort: REASONING_EFFORT,
      coauthor: { name: "kimiflare", email: "kimiflare@proton.me" },
      sessionId: SESSION_ID,
    });

    logInfo("Agent loop completed");
    gitCommit(`feat: ${PROMPT.slice(0, 50)}`);
    pushRepo();
    logInfo("Pushed to Artifacts repo");

    await postFinalize(FINALIZE_URL, SESSION_ID, PROMPT, 1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`Agent error: ${message}`);
    gitCommit(`wip: ${PROMPT.slice(0, 50)} (interrupted)`);
    pushRepo();
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}

async function runProjectSetup(): Promise<void> {
  const packageJsonPath = join(WORKSPACE, "package.json");
  const cargoTomlPath = join(WORKSPACE, "Cargo.toml");
  const requirementsPath = join(WORKSPACE, "requirements.txt");
  const setupScriptPath = join(WORKSPACE, ".kimiflare", "remote-setup.sh");

  if (existsSync(setupScriptPath)) {
    logInfo("Running custom setup script...");
    execSync(`bash ${setupScriptPath}`, { cwd: WORKSPACE, stdio: "inherit" });
    return;
  }

  if (existsSync(packageJsonPath)) {
    logInfo("Detected Node.js project, running npm install...");
    execSync("npm install", { cwd: WORKSPACE, stdio: "inherit" });
    return;
  }

  if (existsSync(cargoTomlPath)) {
    logInfo("Detected Rust project, running cargo fetch...");
    execSync("cargo fetch", { cwd: WORKSPACE, stdio: "inherit" });
    return;
  }

  if (existsSync(requirementsPath)) {
    logInfo("Detected Python project, running pip install...");
    execSync("pip install -r requirements.txt", { cwd: WORKSPACE, stdio: "inherit" });
    return;
  }

  logInfo("No project setup detected");
}

runRemoteAgent().then(
  () => {
    logInfo("Remote agent finished successfully");
    process.exit(0);
  },
  (err) => {
    logError(`Remote agent failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
