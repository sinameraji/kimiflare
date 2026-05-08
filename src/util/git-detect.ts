import { execSync } from "node:child_process";

export function detectGitHubRepo(
  cachedRepo?: string,
): { owner: string; name: string } | null {
  if (cachedRepo) {
    const parts = cachedRepo.split("/");
    if (parts.length === 2) return { owner: parts[0]!, name: parts[1]! };
  }
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    const httpsMatch = remoteUrl.match(
      /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
    );
    if (httpsMatch) return { owner: httpsMatch[1]!, name: httpsMatch[2]! };
    const sshMatch = remoteUrl.match(
      /github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
    );
    if (sshMatch) return { owner: sshMatch[1]!, name: sshMatch[2]! };
  } catch {
    // not a git repo or no origin remote
  }
  return null;
}

export function detectGitBranch(): string | null {
  try {
    return (
      execSync("git branch --show-current", {
        cwd: process.cwd(),
        encoding: "utf8",
      }).trim() || null
    );
  } catch {
    return null;
  }
}
