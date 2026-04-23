import { readSSE } from "../util/sse.js";
import { KimiApiError } from "../util/errors.js";
import { jsonReplacer, sanitizeString, stableStringify } from "./messages.js";
import type { ChatMessage, ToolDef, Usage } from "./messages.js";

export type KimiEvent =
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_args"; index: number; argsDelta: string }
  | { type: "tool_call_complete"; index: number; id: string; name: string; arguments: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason: string | null; usage: Usage | null };

export interface RunKimiOpts {
  accountId: string;
  apiToken: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  signal?: AbortSignal;
  temperature?: number;
  maxCompletionTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  sessionId?: string;
}

const RETRYABLE_CODES = new Set([3040]); // "Capacity temporarily exceeded"
const MAX_ATTEMPTS = 5;

function cleanErrorMessage(msg: string): string {
  // Cloudflare Workers AI sometimes prefixes messages with redundant "AiError: "
  return msg.replace(/^(AiError:\s*)+/, "").trim();
}

function isRetryable(err: KimiApiError, attempt: number): boolean {
  if (attempt >= MAX_ATTEMPTS - 1) return false;
  if (err.code !== undefined && RETRYABLE_CODES.has(err.code)) return true;
  if (err.httpStatus !== undefined && err.httpStatus >= 500 && err.httpStatus < 600) return true;
  if (err.message.includes("Internal server error")) return true;
  return false;
}

export async function* runKimi(opts: RunKimiOpts): AsyncGenerator<KimiEvent, void, void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${opts.model}`;
  const body: Record<string, unknown> = {
    messages: sanitizeMessagesForApi(opts.messages),
    ...(opts.tools && opts.tools.length
      ? { tools: opts.tools, tool_choice: "auto", parallel_tool_calls: true }
      : {}),
    stream: true,
    temperature: opts.temperature ?? 0.2,
    max_completion_tokens: opts.maxCompletionTokens ?? 16384,
  };
  if (opts.reasoningEffort) {
    body.reasoning_effort = opts.reasoningEffort;
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${opts.apiToken}`,
        "Content-Type": "application/json",
      };
      if (opts.sessionId) {
        headers["X-Session-ID"] = opts.sessionId;
      }
      res = await fetch(url, {
        method: "POST",
        headers,
        body: stableStringify(body, jsonReplacer),
        signal: opts.signal,
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = 500 * 2 ** attempt + Math.random() * 250;
        await sleep(delay, opts.signal);
        continue;
      }
      throw new KimiApiError(`kimiflare: network error: ${msg}`, undefined, undefined);
    }

    const contentType = res.headers.get("content-type") ?? "";

    // Cloudflare returns HTTP 200 + application/json with {success:false,errors:[{code:3040}]}
    // for transient capacity errors. It also returns HTTP 5xx or OpenAI-style error objects
    // for transient internal failures. Retry those; surface everything else.
    if (!contentType.includes("text/event-stream")) {
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* ignore */
      }
      const err = extractCloudflareError(parsed);
      const rawMsg = err?.message ?? `HTTP ${res.status}: ${text.slice(0, 300)}`;
      const msg = cleanErrorMessage(rawMsg);
      const apiErr = new KimiApiError(`kimiflare: ${msg}`, err?.code, res.status);
      if (isRetryable(apiErr, attempt)) {
        const delay = 500 * 2 ** attempt + Math.random() * 250;
        await sleep(delay, opts.signal);
        continue;
      }
      throw apiErr;
    }

    if (!res.body) throw new KimiApiError("kimiflare: empty response body", undefined, res.status);

    yield* parseStream(res.body, opts.signal);
    return;
  }
}

async function* parseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<KimiEvent, void, void> {
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();
  let lastUsage: Usage | null = null;
  let finishReason: string | null = null;

  for await (const dataStr of readSSE(body, signal)) {
    if (dataStr === "[DONE]") break;
    let chunk: StreamChunk | null = null;
    try {
      chunk = JSON.parse(dataStr);
    } catch {
      continue;
    }
    if (!chunk) continue;

    if (chunk.usage) {
      lastUsage = chunk.usage;
      yield { type: "usage", usage: chunk.usage };
    }

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    const d = choice.delta;
    if (d) {
      if (typeof d.reasoning_content === "string" && d.reasoning_content.length) {
        yield { type: "reasoning", delta: d.reasoning_content };
      }
      if (typeof d.content === "string" && d.content.length) {
        yield { type: "text", delta: d.content };
      }
      if (Array.isArray(d.tool_calls)) {
        for (const tc of d.tool_calls) {
          const idx = typeof tc.index === "number" ? tc.index : 0;
          let buf = toolCalls.get(idx);
          const incomingName = tc.function?.name ?? null;
          const incomingId = tc.id ?? null;
          if (!buf) {
            buf = { id: incomingId ?? `tc_${idx}`, name: incomingName ?? "", args: "" };
            toolCalls.set(idx, buf);
            if (buf.name) {
              yield { type: "tool_call_start", index: idx, id: buf.id, name: buf.name };
            }
          } else {
            if (!buf.name && incomingName) {
              buf.name = incomingName;
              yield { type: "tool_call_start", index: idx, id: buf.id, name: buf.name };
            }
            if (buf.id.startsWith("tc_") && incomingId) buf.id = incomingId;
          }
          const argDelta = tc.function?.arguments;
          if (typeof argDelta === "string" && argDelta.length) {
            buf.args += argDelta;
            yield { type: "tool_call_args", index: idx, argsDelta: argDelta };
          }
        }
      }
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  for (const [idx, buf] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
    if (!buf.name) continue;
    yield {
      type: "tool_call_complete",
      index: idx,
      id: buf.id,
      name: buf.name,
      arguments: buf.args,
    };
  }

  yield { type: "done", finishReason, usage: lastUsage };
}

interface StreamChunk {
  choices?: StreamChoice[];
  usage?: Usage;
}
interface StreamChoice {
  delta?: StreamDelta;
  finish_reason?: string | null;
  index?: number;
}
interface StreamDelta {
  role?: string | null;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: StreamToolCall[];
}
interface StreamToolCall {
  index?: number;
  id?: string | null;
  type?: string | null;
  function?: { name?: string | null; arguments?: string | null };
}

function sanitizeMessagesForApi(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    let next: ChatMessage = m;
    if (Array.isArray(m.content)) {
      next = {
        ...m,
        content: m.content.map((part) =>
          part.type === "text" ? { ...part, text: sanitizeString(part.text) } : part,
        ),
      };
    }
    if (!next.tool_calls || next.tool_calls.length === 0) return next;
    return {
      ...next,
      tool_calls: next.tool_calls.map((tc) => ({
        ...tc,
        function: {
          name: tc.function.name,
          arguments: validateJsonArguments(tc.function.arguments),
        },
      })),
    };
  });
}

function validateJsonArguments(raw: string): string {
  if (!raw || !raw.trim()) return "{}";
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return "{}";
  }
}

function extractCloudflareError(parsed: unknown): { code?: number; message?: string } | null {
  if (!parsed || typeof parsed !== "object") return null;

  // Cloudflare native format: { success: false, errors: [...] }
  const cf = parsed as { success?: boolean; errors?: Array<{ code?: number; message?: string }> };
  if (cf.success === false && Array.isArray(cf.errors) && cf.errors.length > 0) {
    return { code: cf.errors[0]?.code, message: cf.errors[0]?.message };
  }

  // OpenAI-compatible format: { object: "error", message, code }
  const oai = parsed as { object?: string; message?: string; code?: string | number };
  if (oai.object === "error" && typeof oai.message === "string") {
    const codeNum = typeof oai.code === "number" ? oai.code : undefined;
    return { code: codeNum, message: oai.message };
  }

  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
