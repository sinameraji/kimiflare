import { Command } from "commander";
import { loadConfig, saveConfig, DEFAULT_MODEL } from "./config.js";
import { resolveLspConfig } from "./util/lsp-config.js";
import { runAgentTurn, BudgetExhaustedError, AgentLoopError } from "./agent/loop.js";
import { KimiApiError, isKillSwitchError, humanizeCloudflareError } from "./util/errors.js";
import type { AiGatewayOptions } from "./agent/client.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS } from "./tools/executor.js";
import type { ChatMessage } from "./agent/messages.js";
import { checkForUpdate } from "./util/update-check.js";
import type { UpdateCheckResult } from "./util/update-check.js";
import { getAppVersion } from "./util/version.js";
import { createRemoteCommand } from "./remote/cli.js";
import { renderLogo } from "./ui/logo.js";

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
  .option("--emit-events", "emit Camouflage NDJSON events to stdout; requires -p (for initial prompt)")
  .option("--multi-turn", "with --emit-events: keep reading stdin for UserInputSubmitted follow-ups after the initial turn")
  .option("--ui <name>", "render UI with the given engine: `ink` (default, stable) or `camouflage` (experimental Rust TUI). Can also be set via the KIMIFLARE_UI environment variable.")
  .option("--camouflage-bin <path>", "with --ui camouflage: path to the camouflage-tui binary (defaults to PATH lookup)")
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
    console.log("Or when the global pool of free tokens runs out.");
  });

program.addCommand(createRemoteCommand());

const logsCmd = program
  .command("logs")
  .description("Inspect KimiFlare's structured logs (jsonl, one file per day, 7-day retention)");

logsCmd
  .command("path")
  .description("Print today's log file path. Useful for tailing: tail -f $(kimiflare logs path) | jq")
  .action(async () => {
    const { logPathFor } = await import("./util/log-sink.js");
    console.log(logPathFor());
  });

logsCmd
  .command("dir")
  .description("Print the log directory")
  .action(async () => {
    const { logDir } = await import("./util/log-sink.js");
    console.log(logDir());
  });

logsCmd
  .command("prune")
  .description("Delete log files older than 7 days")
  .action(async () => {
    const { pruneOldLogs } = await import("./util/log-sink.js");
    const removed = pruneOldLogs();
    console.log(`pruned ${removed} log files`);
  });

program
  .command("resume")
  .description("Pick a session to resume via Camouflage's SelectList primitive (CC-1 demo). Prints chosen session id on stdout, exits 1 on cancel.")
  .option("--limit <n>", "max recent sessions to list", (v) => parseInt(v, 10), 20)
  .option("--camouflage-bin <path>", "path to camouflage-tui (defaults to PATH lookup)")
  .action(async (cmdOpts, command) => {
    // `--camouflage-bin` is also declared at the top-level program (for
    // `--ui camouflage` mode), so commander parses the flag against the
    // parent and never stores it on the subcommand's cmdOpts. Fall back
    // to the parent's value when the subcommand-level one is undefined.
    const parentOpts = command?.parent?.opts() ?? {};
    const bin = cmdOpts.camouflageBin ?? parentOpts.camouflageBin;
    const { runCamouflageResume } = await import("./camouflage-resume.js");
    await runCamouflageResume({
      limit: cmdOpts.limit,
      camouflageBin: bin,
    });
  });

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

          // Also enable cloud mode in config so the user doesn't need --cloud on every run
          const existing = await loadConfig();
          await saveConfig({
            accountId: "",
            apiToken: "",
            model: existing?.model ?? DEFAULT_MODEL,
            cloudMode: true,
          });

          // Fetch usage info
          const { fetchCloudUsage } = await import("./cloud/auth.js");
          const usage = await fetchCloudUsage(creds.accessToken, creds.deviceId);
          if (usage) {
            console.log(`\nToken budget: ${usage.remaining.toLocaleString()} / ${usage.input_token_limit.toLocaleString()} remaining`);
            console.log(`Grant expires: ${usage.expires_at}`);
            console.log("Or when the global pool of free tokens runs out.");
          }
        } catch (err) {
          if (isKillSwitchError(err)) {
            console.error(
              "\nKimiFlare Cloud has reached its maximum budget across all users.\n" +
                "The free credits period has ended.\n\n" +
                "To continue using KimiFlare, switch to BYOK mode:\n" +
                "  • kimiflare config set-key <your-cloudflare-api-key>\n" +
                "  • kimiflare config set-account <your-account-id>\n" +
                "  • Or re-run kimiflare and select BYOK\n",
            );
            process.exit(0);
          }
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
  emitEvents?: boolean;
  multiTurn?: boolean;
  ui?: string;
  camouflageBin?: string;
  mode?: string;
}>();

async function main() {
  // Initialize the OTLP/HTTP log exporter if `KIMIFLARE_OTEL_ENDPOINT`
  // is set. No-op otherwise — the env-var gate keeps this zero-cost for
  // users who don't care. Done before loadConfig so any early errors
  // ship too.
  const { initOtelSink, installOtelExitHook } = await import("./util/otel-sink.js");
  if (initOtelSink()) {
    installOtelExitHook();
  }

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

    // Proactive health check: detect kill switch early before the first prompt
    try {
      const { fetchCloudUsage } = await import("./cloud/auth.js");
      await fetchCloudUsage(cloudToken, cloudDeviceId);
    } catch (err) {
      if (isKillSwitchError(err)) {
        console.error(
          "\nKimiFlare Cloud has reached its maximum budget across all users.\n" +
            "The free credits period has ended.\n\n" +
            "To continue using KimiFlare, switch to BYOK mode:\n" +
            "  • kimiflare config set-key <your-cloudflare-api-key>\n" +
            "  • kimiflare config set-account <your-account-id>\n" +
            "  • Or re-run kimiflare and select BYOK\n",
        );
        process.exit(0);
      }
      // Other errors (network, etc.) — don't block, let it retry on first request
    }

    cfg = {
      ...(cfg ?? { accountId: "", apiToken: "", model: DEFAULT_MODEL, memoryEnabled: false }),
      cloudMode: true,
    };
  }

  if (opts.mode === "rpc") {
    const { startRpcServer } = await import("./sdk/rpc.js");
    await startRpcServer();
    return;
  }

  // (`--ui camouflage` is opt-in experimental; the camouflage branch lives at
  // the bottom of `main()` next to the Ink path so both share the TTY guard
  // + cfg checks. Default is `ink` until Camouflage covers every surface and
  // we've burned-in via opt-in dogfooding.)

  if (opts.emitEvents) {
    if (opts.print === undefined) {
      console.error(
        "kimiflare: --emit-events requires -p \"<prompt>\" (one-shot mode).\n" +
          "Multi-turn stdin-driven emit mode is not yet implemented.",
      );
      process.exit(2);
    }
    if (!cfg) {
      console.error("kimiflare: --emit-events requires credentials (config or --cloud).");
      process.exit(2);
    }
    const model = opts.model ?? cfg.model ?? DEFAULT_MODEL;
    const { runEmitMode } = await import("./emit-mode.js");
    await runEmitMode({
      accountId: cfg.accountId,
      apiToken: cfg.apiToken,
      model,
      prompt: opts.print,
      allowAll: !!opts.dangerouslyAllowAll,
      multiTurn: !!opts.multiTurn,
      codeMode: cfg.codeMode,
      continueOnLimit: !!opts.continueOnLimit,
      maxInputTokens: opts.maxInputTokens,
      cloudMode,
      cloudToken,
      cloudDeviceId,
    });
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

  // ANSI logo. For the Ink path we still console.log it as part of the
  // pre-render output. For the Camouflage path we hand it to the
  // renderer as a Splash event so it stays visible until the user's
  // first prompt — console.log here would get swallowed by Camouflage's
  // alt-screen and flash for a fraction of a second.
  const logoText = renderLogo(getAppVersion());

  // UI engine resolution: `--ui` flag wins, then `KIMIFLARE_UI` env var, then
  // the safe default (`ink`). Camouflage is opt-in experimental until it
  // covers every surface (queue, hooks, mode switching, MCP UI, etc.) and
  // gets enough burn-in via dogfooding. Users who like it can set
  // `export KIMIFLARE_UI=camouflage` once instead of typing `--ui` each time.
  const uiEngine = (opts.ui ?? process.env.KIMIFLARE_UI ?? "ink").toLowerCase();
  if (uiEngine !== "camouflage") {
    console.log(logoText);
  }
  if (uiEngine === "camouflage") {
    // Loud warning that this is experimental and how to bail. Printed
    // before Camouflage takes the alt-screen so it lands in scrollback;
    // also emitted as a persistent warn-toast inside the TUI itself
    // (see ui-mode.ts) so the user sees it even if scrollback was
    // cleared.
    process.stderr.write(
      "\n\x1b[1;33m⚠  Camouflage UI is experimental.\x1b[0m\n" +
        "   If anything looks broken, switch back any time with:\n" +
        "     \x1b[1mkimiflare --ui ink\x1b[0m\n" +
        "   or unset KIMIFLARE_UI if you've exported it.\n" +
        "   Report issues at https://github.com/sinameraji/camouflage/issues\n\n",
    );
    // Brief pause so the warning isn't wiped off the alt-screen
    // before the user reads it.
    await new Promise((r) => setTimeout(r, 1200));
    if (!cfg) {
      // Run Camouflage-native onboarding (ports the Ink Onboarding flow).
      // On cancel/exit, the user falls back to the env-var path or
      // `--ui ink` for the legacy onboarding.
      const { runCamouflageOnboarding } = await import("./ui-mode.js");
      const saved = await runCamouflageOnboarding({ camouflageBin: opts.camouflageBin });
      if (!saved) {
        console.error(
          "kimiflare: onboarding cancelled.\n" +
            "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or run again to retry.\n" +
            "Default Ink onboarding: `kimiflare` (no flag).",
        );
        process.exit(2);
      }
      cfg = saved;
    }
    const model = opts.model ?? cfg.model ?? DEFAULT_MODEL;
    const { runUiMode } = await import("./ui-mode.js");
    await runUiMode({
      accountId: cfg.accountId,
      apiToken: cfg.apiToken,
      model,
      // Optional: -p seeds an initial prompt; otherwise the user types into
      // the renderer's input box.
      prompt: opts.print,
      allowAll: !!opts.dangerouslyAllowAll,
      codeMode: cfg.codeMode,
      continueOnLimit: !!opts.continueOnLimit,
      maxInputTokens: opts.maxInputTokens,
      cloudMode,
      cloudToken,
      cloudDeviceId,
      camouflageBin: opts.camouflageBin,
      splash: logoText,
    });
    return;
  }
  // Legacy Ink UI fallback (`--ui ink`).
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
  // M6.1: print mode loads the same hooks as the TUI. Audit / guard /
  // notification hooks fire in CI runs too — that's the case where
  // they matter most.
  const { HooksManager } = await import("./hooks/manager.js");
  const hooks = new HooksManager(cwd);
  const executor = new ToolExecutor(ALL_TOOLS, { hooks });
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
      hooks, // M6.1: Stop fires at end of print-mode turn too.
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
        onWarning: (msg) => {
          process.stderr.write(`\x1b[33mkimiflare: ${msg}\x1b[0m\n`);
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
    if (isKillSwitchError(err)) {
      process.stderr.write(
        "\n\x1b[31m" +
          "╔══════════════════════════════════════════════════════════════╗\n" +
          "║  KimiFlare Cloud has reached its maximum budget across       ║\n" +
          "║  all users. The free credits period has ended.               ║\n" +
          "║                                                              ║\n" +
          "║  To continue using KimiFlare, switch to BYOK mode:           ║\n" +
          "║  • kimiflare config set-key <your-cloudflare-api-key>        ║\n" +
          "║  • kimiflare config set-account <your-account-id>            ║\n" +
          "║  • Or re-run kimiflare and select BYOK                       ║\n" +
          "╚══════════════════════════════════════════════════════════════╝\n" +
          "\x1b[0m\n",
      );
      process.exitCode = 0;
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


