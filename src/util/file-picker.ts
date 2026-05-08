import { statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fuzzyFilter } from "./fuzzy.js";
import type { FilePickerItem } from "../ui/file-picker.js";

const MAX_GITIGNORE_SIZE = 1 * 1024 * 1024; // 1 MB

/**
 * Build a comprehensive ignore list for the @ file mention picker.
 * Combines common noise patterns (dependencies, build output, caches, etc.)
 * with patterns read from the project's .gitignore file.
 *
 * All hardcoded patterns use the `** /` prefix so they match at any depth
 * (e.g. `** /node_modules/ *` catches both root and nested node_modules).
 */
export function buildFilePickerIgnoreList(cwd: string): string[] {
  const hardcoded = [
    // Dependencies
    "**/node_modules/**",
    "**/vendor/**",
    "**/.bundle/**",
    "**/bower_components/**",
    // Version control
    "**/.git/**",
    "**/.svn/**",
    "**/.hg/**",
    // Build / output directories
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/public/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/.svelte-kit/**",
    "**/.vercel/**",
    "**/.netlify/**",
    "**/target/**",
    "**/bin/**",
    "**/obj/**",
    "**/Debug/**",
    "**/Release/**",
    "**/.gradle/**",
    // Caches
    "**/.cache/**",
    "**/.parcel-cache/**",
    "**/.turbo/**",
    "**/.eslintcache",
    "**/.stylelintcache",
    "**/.rpt2_cache/**",
    "**/.rts2_cache/**",
    // Temporary
    "**/tmp/**",
    "**/temp/**",
    "**/*.tmp",
    // Coverage
    "**/coverage/**",
    "**/.nyc_output/**",
    // OS files
    "**/.DS_Store",
    "**/Thumbs.db",
    // Logs
    "**/*.log",
    "**/logs/**",
    // Lock files (auto-generated, usually huge)
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/bun.lockb",
    "**/Cargo.lock",
    "**/Gemfile.lock",
    "**/composer.lock",
    "**/Pipfile.lock",
    "**/poetry.lock",
    "**/go.sum",
    // Minified / source maps
    "**/*.min.js",
    "**/*.min.css",
    "**/*.map",
    // kimiflare internal
    "**/.kimiflare/**",
    // IDE (usually not relevant to mention)
    "**/.idea/**",
  ];

  // Try to read .gitignore for project-specific ignores.
  // Gitignore patterns are relative to the repo root and may match at any
  // depth. We approximate that by prefixing with `** /`. Patterns that
  // already start with `*` or `/` are handled carefully.
  const gitignorePatterns: string[] = [];
  try {
    const gitignorePath = join(cwd, ".gitignore");
    const stats = statSync(gitignorePath);
    if (stats.size > MAX_GITIGNORE_SIZE) {
      // Guardrail 1.4: skip oversized .gitignore files
      return hardcoded;
    }
    const content = readFileSync(gitignorePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Skip negation patterns — fast-glob ignore doesn't support them
      if (trimmed.startsWith("!")) continue;

      let pattern = trimmed;
      const isAnchored = pattern.startsWith("/");
      const isDir = pattern.endsWith("/");

      // Remove leading slash for processing
      if (isAnchored) pattern = pattern.slice(1);
      // Remove trailing slash for processing
      if (isDir) pattern = pattern.slice(0, -1);

      // Skip patterns that are already wildcards or empty
      if (!pattern) continue;

      if (isAnchored) {
        // Anchored patterns only match at root, so keep them relative to cwd
        gitignorePatterns.push(isDir ? pattern + "/**" : pattern);
      } else {
        // Unanchored patterns match at any depth — prepend `**/`
        gitignorePatterns.push(
          isDir ? "**/" + pattern + "/**" : "**/" + pattern,
        );
      }
    }
  } catch {
    // No .gitignore found — that's fine
  }

  return [...hardcoded, ...gitignorePatterns];
}

export function filterPickerItems(
  items: FilePickerItem[],
  query: string,
): FilePickerItem[] {
  return fuzzyFilter(items, query, (item) => item.name).slice(0, 50);
}

export function shouldOpenMentionPicker(
  input: string,
  cursorOffset: number,
  pickerCancelOffset: number | null,
): boolean {
  if (pickerCancelOffset === cursorOffset) return false;
  if (cursorOffset > 0 && input[cursorOffset - 1] === "@") {
    const beforeAt = cursorOffset - 2;
    return beforeAt < 0 || /\s/.test(input[beforeAt]!);
  }
  return false;
}

/**
 * Slash picker triggers when:
 *   - the char immediately before the cursor is "/"
 *   - everything before that "/" is whitespace-only
 * This matches handleSlash() dispatch (it only runs on inputs where the
 * trimmed text starts with "/"), so the picker can't surface commands
 * that won't actually fire.
 */
export function shouldOpenSlashPicker(
  input: string,
  cursorOffset: number,
  cancelOffset: number | null,
): boolean {
  if (cancelOffset === cursorOffset) return false;
  if (cursorOffset === 0 || input[cursorOffset - 1] !== "/") return false;
  return /^\s*$/.test(input.slice(0, cursorOffset - 1));
}

/**
 * Insert a picked slash-command name into the input, replacing the entire
 * command token (from `/` through the next whitespace or EOL). Preserves
 * any args the user already typed past the cursor and ensures exactly one
 * separating space.
 */
export function insertSlashCommand(
  input: string,
  anchor: number,
  name: string,
): { value: string; cursor: number } {
  let tokenEnd = anchor + 1;
  while (tokenEnd < input.length && !/\s/.test(input[tokenEnd]!)) tokenEnd++;
  const head = input.slice(0, anchor + 1) + name;
  const tail = " " + input.slice(tokenEnd).replace(/^\s+/, "");
  return { value: head + tail, cursor: head.length + 1 };
}

export function trackRecentFile(
  ref: React.MutableRefObject<Map<string, number>>,
  path: string,
  max = 10,
): void {
  ref.current.set(path, Date.now());
  if (ref.current.size > max) {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [p, t] of ref.current) {
      if (t < oldestTime) {
        oldestTime = t;
        oldest = p;
      }
    }
    if (oldest) ref.current.delete(oldest);
  }
}
