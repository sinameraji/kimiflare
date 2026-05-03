export async function createPullRequest(opts: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  token: string;
}): Promise<{ html_url: string; number: number }> {
  const res = await fetch(`https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${opts.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
      head: opts.head,
      base: opts.base,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub PR creation failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<{ html_url: string; number: number }>;
}

export async function createIssue(opts: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  token: string;
}): Promise<{ html_url: string; number: number }> {
  const res = await fetch(`https://api.github.com/repos/${opts.owner}/${opts.repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${opts.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub issue creation failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<{ html_url: string; number: number }>;
}

export async function getDefaultBranch(opts: {
  owner: string;
  repo: string;
  token: string;
}): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${opts.owner}/${opts.repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${opts.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub repo fetch failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { default_branch: string };
  return data.default_branch;
}
