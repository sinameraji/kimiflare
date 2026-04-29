const EXT_TO_SERVER: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "TypeScript",
  ".jsx": "TypeScript",
  ".mjs": "TypeScript",
  ".cjs": "TypeScript",
  ".py": "Python",
  ".pyi": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".lua": "Lua",
  ".json": "JSON",
  ".css": "CSS",
  ".scss": "CSS",
  ".less": "CSS",
  ".html": "HTML",
  ".htm": "HTML",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".sh": "Bash",
  ".bash": "Bash",
  ".zsh": "Bash",
  ".dockerfile": "Dockerfile",
};

/**
 * Check if a user message references code files that would benefit from LSP.
 * Returns a nudge string if LSP is not configured for the detected language,
 * or null if no nudge is needed.
 */
export function maybeLspNudge(
  userText: string,
  lspEnabled: boolean,
  lspServers: Record<string, unknown>,
): string | null {
  if (lspEnabled && Object.keys(lspServers).length > 0) {
    return null;
  }

  const detected = new Set<string>();
  for (const [ext, server] of Object.entries(EXT_TO_SERVER)) {
    // Match file references like "src/foo.ts", "foo.ts", "./foo.ts", etc.
    const pattern = new RegExp(`(?:^|[\\s\"'\`(/])[^\\s\"'\`()]+${ext}(?:$|[\\s\"'\`)\\/:,;])`, "i");
    if (pattern.test(userText)) {
      detected.add(server);
    }
  }

  if (detected.size === 0) return null;

  const servers = Array.from(detected).join(", ");
  return `Tip: Run \`/lsp config\` to add ${servers} language server support for better type info and navigation in this project.`;
}
