import { Command } from "commander";
import { loadConfig, saveConfig, DEFAULT_MODEL } from "./config.js";
import { isKillSwitchError } from "./util/errors.js";
import { resolveLspConfig } from "./util/lsp-config.js";
import { checkForUpdate } from "./util/update-check.js";
import type { UpdateCheckResult } from "./util/update-check.js";
import { getAppVersion } from "./util/version.js";
import { createRemoteCommand } from "./remote/cli.js";
import { renderLogo } from "./ui/logo.js";
import { runPrintMode } from "./print-mode.js";
import type { PrintFormat } from "./print-mode.js";

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
  .option("--thinking", "alias for --reasoning")
  .option("--continue-on-limit", "reset tool-call counter and continue when the 200-call limit is hit (print mode only)")
  .option("--max-input-tokens <n>", "cumulative prompt token budget; exits 42 when exhausted (print mode only)", (v) => parseInt(v, 10))
  .option("--emit-events", "emit Camouflage NDJSON events to stdout; requires -p (for initial prompt)")
  .option("--multi-turn", "with --emit-events: keep reading stdin for UserInputSubmitted follow-ups after the initial turn")
  .option("--ui <name>", "render UI with React Ink (the only supported engine). This flag and KIMIFLARE_UI are currently ignored.")
  .option("--mode <mode>", "run mode: interactive (default), print, rpc")
  .option("-c, --continue", "continue the most recent session in the current working directory (print mode only)")
  .option("-S, --session <id>", "resume a specific session by id (print mode only)")
  .option("-f, --file <path>", "attach file(s) to the prompt; repeatable, supports globs (print mode only)", (v, prev: string[] | undefined) => (prev ?? []).concat(v))
  .option("--format <mode>", "output format for print mode: text (default), json, stream-json")
  .option("--dir <path>", "run in the specified directory instead of the current one (print mode only)")
  .option("--title <title>", "override the auto-generated session title (print mode only)")
  .option("--attach <url>", "attach to a running kimiflare serve instance (print mode only)");

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
  .description("Resume is temporarily unavailable while Camouflage UI access is disabled.")
  .action(async () => {
    console.error("kimiflare resume: temporarily unavailable. Camouflage UI access is disabled.");
    process.exit(2);
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
          console.log("Cloud mode enabled. Run `kimiflare` to start using it.");

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
  )
  ;

program
  .command("serve")
  .description("Start a headless HTTP server for API access and CI integration")
  .option("--port <n>", "port to listen on", (v) => parseInt(v, 10), 4096)
  .option("--hostname <host>", "hostname to listen on", "127.0.0.1")
  .action(async (cmdOpts) => {
    const cfg = await loadConfig();
    if (!cfg) {
      console.error("kimiflare serve: missing credentials.");
      process.exit(2);
    }
    const { startServer } = await import("./server/index.js");
    await startServer({
      port: cmdOpts.port,
      hostname: cmdOpts.hostname,
      config: cfg,
    });
  });

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
  thinking?: boolean;
  continueOnLimit?: boolean;
  maxInputTokens?: number;
  emitEvents?: boolean;
  multiTurn?: boolean;
  ui?: string;
  mode?: string;
  continue?: boolean;
  session?: string;
  file?: string[];
  format?: string;
  dir?: string;
  title?: string;
  attach?: string;
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
      console.error("kimiflare: --emit-events requires credentials.");
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
    const format = (opts.format ?? "text") as PrintFormat;
    if (format !== "text" && format !== "json" && format !== "stream-json") {
      console.error(`kimiflare: invalid --format "${format}". Use: text, json, stream-json`);
      process.exit(2);
    }

    // Attach mode: connect to a running server
    if (opts.attach) {
      const { runAttachMode } = await import("./attach-mode.js");
      await runAttachMode({
        attachUrl: opts.attach,
        prompt: opts.print,
        model,
        files: opts.file,
        format,
        allowAll: !!opts.dangerouslyAllowAll,
        sessionId: opts.session,
      });
      return;
    }

    await runPrintMode({
      ...cfg,
      model,
      prompt: opts.print,
      allowAll: !!opts.dangerouslyAllowAll,
      showReasoning: !!(opts.reasoning || opts.thinking),
      codeMode: cfg.codeMode,
      continueOnLimit: !!opts.continueOnLimit,
      maxInputTokens: opts.maxInputTokens,
      cloudMode,
      cloudToken,
      cloudDeviceId,
      updateResult,
      continueSession: !!opts.continue,
      sessionId: opts.session,
      files: opts.file,
      format,
      dir: opts.dir,
      title: opts.title,
      permissions: cfg.permissions,
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

  // UI engine resolution: React Ink is always used. Camouflage UI access is
  // temporarily disabled, so `--ui`, `KIMIFLARE_UI`, and any persisted
  // `uiEngine: "camouflage"` config value are ignored.
  const uiEngine = "ink";
  console.log(logoText);
  // Camouflage UI branch is temporarily disabled.
  // if (uiEngine === "camouflage") {
  //   ...
  // }
  // React Ink UI.
  const { renderApp } = await import("./app.js");
  if (cfg) {
    const model = opts.model ?? cfg.model ?? DEFAULT_MODEL;
    await renderApp({ ...cfg, model }, updateResult, lspScope, lspProjectPath, cloudToken, cloudDeviceId);
  } else {
    await renderApp(null, updateResult, lspScope, lspProjectPath, cloudToken, cloudDeviceId);
  }
}




