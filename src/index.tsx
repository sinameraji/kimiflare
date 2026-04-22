import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, DEFAULT_MODEL } from "./config.js";
import { runAgentTurn } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS } from "./tools/executor.js";
import type { ChatMessage } from "./agent/messages.js";

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();
program
  .name("kimiflare")
  .description("Terminal coding agent powered by Kimi-K2.6 on Cloudflare Workers AI.")
  .version(readPackageVersion())
  .option("-p, --print <prompt>", "one-shot mode: send prompt, stream reply to stdout, exit")
  .option("-m, --model <id>", "model id (defaults to @cf/moonshotai/kimi-k2.6)")
  .option("--dangerously-allow-all", "auto-approve every permission prompt (print mode only)")
  .option("--reasoning", "include reasoning in stdout (print mode only)")
  .parse();

const opts = program.opts<{
  print?: string;
  model?: string;
  dangerouslyAllowAll?: boolean;
  reasoning?: boolean;
}>();

async function main() {
  const cfg = await loadConfig();

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
    await renderApp({ ...cfg, model });
  } else {
    await renderApp(null);
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
}

async function runPrintMode(opts: PrintOpts): Promise<void> {
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

  await runAgentTurn({
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    model: opts.model,
    messages,
    tools: ALL_TOOLS,
    executor,
    cwd,
    signal: controller.signal,
    coauthor:
      opts.coauthor !== false
        ? { name: opts.coauthorName || "kimiflare", email: opts.coauthorEmail || "sinameraji@gmail.com" }
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

  process.stdout.write("\n");
}

main().catch((e) => {
  console.error(`kimiflare: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
