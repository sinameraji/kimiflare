export type Mode = "edit" | "plan" | "auto";

export const MODES: Mode[] = ["edit", "plan", "auto"];

export function nextMode(m: Mode): Mode {
  const i = MODES.indexOf(m);
  return MODES[(i + 1) % MODES.length]!;
}

export function modeDescription(m: Mode): string {
  switch (m) {
    case "edit":
      return "edit — default; prompts for permission before mutating tools";
    case "plan":
      return "plan — read-only research; blocks writes/edits/mutating bash until you exit plan mode";
    case "auto":
      return "auto — autonomous; auto-approves every tool call (use with care)";
  }
}

export const MUTATING_TOOLS = new Set(["write", "edit", "bash"]);

export function isBlockedInPlanMode(toolName: string): boolean {
  if (MUTATING_TOOLS.has(toolName)) return true;
  if (toolName.startsWith("mcp_")) return true;
  return false;
}

// Dangerous shell patterns that disqualify any command from read-only status
const DANGEROUS_PATTERNS = /[<>|;&`$]|\$\(|\$\{|&&|\|\||\b&\s*$/;

// Git subcommands that are read-only (value = true means always safe, false means needs arg check)
const GIT_READONLY_SUBCOMMANDS: Record<string, boolean> = {
  log: true,
  diff: true,
  status: true,
  show: true,
  blame: true,
  describe: true,
  "rev-parse": true,
  "ls-files": true,
  reflog: true,
  shortlog: true,
  whatchanged: true,
  grep: true,
  branch: false, // needs check: block -d/-D/-m/-M/-c/-C
  stash: false, // needs check: only allow "list"
  remote: false, // needs check: only allow -v
  tag: false, // needs check: only allow -l
  config: false, // needs check: only allow --list/--get
};

// Whitelisted non-git commands (must be exact first token)
const READONLY_COMMANDS = new Set([
  // File system
  "ls", "cat", "head", "tail", "pwd", "echo",
  "file", "stat", "readlink", "realpath", "dirname", "basename",
  "wc", "sort", "uniq", "diff", "cmp",
  // Search
  "grep", "rg", "ag", "fd",
  // System info
  "ps", "df", "du", "env", "printenv", "which", "whereis",
  "uname", "hostname", "uptime", "free", "date", "id", "whoami", "groups",
  // Utilities
  "jq", "cut", "tr",
  "base64", "sha256sum", "md5sum", "shasum", "hexdump", "xxd", "strings",
  "less", "more", "man", "clear", "history",
  // Archive inspection
  "zipinfo",
  // Network
  "ping", "netstat", "ss", "lsof",
]);

// Commands that need argument validation
const COMMANDS_NEEDING_ARG_CHECK: Record<string, (args: string[]) => boolean> = {
  find: (args) => !args.some((a) => a === "-delete" || a === "-exec"),
  sed: (args) => !args.some((a) => a === "-i" || a.startsWith("-i")),
  tar: (args) => args[0] === "-tf" || args[0] === "--list",
  unzip: (args) => args[0] === "-l",
  curl: (args) =>
    !args.some((a) => a === "-o" || a === "-O" || a === "-d" || a === "--data" || a.startsWith("-X")),
  wget: (args) =>
    !args.some((a) => a === "-O" || a === "--output-document" || a.startsWith("--post")),
  npm: (args) =>
    ["list", "view", "config"].includes(args[0] ?? "") &&
    !(args[0] === "config" && args[1] && !args[1].startsWith("get") && args[1] !== "list"),
  tsc: (args) =>
    args.every((a) =>
      ["--noEmit", "--version", "--showConfig", "--help", "-h", "--init"].includes(a),
    ),
  eslint: (args) =>
    args.every((a) =>
      ["--version", "--print-config", "--help", "-h"].includes(a) || !a.startsWith("-"),
    ),
  prettier: (args) =>
    args.every((a) =>
      ["--version", "--check", "--help", "-h"].includes(a) || !a.startsWith("-"),
    ),
  jest: (args) =>
    args.every((a) =>
      ["--version", "--listTests", "--showConfig", "--help", "-h"].includes(a) || !a.startsWith("-"),
    ),
  vitest: (args) =>
    args.every((a) =>
      ["--version", "--help", "-h"].includes(a) || !a.startsWith("-"),
    ),
  go: (args) =>
    ["version", "env", "list", "mod"].includes(args[0] ?? "") &&
    !(args[0] === "mod" && args[1] && !["graph", "download", "why", "verify"].includes(args[1])),
  cargo: (args) =>
    ["--version", "-V", "check", "test", "metadata"].includes(args[0] ?? "") &&
    !(args[0] === "test" && args.includes("--no-run") === false),
};

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (const ch of command) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export function isReadOnlyBash(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Reject any command with dangerous shell patterns
  if (DANGEROUS_PATTERNS.test(trimmed)) return false;

  const tokens = tokenizeCommand(trimmed);
  if (tokens.length === 0) return false;

  const first = tokens[0]!;

  // Handle cd prefix: cd somewhere && real_command
  let cmdIndex = 0;
  if (first === "cd" && tokens.length >= 3 && tokens[1] && tokens[2] === "&&") {
    cmdIndex = 3;
  }

  const cmd = tokens[cmdIndex];
  if (!cmd) return false;
  const args = tokens.slice(cmdIndex + 1);

  // Git commands
  if (cmd === "git") {
    const sub = args[0] ?? "";
    const allowed = GIT_READONLY_SUBCOMMANDS[sub];
    if (allowed === undefined) return false;
    if (allowed === true) return true;

    // Needs extra validation
    switch (sub) {
      case "branch":
        return !args.some((a) => /^-[dDmMcC]/.test(a));
      case "stash":
        return args[1] === "list";
      case "remote":
        return args[1] === "-v" || args[1] === "--verbose" || args.length === 1;
      case "tag":
        return args[1] === "-l" || args[1] === "--list" || args.length === 1;
      case "config":
        return args[1] === "--list" || args[1]?.startsWith("--get") === true || args.length === 1;
      default:
        return false;
    }
  }

  // Simple whitelist only — no arg-checked commands in plan mode
  return READONLY_COMMANDS.has(cmd);
}

export function systemPromptForMode(m: Mode): string {
  if (m === "plan") {
    return "\n\nPLAN MODE is active. The user wants you to investigate and produce a plan WITHOUT making any changes. Do not call write, edit, or mutating bash commands. You may use read-only bash commands (e.g., git log, git diff, ls, cat, grep) along with read/glob/grep/web-fetch. Scripting interpreters (node, python3, ruby, perl, awk) and build/package tools (npm, cargo, go, tsc, jest, etc.) are blocked in plan mode. At the end, present a concise plan (bullets, files to change, approach). The user will review and then exit plan mode to execute.";
  }
  if (m === "auto") {
    return "\n\nAUTO MODE is active. The user has opted into autonomous execution — every tool call will be auto-approved. Work efficiently, but do not take irreversible destructive actions (rm -rf, git push --force, dropping tables, etc.) without pausing to describe them in chat first. Prefer smaller reversible steps.";
  }
  return "";
}
