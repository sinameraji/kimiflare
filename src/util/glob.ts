/**
 * Lightweight glob implementation using only Node.js built-ins.
 * Replaces `fast-glob` to reduce dependency footprint.
 */
import { readdir, lstat, realpath } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface GlobOptions {
  cwd?: string;
  absolute?: boolean;
  dot?: boolean;
  onlyFiles?: boolean;
  onlyDirectories?: boolean;
  markDirectories?: boolean;
  followSymbolicLinks?: boolean;
  suppressErrors?: boolean;
  ignore?: string | string[];
  stats?: boolean;
}

export interface GlobEntry {
  path: string;
  stats?: { mtimeMs: number };
  dirent?: { isDirectory(): boolean };
}

interface Segment {
  type: "literal" | "glob" | "doublestar";
  value: string;
}

function parsePattern(pattern: string): Segment[] {
  const parts = pattern.split(/\//g);
  return parts.map((p) => {
    if (p === "**") return { type: "doublestar", value: p };
    if (p.includes("*") || p.includes("?") || p.includes("[")) {
      return { type: "glob", value: p };
    }
    return { type: "literal", value: p };
  });
}

function globToRegex(glob: string): RegExp {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close === -1) {
        re += "\\[";
      } else {
        re += glob.slice(i, close + 1);
        i = close;
      }
    } else if ("\\^$.|+(){}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

function matchSegment(segment: string, pattern: string): boolean {
  return globToRegex(pattern).test(segment);
}

function shouldIgnore(relativePath: string, ignorePatterns: string[]): boolean {
  for (const pat of ignorePatterns) {
    const segs = parsePattern(pat);
    const parts = relativePath.split(/\//g);
    if (matchIgnoreParts(parts, segs, 0, 0)) return true;
  }
  return false;
}

function matchIgnoreParts(
  parts: string[],
  segs: Segment[],
  pi: number,
  si: number,
): boolean {
  if (si >= segs.length) return pi >= parts.length;
  const seg = segs[si]!;
  if (seg.type === "doublestar") {
    if (si === segs.length - 1) return true;
    for (let i = pi; i <= parts.length; i++) {
      if (matchIgnoreParts(parts, segs, i, si + 1)) return true;
    }
    return false;
  }
  if (pi >= parts.length) return false;
  const part = parts[pi]!;
  const ok =
    seg.type === "literal"
      ? seg.value === part
      : matchSegment(part, seg.value);
  return ok && matchIgnoreParts(parts, segs, pi + 1, si + 1);
}

async function* walk(
  root: string,
  pattern: string,
  options: GlobOptions,
): AsyncGenerator<GlobEntry> {
  const dot = options.dot ?? false;
  const followSymbolicLinks = options.followSymbolicLinks ?? false;
  const suppressErrors = options.suppressErrors ?? false;
  const stats = options.stats ?? false;
  const onlyFiles = options.onlyFiles ?? false;
  const onlyDirectories = options.onlyDirectories ?? false;
  const markDirectories = options.markDirectories ?? false;
  const ignorePatterns = options.ignore
    ? Array.isArray(options.ignore)
      ? options.ignore
      : [options.ignore]
    : [];

  const segs = parsePattern(pattern);

  async function* yieldEntry(
    fullPath: string,
    relPath: string,
    isDir: boolean,
  ): AsyncGenerator<GlobEntry> {
    if (onlyFiles && isDir) return;
    if (onlyDirectories && !isDir) return;
    let path = fullPath;
    if (markDirectories && isDir) path += "/";
    const entry: GlobEntry = { path };
    if (stats) {
      try {
        const s = await lstat(fullPath);
        entry.stats = { mtimeMs: s.mtimeMs };
      } catch {
        // ignore
      }
    }
    yield entry;
  }

  async function* processEntries(
    dirPath: string,
    segIdx: number,
    relativeParts: string[],
  ): AsyncGenerator<GlobEntry> {
    // Process entries in the current directory against the pattern starting at segIdx
    if (segIdx >= segs.length) return;

    const seg = segs[segIdx]!;

    if (segIdx + 1 >= segs.length) {
      // Last segment — match files/dirs in current directory
      let entries: Dirent[] | undefined;
      try {
        entries = await readdir(dirPath, { withFileTypes: true, encoding: "utf8" });
      } catch (err) {
        if (!suppressErrors) throw err;
        return;
      }
      for (const ent of entries) {
        const name = String(ent.name);
        if (name === "." || name === "..") continue;
        if (!dot && name.startsWith(".")) continue;
        const matched =
          seg.type === "literal"
            ? seg.value === name
            : matchSegment(name, seg.value);
        if (!matched) continue;
        const childPath = join(dirPath, name);
        const childRel = [...relativeParts, name];
        const childRelStr = childRel.join("/");
        if (shouldIgnore(childRelStr, ignorePatterns)) continue;
        const isDir = ent.isDirectory();
        const isFile = ent.isFile() || ent.isSymbolicLink();
        if (isDir || isFile) {
          yield* yieldEntry(childPath, childRelStr, isDir);
        }
      }
      return;
    }

    // Not last segment — must match a directory
    let entries: Dirent[] | undefined;
    try {
      entries = await readdir(dirPath, { withFileTypes: true, encoding: "utf8" });
    } catch (err) {
      if (!suppressErrors) throw err;
      return;
    }
    for (const ent of entries) {
      const name = String(ent.name);
      if (name === "." || name === "..") continue;
      if (!dot && name.startsWith(".")) continue;
      const matched =
        seg.type === "literal"
          ? seg.value === name
          : matchSegment(name, seg.value);
      if (!matched) continue;
      const childPath = join(dirPath, name);
      const childRel = [...relativeParts, name];
      const childRelStr = childRel.join("/");
      if (shouldIgnore(childRelStr, ignorePatterns)) continue;
      let isDir = ent.isDirectory();
      if (!isDir && followSymbolicLinks && ent.isSymbolicLink()) {
        try {
          const rp = await realpath(childPath);
          const s = await lstat(rp);
          isDir = s.isDirectory();
        } catch {
          continue;
        }
      }
      if (isDir) {
        yield* recurse(childPath, segIdx + 1, childRel);
      }
    }
  }

  async function* recurse(
    dirPath: string,
    segIdx: number,
    relativeParts: string[],
  ): AsyncGenerator<GlobEntry> {
    if (segIdx >= segs.length) return;

    const seg = segs[segIdx]!;

    if (seg.type === "doublestar") {
      // Yield current directory if remaining pattern is empty
      if (segIdx + 1 >= segs.length) {
        const rel = relativeParts.join("/");
        if (!shouldIgnore(rel, ignorePatterns)) {
          yield* yieldEntry(dirPath, rel, true);
        }
        return;
      }

      // Try matching the rest of the pattern in the current directory
      // (treating ** as matching zero path segments)
      yield* processEntries(dirPath, segIdx + 1, relativeParts);

      // Also recurse into subdirectories
      let entries: Dirent[] | undefined;
      try {
        entries = await readdir(dirPath, { withFileTypes: true, encoding: "utf8" });
      } catch (err) {
        if (!suppressErrors) throw err;
        return;
      }
      for (const ent of entries) {
        const name = String(ent.name);
        if (name === "." || name === "..") continue;
        if (!dot && name.startsWith(".")) continue;
        const childPath = join(dirPath, name);
        const childRel = [...relativeParts, name];
        const childRelStr = childRel.join("/");
        if (shouldIgnore(childRelStr, ignorePatterns)) continue;
        if (ent.isDirectory() || (followSymbolicLinks && ent.isSymbolicLink())) {
          let isDir = ent.isDirectory();
          if (!isDir && followSymbolicLinks && ent.isSymbolicLink()) {
            try {
              const rp = await realpath(childPath);
              const s = await lstat(rp);
              isDir = s.isDirectory();
            } catch {
              continue;
            }
          }
          if (isDir) {
            // Yield this directory if it matches the rest of the pattern
            if (segIdx + 1 >= segs.length) {
              yield* yieldEntry(childPath, childRelStr, true);
            }
            // Continue recursing with same doublestar.
            // The child's doublestar logic will handle both zero-segment
            // (via processEntries) and one-or-more-segment matches.
            yield* recurse(childPath, segIdx, childRel);
          }
        }
      }
      return;
    }

    yield* processEntries(dirPath, segIdx, relativeParts);
  }

  yield* recurse(root, 0, []);
}

export async function glob(pattern: string, options: GlobOptions = {}): Promise<string[]> {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();

  const results: string[] = [];
  for await (const entry of walk(cwd, pattern, options)) {
    let path = entry.path;
    const isDir = path.endsWith("/");
    if (!options.absolute) {
      path = relative(cwd, path);
    }
    if (isDir && !path.endsWith("/")) path += "/";
    results.push(path);
  }
  return results;
}

export function globStream(
  pattern: string,
  options: GlobOptions = {},
): AsyncIterable<GlobEntry> & { destroy: (err?: Error) => void } {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const absolute = options.absolute ?? false;

  let destroyed = false;
  let destroyErr: Error | undefined;

  const iterable: AsyncIterable<GlobEntry> = {
    [Symbol.asyncIterator](): AsyncIterator<GlobEntry> {
      const generator = walk(cwd, pattern, options);
      return {
        async next(): Promise<IteratorResult<GlobEntry>> {
          if (destroyed) {
            return { done: true, value: undefined };
          }
          const result = await generator.next();
          if (destroyed) {
            return { done: true, value: undefined };
          }
          if (!absolute && result.value) {
            const isDir = result.value.path.endsWith("/");
            result.value.path = relative(cwd, result.value.path);
            if (isDir && !result.value.path.endsWith("/")) {
              result.value.path += "/";
            }
          }
          return result;
        },
        async return(): Promise<IteratorResult<GlobEntry>> {
          await generator.return?.(undefined);
          return { done: true, value: undefined };
        },
      };
    },
  };

  return Object.assign(iterable, {
    destroy(err?: Error) {
      destroyed = true;
      destroyErr = err;
    },
  });
}

/**
 * Check if a file path matches a glob pattern.
 * Supports `*`, `?`, `**`, and character classes `[abc]`.
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  const fileParts = filePath.split(/\//g);
  const segs = parsePattern(pattern);

  function match(fp: number, sp: number): boolean {
    if (sp >= segs.length) return fp >= fileParts.length;
    const seg = segs[sp]!;
    if (seg.type === "doublestar") {
      if (sp === segs.length - 1) return true;
      for (let i = fp; i <= fileParts.length; i++) {
        if (match(i, sp + 1)) return true;
      }
      return false;
    }
    if (fp >= fileParts.length) return false;
    const part = fileParts[fp]!;
    const ok =
      seg.type === "literal"
        ? seg.value === part
        : matchSegment(part, seg.value);
    return ok && match(fp + 1, sp + 1);
  }

  return match(0, 0);
}
