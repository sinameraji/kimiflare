import { spawn } from "node:child_process";
import type { ToolSpec, ToolContext } from "./registry.js";
import { truncate } from "../util/paths.js";

interface Args {
  command: string;
  timeout_ms?: number;
}

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const OUTPUT_CAP = 30_000;

export const bashTool: ToolSpec<Args> = {
  name: "bash",
  description:
    "Run a shell command via `bash -lc`. Prompts the user for permission before executing. stdout and stderr are captured, combined, and capped at 30KB.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout_ms: {
        type: "integer",
        description: "Milliseconds. Default 120000, max 600000.",
        minimum: 1000,
        maximum: MAX_TIMEOUT,
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  needsPermission: true,
  render: (args) => ({ title: formatBashTitle(args.command) }),
  run: (args, ctx) => runBash(args, ctx),
};

function formatBashTitle(raw: string): string {
  let cmd = (raw ?? "").trim();
  const m = cmd.match(/^cd\s+([^\s&;]+)\s*(?:&&|;)\s*(.*)$/);
  if (m) cmd = m[2]!.trim();
  return `$ ${cmd}`.slice(0, 120);
}

function runBash(args: Args, ctx: ToolContext): Promise<string> {
  const timeout = Math.min(Math.max(1000, args.timeout_ms ?? DEFAULT_TIMEOUT), MAX_TIMEOUT);
  return new Promise<string>((resolve, reject) => {
    const child = spawn("bash", ["-lc", args.command], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const header = killedByTimeout
        ? `(timed out after ${timeout}ms)`
        : `exit=${code ?? "?"}${signal ? ` signal=${signal}` : ""}`;
      const parts: string[] = [header];
      if (stdout) parts.push(`--- stdout ---\n${stdout.trimEnd()}`);
      if (stderr) parts.push(`--- stderr ---\n${stderr.trimEnd()}`);
      if (!stdout && !stderr) parts.push("(no output)");
      resolve(truncate(parts.join("\n"), OUTPUT_CAP));
    });
  });
}
