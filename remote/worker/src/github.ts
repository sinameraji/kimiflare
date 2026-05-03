const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubRepo {
  owner: string;
  name: string;
}

export async function pushBranch(
  token: string,
  repo: GitHubRepo,
  branch: string,
  artifactsUrl: string,
  artifactsToken: string,
): Promise<void> {
  // Clone the artifacts repo, then push to GitHub
  // This is done by creating a temporary git remote and pushing
  const authArtifactsUrl = artifactsUrl.replace("https://", `https://token:${artifactsToken}@`);
  const authGithubUrl = `https://x-access-token:${token}@github.com/${repo.owner}/${repo.name}.git`;

  // In practice, this would be done inside the Worker using a git library or subprocess
  // For now, we'll use the GitHub API to create a PR with the branch
  // The actual push would need to happen via a git client

  // Note: Cloudflare Workers don't have git CLI available.
  // We need to use the GitHub API to create a PR, but the branch must already exist on GitHub.
  // Alternative: use a git WASM implementation or delegate push to the Sandbox.

  // For v1, we'll have the Sandbox push directly to GitHub using a short-lived token
  // This is a pragmatic compromise — the token is scoped and short-lived.
}

export async function createPullRequest(
  token: string,
  repo: GitHubRepo,
  branch: string,
  title: string,
  body: string,
): Promise<{ html_url: string; number: number }> {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.name}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body,
      head: branch,
      base: "main",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub PR creation failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { html_url: string; number: number };
  return data;
}

export async function getDefaultBranch(
  token: string,
  repo: GitHubRepo,
): Promise<string> {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.name}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to get repo info: ${res.status}`);
  }

  const data = await res.json() as { default_branch: string };
  return data.default_branch;
}

export async function validateToken(token: string): Promise<boolean> {
  const res = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  return res.ok;
}
