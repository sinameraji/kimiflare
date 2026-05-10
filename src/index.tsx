import { Command } from "commander";
import { loadConfig, DEFAULT_MODEL } from "./config.js";
import { resolveLspConfig } from "./util/lsp-config.js";
import { runAgentTurn, BudgetExhaustedError, AgentLoopError } from "./agent/loop.js";
import { KimiApiError, humanizeCloudflareError } from "./util/errors.js";
import type { AiGatewayOptions } from "./agent/client.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS } from "./tools/executor.js";
import type { ChatMessage } from "./agent/messages.js";
import { checkForUpdate } from "./util/update-check.js";
import type { UpdateCheckResult } from "./util/update-check.js";
import { getAppVersion } from "./util/version.js";
import { createRemoteCommand } from "./remote/cli.js";

const program = new Command();
program
  .name("kimiflare")
  .description("Terminal coding agent powered by Kimi-K2.6 on Cloudflare Workers AI.")
  .version(getAppVersion())
  .option("-p, --print <prompt>", "one-shot mode: send prompt, stream reply to stdout, exit")
  .option("-m, --model <id>", "model id (defaults to @cf/moonshotai/kimi-k2.6)")
  .option("--cloud", "use Kimiflare Cloud (api.kimiflare.com) instead of direct Workers AI")
  .option("--dangerously-allow-all", "auto-approve every permission prompt (print mode only)")
  .option("--reasoning", "include reasoning in stdout (print mode only)")
  .option("--continue-on-limit", "reset tool-call counter and continue when the 50-call limit is hit (print mode only)")
  .option("--max-input-tokens <n>", "cumulative prompt token budget; exits 42 when exhausted (print mode only)", (v) => parseInt(v, 10))
  .option("--mode <mode>", "run mode: interactive (default), print, rpc");

program
  .command("cost")
  .description("Show cost attribution by task type (requires costAttribution enabled)")
  .option("-w, --week", "last 7 days (default)")
  .option("-m, --month", "last 30 days")
  .option("-d, --day", "today only")
  .option("-s, --session <id>", "single session detail")
  .option("-c, --category <name>", "filter by category")
  .option("--json", "machine-readable output")
  .option("--reclassify", "re-run classification on all sessions")
  .option("--local-only", "skip Cloudflare reconciliation")
  .action(async (cmdOpts) => {
    const cfg = await loadConfig();
    const enabled = cfg?.costAttribution ?? false;
    if (!enabled) {
      console.error(
        "Cost attribution is disabled. Enable it with:\n" +
          "  KIMI_COST_ATTRIBUTION=1 kimiflare cost\n" +
          "Or add costAttribution: true to ~/.config/kimiflare/config.json",
      );
      process.exit(1);
    }

    const { runCostCommand } = await import("./cost-attribution/cli.js");
    await runCostCommand({ ...cmdOpts, config: cfg });
  });

program
  .command("usage")
  .description("Show Kimiflare Cloud token usage (requires cloud authentication)")
  .action(async () => {
    const { loadCloudCredentials } = await import("./cloud/auth.js");
    const creds = await loadCloudCredentials();
    if (!creds) {
      console.error("Not authenticated with Kimiflare Cloud. Run: kimiflare auth cloud");
      process.exit(1);
    }
    const { fetchCloudUsage } = await import("./cloud/auth.js");
    const usage = await fetchCloudUsage(creds.accessToken, creds.deviceId);
    if (!usage) {
      console.error("Failed to fetch usage: invalid response from server");
      process.exit(1);
    }
    console.log(`Token budget: ${usage.remaining.toLocaleString()} / ${usage.input_token_limit.toLocaleString()} remaining`);
    console.log(`Used: ${usage.input_tokens_used.toLocaleString()}`);
    console.log(`Grant expires: ${usage.expires_at}`);
  });

program.addCommand(createRemoteCommand());

program
  .command("auth")
  .description("Authenticate with external services")
  .addCommand(
    new Command("github")
      .description("Authenticate with GitHub via OAuth device flow")
      .action(async () => {
        const { authGitHubForTui } = await import("./remote/tui-auth.js");
        for await (const step of authGitHubForTui()) {
          console.log(step.message);
          if (step.url && step.code) {
            console.log(`\nOpen: ${step.url}`);
            console.log(`Code: ${step.code}\n`);
          }
          if (step.done) break;
          if (step.error) process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("cloud")
      .description("Authenticate with Kimiflare Cloud")
      .action(async () => {
        const { authenticateDevice } = await import("./cloud/auth.js");
        try {
          const creds = await authenticateDevice(({ url, userCode, polling }) => {
            if (!polling) {
              console.log(`\nKimiflare Cloud Authentication`);
              console.log(`\n1. Open this URL in your browser:`);
              console.log(`   ${url}`);
              console.log(`\n2. Sign in with GitHub or Email\n`);
            }
          });
          console.log(`Authenticated! Token expires at ${new Date(creds.expiresAt * 1000).toISOString()}`);

          // Fetch usage info
          const { fetchCloudUsage } = await import("./cloud/auth.js");
          const usage = await fetchCloudUsage(creds.accessToken, creds.deviceId);
          if (usage) {
            console.log(`\nToken budget: ${usage.remaining.toLocaleString()} / ${usage.input_token_limit.toLocaleString()} remaining`);
            console.log(`Grant expires: ${usage.expires_at}`);
          }
        } catch (err) {
          console.error("Authentication failed:", err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }),
  );

program.action(async () => {
  await main();
});
program.parse();

const opts = program.opts<{
  print?: string;
  model?: string;
  cloud?: boolean;
  dangerouslyAllowAll?: boolean;
  reasoning?: boolean;
  continueOnLimit?: boolean;
  maxInputTokens?: number;
  mode?: string;
}>();

async function main() {
  const globalCfg = await loadConfig();
  const updateResult = await checkForUpdate();

  let cfg = globalCfg;
  let lspScope: "project" | "global" = "global";
  let lspProjectPath: string | null = null;

  if (globalCfg) {
    const resolved = await resolveLspConfig(globalCfg, process.cwd());
    cfg = {
      ...globalCfg,
      lspEnabled: resolved.lspEnabled,
      lspServers: resolved.lspServers,
    };
    lspScope = resolved.scope;
    lspProjectPath = resolved.projectPath;
  }

  // Handle cloud mode
  const cloudMode = opts.cloud ?? cfg?.cloudMode ?? false;
  let cloudToken: string | undefined;
  let cloudDeviceId: string | undefined;
  if (cloudMode) {
    const { loadCloudCredentials, authenticateDevice } = await import("./cloud/auth.js");
    let cloudCreds = await loadCloudCredentials();
    if (!cloudCreds) {
      console.error("kimiflare: cloud mode requires authentication.\nRun: kimiflare auth cloud\n");
      process.exit(2);
    }
    cloudToken = cloudCreds.accessToken;
    cloudDeviceId = cloudCreds.deviceId;
    cfg = {
      ...(cfg ?? { accountId: "", apiToken: "", model: DEFAULT_MODEL }),
      cloudMode: true,
    };
  }

  if (opts.mode === "rpc") {
    const { startRpcServer } = await import("./sdk/rpc.js");
    await startRpcServer();
    return;
  }

  if (opts.print !== undefined) {
    if (!cfg) {
      console.error(
        "kimiflare: missing credentials.\n" +
          "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or write them to\n" +
          "  ~/.config/kimiflare/config.json  (chmod 600)\n" +
          "  { \"accountId\": \"...\", \"apiToken\": \"...\", \"model\": \"@cf/moonshotai/kimi-k2.6\" }\n" +
          "Or use cloud mode: kimiflare --cloud -p \"...\"",
      );
      process.exit(2);
    }
    const model = opts.model ?? cfg.model ?? DEFAULT_MODEL;
    await runPrintMode({
      ...cfg,
      model,
      prompt: opts.print,
      allowAll: !!opts.dangerouslyAllowAll,
      showReasoning: !!opts.reasoning,
      codeMode: cfg.codeMode,
      cloudToken,
      cloudDeviceId,
      continueOnLimit: !!opts.continueOnLimit,
      maxInputTokens: opts.maxInputTokens,
      updateResult,
    });
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      "kimiflare: interactive mode requires a TTY. Use `kimiflare -p \"...\"` for non-TTY / piped usage.",
    );
    process.exit(2);
  }

  const { renderApp } = await import("./app.js");
  if (cfg) {
    const model = opts.model ?? cfg.model ?? DEFAULT_MODEL;
    await renderApp({ ...cfg, model }, updateResult, lspScope, lspProjectPath, cloudToken, cloudDeviceId);
  } else {
    await renderApp(null, updateResult, lspScope, lspProjectPath, cloudToken, cloudDeviceId);
  }
}

interface PrintOpts {
  accountId: string;
  apiToken: string;
  model: string;
  prompt: string;
  allowAll: boolean;
  showReasoning: boolean;
  coauthor?: boolean;
  coauthorName?: string;
  coauthorEmail?: string;
  aiGatewayId?: string;
  aiGatewayCacheTtl?: number;
  aiGatewaySkipCache?: boolean;
  aiGatewayCollectLogPayload?: boolean;
  aiGatewayMetadata?: Record<string, string | number | boolean>;
  updateResult: UpdateCheckResult;
  codeMode?: boolean;
  continueOnLimit?: boolean;
  maxInputTokens?: number;
  cloudMode?: boolean;
  cloudToken?: string;
  cloudDeviceId?: string;
}

function gatewayFromPrintOpts(opts: PrintOpts): AiGatewayOptions | undefined {
  if (!opts.aiGatewayId) return undefined;
  return {
    id: opts.aiGatewayId,
    cacheTtl: opts.aiGatewayCacheTtl,
    skipCache: opts.aiGatewaySkipCache,
    collectLogPayload: opts.aiGatewayCollectLogPayload,
    metadata: opts.aiGatewayMetadata,
  };
}

async function runPrintMode(opts: PrintOpts): Promise<void> {
  if (opts.cloudMode) {
    process.stderr.write(`[cloud mode: api.kimiflare.com]\n`);
  }
  if (opts.updateResult.hasUpdate) {
    process.stderr.write(
      `\x1b[33mkimiflare update available: ${opts.updateResult.localVersion} → ${opts.updateResult.latestVersion}\x1b[0m\n` +
        `\x1b[33m  npm update -g kimiflare  then restart\x1b[0m\n\n`,
    );
  }

  const cwd = process.cwd();
  const executor = new ToolExecutor(ALL_TOOLS);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ cwd, tools: ALL_TOOLS, model: opts.model }) },
    { role: "user", content: opts.prompt },
  ];

  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());

  let printedReasoningHeader = false;
  let printedAnswerHeader = false;

  try {
    await runAgentTurn({
      accountId: opts.accountId,
      apiToken: opts.apiToken,
      model: opts.model,
      gateway: gatewayFromPrintOpts(opts),
      messages,
      tools: ALL_TOOLS,
      executor,
      cwd,
      signal: controller.signal,
      codeMode: opts.codeMode,
      continueOnLimit: opts.continueOnLimit,
      maxInputTokens: opts.maxInputTokens,
      cloudMode: opts.cloudMode,
      cloudToken: opts.cloudToken,
      cloudDeviceId: opts.cloudDeviceId,
      coauthor:
        opts.coauthor !== false
          ? { name: opts.coauthorName || "kimiflare", email: opts.coauthorEmail || "kimiflare@proton.me" }
          : undefined,
      callbacks: {
        onReasoningDelta: opts.showReasoning
          ? (delta) => {
              if (!printedReasoningHeader) {
                process.stderr.write("\x1b[2m--- reasoning ---\n");
                printedReasoningHeader = true;
              }
              process.stderr.write(delta);
            }
          : undefined,
        onTextDelta: (delta) => {
          if (opts.showReasoning && printedReasoningHeader && !printedAnswerHeader) {
            process.stderr.write("\n--- answer ---\x1b[0m\n");
            printedAnswerHeader = true;
          }
          process.stdout.write(delta);
        },
        onToolCallFinalized: (call) => {
          process.stderr.write(`\x1b[2m[tool ${call.function.name}(${call.function.arguments})]\x1b[0m\n`);
        },
        onToolResult: (result) => {
          const snippet =
            result.content.length > 400 ? result.content.slice(0, 400) + "..." : result.content;
          process.stderr.write(`\x1b[2m[result: ${snippet.replace(/\n/g, " ⏎ ")}]\x1b[0m\n`);
        },
        askPermission: async ({ tool, args }) => {
          if (opts.allowAll) return "allow";
          process.stderr.write(
            `\x1b[31m[permission denied: ${tool.name}(${JSON.stringify(args)}) — pass --dangerously-allow-all to approve in print mode]\x1b[0m\n`,
          );
          return "deny";
        },
      },
    });
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      process.stderr.write("\n\x1b[33m[Budget exhausted — exiting with code 42]\x1b[0m\n");
      process.exitCode = 42;
      return;
    }
    if (err instanceof AgentLoopError) {
      process.stderr.write("\n\x1b[33m[Agent loop detected — exiting with code 43]\x1b[0m\n");
      process.exitCode = 43;
      return;
    }
    if (err instanceof KimiApiError) {
      process.stderr.write(`\n\x1b[31mError: ${humanizeCloudflareError(err)}\x1b[0m\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  process.stdout.write("\n");
}


