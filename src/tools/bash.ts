import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function injectCoauthor(command: string, coauthor?: { name: string; email: string }): string {
  if (!coauthor) return command;
  const trailer = `Co-authored-by: ${coauthor.name} <${coauthor.email}>`;

  const trimmed = command.trim();
  if (command.includes(trailer)) return command;

  // Detect git commands that create commits
  const createsCommit = /\bgit\s+(commit|merge|revert|cherry-pick)\b/.test(trimmed);
  const isRebaseContinue = /\bgit\s+rebase\b/.test(trimmed) && !/\b--abort\b|\b--skip\b/.test(trimmed);
  const mentionsGit = /\bgit\b/.test(trimmed);

  if (!createsCommit && !isRebaseContinue && !mentionsGit) return command;

  const tmpFile = join(tmpdir(), `kf-coauthor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const amendBlock = `
    if ! git log -1 --pretty=%B 2>/dev/null | grep -qF "${trailer}"; then
      git log -1 --pretty=%B | git interpret-trailers --trailer "${trailer}" > "${tmpFile}" && git commit --amend -F "${tmpFile}" --no-edit && rm -f "${tmpFile}"
    fi
  `.trim();

  if (createsCommit || isRebaseContinue) {
    // Primary path: known commit-creating command — amend immediately after success
    return `(${command}) && { ${amendBlock}; }`;
  }

  // Safety net: command mentions git but isn't obviously commit-creating
  // (e.g., a script or Makefile that calls git internally).
  // Record HEAD before and after; amend if a new commit lacks the trailer.
  const beforeHead = `git rev-parse HEAD 2>/dev/null || echo "NO_HEAD"`;
  const afterCheck = `
    _KF_AFTER_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "NO_HEAD")
    if [ "$_KF_BEFORE_HEAD" != "$_KF_AFTER_HEAD" ] && [ "$_KF_AFTER_HEAD" != "NO_HEAD" ]; then
      ${amendBlock}
    fi
  `.trim();
  return `_KF_BEFORE_HEAD=$(${beforeHead}); (${command}); _KF_EXIT=$?; [ $_KF_EXIT -eq 0 ] && { ${afterCheck}; }; exit $_KF_EXIT`;
}

function runBash(args: Args, ctx: ToolContext): Promise<string> {
  const timeout = Math.min(Math.max(1000, args.timeout_ms ?? DEFAULT_TIMEOUT), MAX_TIMEOUT);
  const command = injectCoauthor(args.command, ctx.coauthor);
  return new Promise<string>((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
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
