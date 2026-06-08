import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "./theme-context.js";

export interface ChangelogPr {
  number: number;
  title: string;
  user: string;
  mergedAt: string;
}

interface Props {
  owner: string;
  repo: string;
  days: number;
  githubToken?: string;
  onGenerate: (owner: string, repo: string, days: number) => void;
  onCancel: () => void;
}

const PAGE_SIZE = 8;
const TIMEOUT_MS = 15_000;

async function fetchMergedPrs(
  owner: string,
  repo: string,
  days: number,
  token?: string,
): Promise<ChangelogPr[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
      { signal: controller.signal, headers },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API ${res.status}: ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }
    const prs = (await res.json()) as Array<{
      number: number;
      title: string;
      user: { login: string };
      merged_at: string | null;
    }>;
    return prs
      .filter((p) => p.merged_at && p.merged_at >= since)
      .sort((a, b) => (b.merged_at ?? "").localeCompare(a.merged_at ?? ""))
      .map((p) => ({
        number: p.number,
        title: p.title,
        user: p.user.login,
        mergedAt: p.merged_at!.slice(0, 10),
      }));
  } finally {
    clearTimeout(timer);
  }
}

export function ChangelogImagePicker({ owner, repo, days, githubToken, onGenerate, onCancel }: Props) {
  const theme = useTheme();
  const [prs, setPrs] = useState<ChangelogPr[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchMergedPrs(owner, repo, days, githubToken)
      .then((data) => {
        if (!cancelled) setPrs(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, days, githubToken]);

  const totalPages = prs ? Math.max(1, Math.ceil(prs.length / PAGE_SIZE)) : 1;
  const currentPage = Math.min(page, totalPages - 1);
  const pagePrs = prs ? prs.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE) : [];

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onGenerate(owner, repo, days);
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(pagePrs.length - 1, i + 1));
      return;
    }
    if (key.leftArrow) {
      setPage((p) => {
        const np = Math.max(0, p - 1);
        setSelectedIndex(0);
        return np;
      });
      return;
    }
    if (key.rightArrow) {
      setPage((p) => {
        const np = Math.min(totalPages - 1, p + 1);
        setSelectedIndex(0);
        return np;
      });
      return;
    }
    // Number keys 1-9 jump to item on current page
    const num = parseInt(input, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= pagePrs.length) {
      setSelectedIndex(num - 1);
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.error} paddingX={1}>
        <Text color={theme.error} bold>
          Changelog Image Error
        </Text>
        <Text color={theme.error}>{error}</Text>
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          Press Esc to close.
        </Text>
      </Box>
    );
  }

  if (prs === null) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <Text color={theme.accent} bold>
          Changelog Image
        </Text>
        <Text color={theme.info.color}>
          Fetching merged PRs for {owner}/{repo} (last {days} days)…
        </Text>
      </Box>
    );
  }

  if (prs.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.warn} paddingX={1}>
        <Text color={theme.warn} bold>
          No Merged PRs
        </Text>
        <Text color={theme.info.color}>
          No merged PRs found in {owner}/{repo} within the last {days} day(s).
        </Text>
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          Press Esc to close.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Changelog Image: {owner}/{repo}
      </Text>
      <Text color={theme.info.color} dimColor>
        {prs.length} merged PR(s) in the last {days} days · Page {currentPage + 1} of {totalPages}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {pagePrs.map((pr, i) => {
          const isSelected = i === selectedIndex;
          const marker = isSelected ? "▸" : " ";
          const title = pr.title.length > 58 ? pr.title.slice(0, 55) + "…" : pr.title;
          return (
            <Box key={pr.number}>
              <Text color={isSelected ? theme.accent : theme.info.color} bold={isSelected}>
                {marker} #{pr.number}
              </Text>
              <Text color={isSelected ? theme.palette.foreground : theme.info.color} bold={isSelected}>
                {" "}{title}
              </Text>
              <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
                {" "}· @{pr.user} · {pr.mergedAt}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          ↑↓ navigate · ←→ pages · Enter generate · Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
