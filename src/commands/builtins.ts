import type { SlashItem } from "./types.js";

/**
 * Built-in slash commands shown in the `/`-trigger picker. Each entry's
 * `name` must match a branch in `handleSlash` (src/app.tsx) — keep this
 * list in sync when adding/removing handled commands.
 */
export const BUILTIN_COMMANDS: SlashItem[] = [
  { name: "help", description: "Show keybindings and command list", source: "builtin" },
  { name: "model", argHint: "[list|<id>]", description: "Pick model (no args opens picker)", source: "builtin" },
  { name: "mode", argHint: "edit|plan|auto", description: "Switch agent mode", source: "builtin" },
  { name: "theme", argHint: "[<name>]", description: "Switch color theme", source: "builtin" },
  { name: "reasoning", description: "Toggle reasoning visibility", source: "builtin" },
  { name: "memory", argHint: "[on|off|clear|search ...]", description: "Manage memory", source: "builtin" },
  { name: "cost", argHint: "[on|off]", description: "Show cost report or toggle attribution", source: "builtin" },
  { name: "gateway", argHint: "[status|off|<id>|cache-ttl|skip-cache|...]", description: "Manage AI Gateway", source: "builtin" },
  { name: "mcp", argHint: "[list|reload]", description: "Manage MCP servers", source: "builtin" },
  { name: "lsp", argHint: "[config|list|reload|scope]", description: "Manage language servers", source: "builtin" },
  { name: "hooks", argHint: "[list|recommended|enable <id>|disable <id>|path|reload]", description: "Manage lifecycle hooks", source: "builtin" },
  { name: "skills", argHint: "[list|add|edit|delete|enable|disable]", description: "Manage skills", source: "builtin" },
  { name: "command", argHint: "[create|edit|delete|list]", description: "Manage custom slash commands", source: "builtin" },
  { name: "resume", description: "Pick a past conversation to resume", source: "builtin" },
  { name: "checkpoint", argHint: "[label]", description: "Save current point in session", source: "builtin" },
  { name: "checkpoints", description: "List checkpoints in current session", source: "builtin" },
  { name: "compact", description: "Summarize old turns to free context", source: "builtin" },
  { name: "clear", description: "Clear current conversation", source: "builtin" },
  { name: "init", description: "Scan repo and write KIMI.md", source: "builtin" },
  { name: "remote", argHint: "<prompt>", description: "Run a remote session on Cloudflare", source: "builtin" },
  { name: "update", description: "Check for updates", source: "builtin" },
  { name: "hello", description: "Send a voice note to the creator", source: "builtin" },
  { name: "report", argHint: "[send] [note]", description: "Report the last API error with diagnostic logs", source: "builtin" },
  { name: "shell", argHint: "[auto|bash|cmd|powershell|<path>]", description: "Show or set shell for bash tool", source: "builtin" },
  { name: "logout", description: "Clear stored credentials", source: "builtin" },
  { name: "exit", description: "Exit kimiflare", source: "builtin" },
];

export const BUILTIN_COMMAND_NAMES = new Set(
  BUILTIN_COMMANDS.map((c) => c.name.toLowerCase()),
);
