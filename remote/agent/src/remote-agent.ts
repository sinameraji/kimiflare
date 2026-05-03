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
import { createHeadlessPermissionHandler } from "./headless-permission.js";

const SESSION_ID = process.env.SESSION_ID ?? "unknown";
const ARTIFACTS_URL = process.env.ARTIFACTS_URL ?? "";
const ARTIFACTS_TOKEN = process.env.ARTIFACTS_TOKEN ?? "";
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

function pushRepo(): void {
  if (!ARTIFACTS_URL || !ARTIFACTS_TOKEN) return;
  const authUrl = ARTIFACTS_URL.replace("https://", `https://token:${ARTIFACTS_TOKEN}@`);
  execSync(`git push ${authUrl} ${GITHUB_BRANCH}`, { cwd: WORKSPACE });
}

function hasChanges(): boolean {
  try {
    const status = execSync("git status --porcelain", { cwd: WORKSPACE, encoding: "utf8" });
    return status.trim().length > 0;
  } catch {
    return false;
  }
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
  try {
    const workspaceFiles = execSync("ls -A", { cwd: WORKSPACE, encoding: "utf8" });
    if (workspaceFiles.trim().length === 0) {
      logInfo("Cloning repository...");
      cloneRepo();
    } else {
      logInfo("Workspace already populated, skipping clone");
    }
  } catch {
    logInfo("Cloning repository...");
    cloneRepo();
  }

  // Create or checkout branch
  try {
    execSync(`git checkout -b ${GITHUB_BRANCH}`, { cwd: WORKSPACE });
    logInfo(`Created branch ${GITHUB_BRANCH}`);
  } catch {
    execSync(`git checkout ${GITHUB_BRANCH}`, { cwd: WORKSPACE });
    logInfo(`Checked out existing branch ${GITHUB_BRANCH}`);
  }

  const tools = ALL_TOOLS;
  const executor = new ToolExecutor(tools);
  const callbacks = createProgressReporter();
  const permissionHandler = createHeadlessPermissionHandler();

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

  let exitCode = 0;
  let errorLog = "";

  try {
    await runAgentTurn({
      messages,
      tools,
      executor,
      model: MODEL,
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      reasoningEffort: REASONING_EFFORT,
      maxToolIterations: MAX_TURNS,
      continueOnLimit: true,
      maxInputTokens: 5_000_000,
      onToolCall: async (name, args) => {
        await callbacks.onToolCall(name, args);
      },
      onToolResult: async (name, result) => {
        await callbacks.onToolResult(name, result);
      },
      onUsage: async (usage) => {
        await callbacks.onUsage(usage.prompt_tokens, usage.completion_tokens);
      },
      permissionHandler,
    });

    logInfo("Agent completed successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errorLog = message;
    logError(`Agent error: ${message}`);

    // Check if it's a budget exhaustion error
    if (message.includes("budget") || message.includes("BudgetExhaustedError")) {
      exitCode = 42;
    } else {
      exitCode = 1;
    }
  }

  // Commit and push changes
  const changesExist = hasChanges();
  if (changesExist) {
    logInfo("Committing changes...");
    try {
      execSync("git add -A", { cwd: WORKSPACE });
      execSync(`git commit -m "kimiflare remote: ${PROMPT.slice(0, 80)}" --no-verify`, { cwd: WORKSPACE });
      pushRepo();
      logInfo("Changes pushed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`Git error: ${message}`);
    }
  } else {
    logInfo("No changes to commit");
  }

  // Report finalization
  await postFinalize({
    exitCode,
    hasChanges: changesExist,
    errorLog: errorLog || undefined,
  });

  process.exit(exitCode);
}

runRemoteAgent().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logError(`Fatal error: ${message}`);
  postFinalize({ exitCode: 1, hasChanges: false, errorLog: message }).finally(() => {
    process.exit(1);
  });
});
