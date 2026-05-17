import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export interface GlobEntry {
  path: string;
  stats?: { mtimeMs: number };
}

interface InternalEntry {
  path: string;
  isDirectory: boolean;
  stats?: { mtimeMs: number };
}

function escapeRegex(c: string): string {
  // eslint-disable-next-line no-useless-escape
  return "[\\^$.|?*+(){}[]".includes(c) ? "\\" + c : c;
}

function segmentToRegex(pattern: string): RegExp {
  let src = "^";
  for (const ch of pattern) {
    if (ch === "*") src += "[^/]*";
    else if (ch === "?") src += "[^/]";
    else src += escapeRegex(ch);
  }
  src += "$";
  return new RegExp(src);
}

function matchSegment(str: string, pattern: string): boolean {
  return segmentToRegex(pattern).test(str);
}

/**
 * Match a relative file path (using `/` separators) against a glob pattern.
 * Supports `*`, `?`, and `**` (matches zero or more whole segments).
 */
export function matchGlob(relPath: string, pattern: string): boolean {
  const pathParts = relPath.split("/").filter((p) => p.length > 0);
  const patternParts = pattern.split("/").filter((p) => p.length > 0);
  const m = pathParts.length;
  const n = patternParts.length;

  // dp[i][j] = whether pathParts[0..i-1] matches patternParts[0..j-1]
  const dp: boolean[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(false),
  );
  dp[0]![0] = true;

  for (let j = 1; j <= n; j++) {
    if (patternParts[j - 1] === "**") {
      dp[0]![j] = dp[0]![j - 1]!;
    }
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const pp = patternParts[j - 1]!;
      if (pp === "**") {
        dp[i]![j] = dp[i]![j - 1]! || dp[i - 1]![j]!;
      } else if (matchSegment(pathParts[i - 1]!, pp)) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      }
    }
  }

  return dp[m]![n]!;
}

async function* walk(
  dir: string,
  relPrefix: string,
  pattern: string,
  dot: boolean,
  onlyFiles: boolean,
  withStats: boolean,
  ignorePatterns: string[],
  destroyed: { value: boolean },
): AsyncGenerator<InternalEntry> {
  if (destroyed.value) return;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (destroyed.value) return;
    if (!dot && entry.name.startsWith(".")) continue;

    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

    // If this exact path matches an ignore pattern, skip it entirely.
    if (ignorePatterns.some((p) => matchGlob(relPath, p))) continue;

    const isDir = entry.isDirectory();
    const fullPath = join(dir, entry.name);

    if (isDir) {
      // Prune directory if anything inside it would match an ignore pattern.
      const shouldPrune = ignorePatterns.some((p) =>
        matchGlob(`${relPath}/x`, p),
      );
      if (!shouldPrune) {
        yield* walk(
          fullPath,
          relPath,
          pattern,
          dot,
          onlyFiles,
          withStats,
          ignorePatterns,
          destroyed,
        );
      }
    }

    if (!matchGlob(relPath, pattern)) continue;
    if (onlyFiles && isDir) continue;

    const result: InternalEntry = { path: fullPath, isDirectory: isDir };
    if (withStats) {
      try {
        const s = await stat(fullPath);
        result.stats = { mtimeMs: s.mtimeMs };
      } catch {
        /* ignore stat errors */
      }
    }
    yield result;
  }
}

export function globStream(
  pattern: string,
  options: {
    cwd: string;
    absolute: boolean;
    dot?: boolean;
    onlyFiles?: boolean;
    stats?: boolean;
    ignore?: string[];
  },
): AsyncIterable<GlobEntry> & { destroy: (err?: Error) => void } {
  const destroyed = { value: false };
  const cwd = resolve(options.cwd);
  const absolute = options.absolute;
  const dot = options.dot ?? false;
  const onlyFiles = options.onlyFiles ?? false;
  const withStats = options.stats ?? false;
  const ignorePatterns = options.ignore ?? [];

  async function* generator(): AsyncGenerator<GlobEntry> {
    for await (const entry of walk(
      cwd,
      "",
      pattern,
      dot,
      onlyFiles,
      withStats,
      ignorePatterns,
      destroyed,
    )) {
      if (destroyed.value) return;
      yield {
        path: absolute ? entry.path : relative(cwd, entry.path),
        stats: entry.stats,
      };
    }
  }

  const iterable = generator();

  return {
    [Symbol.asyncIterator](): AsyncIterator<GlobEntry> {
      return iterable[Symbol.asyncIterator]();
    },
    destroy(_err?: Error): void {
      destroyed.value = true;
    },
  };
}

export async function glob(
  pattern: string,
  options: {
    cwd: string;
    absolute: boolean;
    dot?: boolean;
    onlyFiles?: boolean;
    ignore?: string[];
    markDirectories?: boolean;
    suppressErrors?: boolean;
  },
): Promise<string[]> {
  const cwd = resolve(options.cwd);
  const absolute = options.absolute;
  const dot = options.dot ?? false;
  const onlyFiles = options.onlyFiles ?? false;
  const markDirectories = options.markDirectories ?? false;
  const suppressErrors = options.suppressErrors ?? false;
  const ignorePatterns = options.ignore ?? [];

  if (suppressErrors) {
    try {
      await readdir(cwd, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  const destroyed = { value: false };
  const out: string[] = [];

  try {
    for await (const entry of walk(
      cwd,
      "",
      pattern,
      dot,
      onlyFiles,
      false,
      ignorePatterns,
      destroyed,
    )) {
      let p = absolute ? entry.path : relative(cwd, entry.path);
      if (markDirectories && entry.isDirectory) p += "/";
      out.push(p);
    }
  } catch {
    if (!suppressErrors) throw new Error(`glob failed for pattern: ${pattern}`);
  }

  return out;
}
