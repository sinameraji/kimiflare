import type { ToolSpec, ToolOutput } from "./registry.js";
import { getUserAgent } from "../util/version.js";

interface Args {
  query: string;
  count?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const MAX_RESULTS = 10;
const DEFAULT_RESULTS = 5;
const TIMEOUT_MS = 15_000;

export const searchWebTool: ToolSpec<Args> = {
  name: "search_web",
  description:
    "Search the web using DuckDuckGo. Returns a list of results with titles, URLs, and snippets. " +
    "Use this when you need to find information but don't have a specific URL. " +
    "Prefer `web_fetch` when you already know the exact URL to retrieve.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query string.",
      },
      count: {
        type: "integer",
        description: `Number of results to return (1-${MAX_RESULTS}). Default: ${DEFAULT_RESULTS}.`,
        minimum: 1,
        maximum: MAX_RESULTS,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  needsPermission: false,
  render: (args) => ({ title: `search web: ${args.query ?? ""}` }),
  async run(args): Promise<ToolOutput> {
    const count = Math.min(Math.max(args.count ?? DEFAULT_RESULTS, 1), MAX_RESULTS);
    try {
      const results = await searchDuckDuckGo(args.query, count);

      if (results.length === 0) {
        const content = `No results found for "${args.query}".`;
        const bytes = Buffer.byteLength(content, "utf8");
        return { content, rawBytes: bytes, reducedBytes: bytes };
      }

      const lines = results.map((r, i) => {
        const snippet = r.snippet.replace(/\s+/g, " ").trim();
        return `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${snippet}`;
      });

      const content = lines.join("\n\n");
      const bytes = Buffer.byteLength(content, "utf8");
      return { content, rawBytes: bytes, reducedBytes: bytes };
    } catch (e) {
      const msg = `Error searching web: ${(e as Error).message}`;
      const bytes = Buffer.byteLength(msg, "utf8");
      return { content: msg, rawBytes: bytes, reducedBytes: bytes };
    }
  },
};

async function searchDuckDuckGo(query: string, count: number): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // DuckDuckGo HTML interface
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", query);
    url.searchParams.set("kl", "us-en");

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": getUserAgent(),
        Accept: "text/html",
      },
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo returned ${res.status}`);
    }

    const html = await res.text();
    return parseDuckDuckGoHtml(html, count);
  } finally {
    clearTimeout(timer);
  }
}

function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML results are in .result elements
  // Each result has:
  //   .result__a — title + link
  //   .result__snippet — snippet text
  const resultRegex = /<div class="result[^"]*"[^>]*>.*?<\/div>\s*<\/div>/gs;
  const matches = html.match(resultRegex) ?? [];

  for (const block of matches) {
    if (results.length >= maxResults) break;

    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/is);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/is);

    if (!titleMatch) continue;

    let url = decodeHtmlEntities(stripTags(titleMatch[1]!)).trim();
    // DuckDuckGo redirects through their own URL; extract the real URL
    if (url.startsWith("//duckduckgo.com/l/?")) {
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) {
        try {
          url = decodeURIComponent(uddg[1]!);
        } catch {
          // keep original
        }
      }
    } else if (url.startsWith("/")) {
      url = `https://duckduckgo.com${url}`;
    }

    const title = decodeHtmlEntities(stripTags(titleMatch[2]!)).trim();
    const snippet = snippetMatch
      ? decodeHtmlEntities(stripTags(snippetMatch[1]!)).trim()
      : "";

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
    "&ndash;": "–",
    "&mdash;": "—",
  };
  return text.replace(/&(?:amp|lt|gt|quot|#39|nbsp|ndash|mdash);/g, (match) => entities[match] ?? match);
}
