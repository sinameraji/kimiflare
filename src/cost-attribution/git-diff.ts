/**
 * Helper: run git diff --name-status in a session's working directory.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitDiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
  fileTypes: string[];
}

export async function gitDiffSummary(cwd: string): Promise<GitDiffSummary | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--numstat", "--", "."],
      { cwd, timeout: 5000 },
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    let insertions = 0;
    let deletions = 0;
    const types = new Set<string>();

    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const ins = parseInt(parts[0]!, 10);
      const del = parseInt(parts[1]!, 10);
      const file = parts[2]!;
      if (!Number.isNaN(ins)) insertions += ins;
      if (!Number.isNaN(del)) deletions += del;
      const ext = file.includes(".") ? file.slice(file.lastIndexOf(".")) : "";
      types.add(ext || "(none)");
    }

    return {
      filesChanged: lines.length,
      insertions,
      deletions,
      fileTypes: Array.from(types),
    };
  } catch {
    return null;
  }
}
