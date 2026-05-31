/**
 * Detect the GitHub repo + token for the current working directory so the
 * coordinator can hand sandbox-driven workers a real repo to clone.
 *
 * Repo: parsed from `git remote get-url origin` (GitHub URLs only — SSH or HTTPS).
 * Token: env vars (GITHUB_TOKEN/GH_TOKEN) first, then `gh auth token` if installed.
 */

import { execFileSync } from "node:child_process";

export interface RepoInfo {
  owner: string;
  repo: string;
  token: string;
  baseBranch: string;
}

export interface RepoInfoError {
  error: string;
}

export function detectRepoInfo(cwd: string = process.cwd()): RepoInfo | RepoInfoError {
  const url = tryExec("git", ["-C", cwd, "remote", "get-url", "origin"]);
  if (!url) return { error: "no git remote 'origin' found — not a git repo, or no remote configured" };

  const parsed = parseGitHubUrl(url.trim());
  if (!parsed) return { error: `remote is not a GitHub URL: ${url.trim()}` };

  const token = detectGithubToken();
  if (!token) {
    return {
      error:
        "no GitHub token available — set GITHUB_TOKEN/GH_TOKEN, or install gh CLI and run `gh auth login`",
    };
  }

  const branch =
    tryExec("git", ["-C", cwd, "symbolic-ref", "--short", "HEAD"])?.trim() ||
    tryExec("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"])?.trim() ||
    "main";

  return { owner: parsed.owner, repo: parsed.repo, token, baseBranch: branch };
}

function detectGithubToken(): string | undefined {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  const fromGh = tryExec("gh", ["auth", "token"]);
  return fromGh?.trim() || undefined;
}

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  // https://github.com/owner/repo(.git)?
  const httpsMatch = url.match(/^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?\/?$/);
  if (httpsMatch) return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
  return null;
}

function tryExec(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
  } catch {
    return undefined;
  }
}
