import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { findGitRepoRoot } from "./system-prompt.js";

const MAX_CONTEXT_BYTES = 20 * 1024;

/** Tracks which AGENTS.md files have been injected and the last known working directory. */
export class ContextInjector {
  private lastCwd: string;
  private injectedPaths: Set<string>;

  constructor(cwd: string) {
    this.lastCwd = resolve(cwd);
    this.injectedPaths = new Set();
  }

  /**
   * Called after every tool call. Detects directory changes and returns
   * content blocks for any newly discovered AGENTS.md files.
   *
   * @param currentCwd — the working directory after the tool call
   * @returns content blocks to append to the session prefix, or empty array
   */
  checkCwdChange(currentCwd: string): string[] {
    const resolvedCwd = resolve(currentCwd);
    if (resolvedCwd === this.lastCwd) return [];

    // Directory changed. Walk up from new cwd to find AGENTS.md files.
    const newBlocks = this.collectNewAgentsFiles(resolvedCwd);
    this.lastCwd = resolvedCwd;
    return newBlocks;
  }

  /** Mark a file as already injected (used for static loading at startup). */
  markInjected(filePath: string): void {
    this.injectedPaths.add(filePath);
  }

  /**
   * Walk up from startDir to the already-covered directory, collecting
   * AGENTS.md files not yet injected.
   */
  private collectNewAgentsFiles(startDir: string): string[] {
    const results: string[] = [];

    // Walk up from startDir. Stop when we reach a dir that's already
    // covered by a previously-injected AGENTS.md file, or when we
    // reach the filesystem root.
    const walkStart = resolve(startDir);
    const walkEnd = findGitRepoRoot(walkStart) ?? resolve("/");
    let dir = walkStart;
    const found: string[] = [];

    while (true) {
      const filePath = join(dir, "AGENTS.md");
      if (!this.injectedPaths.has(filePath)) {
        try {
          const s = statSync(filePath);
          if (s.isFile() && s.size <= MAX_CONTEXT_BYTES) {
            const content = readFileSync(filePath, "utf8");
            found.push(filePath);
            this.injectedPaths.add(filePath);
          }
        } catch {
          // not present
        }
      } else {
        // This directory's AGENTS.md is already injected. Since we walked
        // up, all ancestors will also be covered. Stop collecting.
        break;
      }

      const parent = dirname(dir);
      if (dir === walkEnd || parent === dir) break;
      dir = parent;
    }

    // Reverse so farthest ancestor comes first (stable injection order)
    found.reverse();

    for (const fp of found) {
      const content = readFileSync(fp, "utf8");
      const lines = content.split("\n").length;
      results.push(`Context from ${fp} (${lines} lines):\n${content.trim()}`);
    }

    return results;
  }
}
