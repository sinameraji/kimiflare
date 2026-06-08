import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolSpec, ToolContext, ToolOutput } from "./registry.js";
import { Resvg } from "@resvg/resvg-js";

const GITHUB_API_BASE = "https://api.github.com";
const TIMEOUT_MS = 20_000;

interface ChangelogImageArgs {
  owner: string;
  repo: string;
  days?: number;
  output?: string;
}

interface MergedPr {
  number: number;
  title: string;
  user: { login: string };
  merged_at: string;
  html_url: string;
}

interface Release {
  tag_name: string;
  name: string;
  published_at: string;
}

async function githubFetch(path: string, token?: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${GITHUB_API_BASE}${path}`, {
      signal: controller.signal,
      headers,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API ${res.status}: ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function getToken(ctx: ToolContext): string | undefined {
  return ctx.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function loadLogoBase64(): Promise<string | null> {
  try {
    const logoPath = join(process.cwd(), "docs", "logo.png");
    const buf = await readFile(logoPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function buildChangelogSvg(opts: {
  owner: string;
  repo: string;
  version: string;
  prs: MergedPr[];
  logoBase64: string | null;
}): string {
  const { owner, repo, version, prs, logoBase64 } = opts;
  const width = 1200;
  const headerHeight = 280;
  const prItemHeight = 90;
  const footerHeight = 80;
  const padding = 60;
  const height = headerHeight + prs.length * prItemHeight + footerHeight + padding * 2;

  const prItems = prs.map((pr, i) => {
    const y = headerHeight + padding + i * prItemHeight;
    const title = escapeXml(pr.title.length > 70 ? pr.title.slice(0, 67) + "..." : pr.title);
    const date = pr.merged_at.slice(0, 10);
    return `
      <g transform="translate(${padding}, ${y})">
        <rect x="0" y="0" width="${width - padding * 2}" height="${prItemHeight - 16}" rx="12" fill="#1a1a2e" stroke="#2a2a4e" stroke-width="1"/>
        <text x="24" y="38" fill="#e0e0ff" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="600">${title}</text>
        <text x="24" y="64" fill="#8888aa" font-family="system-ui, -apple-system, sans-serif" font-size="16">#${pr.number} by @${escapeXml(pr.user.login)} · merged ${date}</text>
        <circle cx="${width - padding * 2 - 30}" cy="${(prItemHeight - 16) / 2}" r="8" fill="#4ade80"/>
      </g>
    `;
  }).join("");

  const logoSection = logoBase64
    ? `<image x="${width / 2 - 48}" y="40" width="96" height="96" href="${logoBase64}"/>`
    : `<circle cx="${width / 2}" cy="88" r="48" fill="#f59e0b"/><text x="${width / 2}" y="100" text-anchor="middle" fill="#0f0f1a" font-family="system-ui, sans-serif" font-size="36" font-weight="bold">${escapeXml(repo[0]?.toUpperCase() ?? "?")}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f0f1a"/>
      <stop offset="100%" stop-color="#1a1a2e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bg)"/>

  <!-- Decorative top line -->
  <rect x="0" y="0" width="${width}" height="4" fill="url(#accent)"/>

  <!-- Header -->
  <g transform="translate(0, 20)">
    ${logoSection}
    <text x="${width / 2}" y="170" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="700">${escapeXml(owner)}/${escapeXml(repo)}</text>
    <text x="${width / 2}" y="215" text-anchor="middle" fill="#f59e0b" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="600">${escapeXml(version)}</text>
    <text x="${width / 2}" y="255" text-anchor="middle" fill="#8888aa" font-family="system-ui, -apple-system, sans-serif" font-size="18">What's new in this release</text>
  </g>

  <!-- PR List -->
  ${prItems}

  <!-- Footer -->
  <g transform="translate(0, ${height - footerHeight})">
    <rect x="0" y="0" width="${width}" height="${footerHeight}" fill="#0a0a14"/>
    <text x="${width / 2}" y="48" text-anchor="middle" fill="#555577" font-family="system-ui, -apple-system, sans-serif" font-size="16">Generated with KimiFlare · ${escapeXml(new Date().toISOString().slice(0, 10))}</text>
  </g>
</svg>`;
}

export const changelogImageTool: ToolSpec<ChangelogImageArgs> = {
  name: "changelog_image",
  description:
    "Generate a beautiful changelog image for a GitHub repository. " +
    "Fetches merged PRs from the last N days and the latest release, " +
    "then renders a shareable PNG with the project logo, version, and PR list.",
  parameters: {
    type: "object",
    properties: {
      owner: { type: "string", description: "Repository owner (user or organization)." },
      repo: { type: "string", description: "Repository name." },
      days: { type: "integer", description: "Number of days to look back for merged PRs. Default: 7.", minimum: 1, maximum: 90 },
      output: { type: "string", description: "Output file path for the PNG. Default: ./changelog-<repo>-<version>.png" },
    },
    required: ["owner", "repo"],
    additionalProperties: false,
  },
  needsPermission: false,
  render: (args) => ({ title: `Changelog image for ${args.owner ?? ""}/${args.repo ?? ""}` }),
  async run(args, ctx): Promise<ToolOutput> {
    const token = getToken(ctx);
    const days = args.days ?? 7;

    // 1. Fetch merged PRs
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const prs = await githubFetch(
      `/repos/${args.owner}/${args.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
      token,
    ) as MergedPr[];

    const merged = prs
      .filter((p) => p.merged_at && p.merged_at >= since)
      .sort((a, b) => (b.merged_at ?? "").localeCompare(a.merged_at ?? ""));

    if (merged.length === 0) {
      return {
        content: `No merged PRs in ${args.owner}/${args.repo} within the last ${days} day(s).`,
        rawBytes: 0,
        reducedBytes: 0,
      };
    }

    // 2. Fetch latest release
    let version = "latest";
    try {
      const releases = await githubFetch(
        `/repos/${args.owner}/${args.repo}/releases?per_page=1`,
        token,
      ) as Release[];
      if (releases.length > 0) {
        version = releases[0]!.tag_name;
      }
    } catch {
      // Fallback: try to get latest tag
      try {
        const tags = await githubFetch(
          `/repos/${args.owner}/${args.repo}/tags?per_page=1`,
          token,
        ) as Array<{ name: string }>;
        if (tags.length > 0) {
          version = tags[0]!.name;
        }
      } catch {
        // leave as "latest"
      }
    }

    // 3. Load logo
    const logoBase64 = await loadLogoBase64();

    // 4. Build SVG
    const svg = buildChangelogSvg({ owner: args.owner, repo: args.repo, version, prs: merged, logoBase64 });

    // 5. Render to PNG
    const resvg = new Resvg(svg, {
      fitTo: { mode: "original" },
      font: {
        // Use system fonts; resvg will fallback gracefully
        defaultFontFamily: "system-ui",
      },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // 6. Save
    const outputPath = args.output ?? `./changelog-${args.repo}-${version.replace(/[^a-zA-Z0-9._-]/g, "_")}.png`;
    await writeFile(outputPath, pngBuffer);

    const content = [
      `✓ Changelog image generated: ${outputPath}`,
      `  Repository: ${args.owner}/${args.repo}`,
      `  Version: ${version}`,
      `  PRs included: ${merged.length}`,
      `  Lookback: ${days} days`,
      `  Dimensions: ${resvg.width}x${resvg.height}px`,
      "",
      "Merged PRs:",
      ...merged.map((p) => `  #${p.number} ${p.title} — @${p.user.login}`),
    ].join("\n");

    const bytes = Buffer.byteLength(content, "utf8");
    return { content, rawBytes: bytes, reducedBytes: bytes };
  },
};
