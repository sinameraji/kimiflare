import TurndownService from "turndown";
import { getUserAgent } from "../util/version.js";
import type { ToolSpec, ToolOutput } from "./registry.js";

interface Args {
  url: string;
}

const MAX_BYTES = 1 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export const webFetchTool: ToolSpec<Args> = {
  name: "web_fetch",
  description:
    "Fetch a URL over HTTPS and return its content. HTML pages are converted to markdown. Large pages are reduced to a summary by default; use expand_artifact to retrieve the full content.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full URL, http(s)." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  needsPermission: false,
  render: (args) => ({ title: `GET ${args.url ?? ""}` }),
  async run(args): Promise<ToolOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(args.url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": getUserAgent() },
      });
      const ct = res.headers.get("content-type") ?? "";
      const body = await res.text();
      const bounded = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
      let raw: string;
      if (ct.toLowerCase().includes("html")) {
        const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
        raw = `# ${args.url}\n\n${td.turndown(bounded)}`;
      } else {
        raw = `# ${args.url}\n\n${bounded}`;
      }
      return {
        content: raw,
        rawBytes: Buffer.byteLength(raw, "utf8"),
        reducedBytes: Buffer.byteLength(raw, "utf8"),
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
