import { resolve, isAbsolute, relative, sep } from "node:path";
import { homedir } from "node:os";

export function resolvePath(cwd: string, input: string): string {
  if (input.startsWith("~/") || input === "~") {
    return resolve(homedir(), input === "~" ? "." : input.slice(2));
  }
  return isAbsolute(input) ? input : resolve(cwd, input);
}

// Caller must pass a path produced by node:path `relative(...)`; raw user input is not safe.
export function isPathOutside(relPath: string): boolean {
  return relPath === ".." || relPath.startsWith(`..${sep}`) || isAbsolute(relPath);
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n... [truncated, ${s.length - n} chars omitted]`;
}

/**
 * Collapse a path for display:
 *   - If inside cwd, return the path relative to cwd.
 *   - If not inside cwd and length > maxLen, return `…/last-two-segments`.
 *   - Otherwise return the path unchanged.
 */
export function collapsePath(input: string, cwd: string, maxLen = 40): string {
  if (!input) return input;
  let abs: string;
  try {
    abs = resolvePath(cwd, input);
  } catch {
    return input;
  }
  const rel = relative(cwd, abs);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    return rel === "" ? "." : rel;
  }
  if (input.length <= maxLen) return input;
  const parts = input.split(sep).filter(Boolean);
  if (parts.length <= 2) return input;
  return `…/${parts.slice(-2).join(sep)}`;
}

/**
 * Replace any long absolute-looking path (starting with `/` or `~`) inside `s`
 * with a collapsed form. Useful for compacting tool argument previews.
 */
export function collapsePathsInText(s: string, cwd: string, maxLen = 40): string {
  return s.replace(/([~/][^\s"',)}\]]+)/g, (match) => collapsePath(match, cwd, maxLen));
}
