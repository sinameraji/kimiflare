import { Command } from "commander";
import { loadConfig, DEFAULT_MODEL } from "./config.js";
import { resolveLspConfig } from "./util/lsp-config.js";
import { runAgentTurn, BudgetExhaustedError } from "./agent/loop.js";
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
  .option("--dangerously-allow-all", "auto-approve every permission prompt (print mode only)")
  .option("--reasoning", "include reasoning in stdout (print mode only)")
  .option("--continue-on-limit", "reset tool-call counter and continue when the 50-call limit is hit (print mode only)")
  .option("--max-input-tokens <n>", "cumulative prompt token budget; exits 42 when exhausted (print mode only)", (v) => parseInt(v, 10));

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
  );

program.action(async () => {
  await main();
});
program.parse();

const opts = program.opts<{
  print?: string;
  model?: string;
  dangerouslyAllowAll?: boolean;
  reasoning?: boolean;
  continueOnLimit?: boolean;
  maxInputTokens?: number;
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

  if (opts.print !== undefined) {
    if (!cfg) {
      console.error(
        "kimiflare: missing credentials.\n" +
          "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or write them to\n" +
          "  ~/.config/kimiflare/config.json  (chmod 600)\n" +
          "  { \"accountId\": \"...\", \"apiToken\": \"...\", \"model\": \"@cf/moonshotai/kimi-k2.6\" }",
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
    await renderApp({ ...cfg, model }, updateResult, lspScope, lspProjectPath);
  } else {
    await renderApp(null, updateResult, lspScope, lspProjectPath);
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
    throw err;
  }

  process.stdout.write("\n");
}


