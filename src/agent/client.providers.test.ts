/**
 * Cross-provider smoke tests for runKimi.
 *
 * The Cloudflare AI Gateway Universal Endpoint translates Anthropic / Gemini /
 * Groq / DeepSeek response shapes into OpenAI chat-completions before the bytes
 * reach us — so the parser only needs to handle one shape. These tests pin the
 * three things that actually matter for multi-provider correctness:
 *
 *   1. The OpenAI-shaped stream is parsed correctly when it carries the
 *      reasoning + tool-call shape an Anthropic/OpenAI gateway response uses.
 *   2. BYOK auth-header routing: alias > raw key > unified-billing, with the
 *      right header being sent (and the others omitted) per setting.
 *   3. Workers AI plumbing models route through gateway.ai.cloudflare.com when
 *      a gateway is configured — so memory/extraction/summarization usage
 *      shows up in the AI Gateway dashboard rather than the direct ai/run path.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { runKimi, type KimiEvent } from "./client.js";

function sse(...lines: string[]): string {
  return lines.map((l) => `data: ${l}`).join("\n\n") + "\n\n";
}

describe("runKimi: OpenAI-shaped stream from AI Gateway Universal Endpoint", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses reasoning, text, tool calls, and usage from an Anthropic-via-gateway stream", async () => {
    // Universal Endpoint translates Anthropic's thinking + tool_use blocks into
    // OpenAI-shaped chunks with `reasoning_content` and `tool_calls[*].function`.
    const body = sse(
      JSON.stringify({
        choices: [{ index: 0, delta: { reasoning_content: "Thinking…" } }],
      }),
      JSON.stringify({
        choices: [{ index: 0, delta: { content: "Sure, " } }],
      }),
      JSON.stringify({
        choices: [{ index: 0, delta: { content: "running grep." } }],
      }),
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "toolu_01abc",
                  type: "function",
                  function: { name: "shell", arguments: `{"cmd":` },
                },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: `"grep -r foo"}` } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 42, completion_tokens: 7 },
      }),
      "[DONE]",
    );

    globalThis.fetch = async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });

    const events: KimiEvent[] = [];
    for await (const ev of runKimi({
      accountId: "a",
      apiToken: "t",
      model: "anthropic/claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
      gateway: { id: "gw" },
      providerKeys: { anthropic: "sk-ant-test" },
    })) {
      events.push(ev);
    }

    const text = events
      .filter((e): e is Extract<KimiEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta)
      .join("");
    assert.strictEqual(text, "Sure, running grep.");

    const reasoning = events
      .filter((e): e is Extract<KimiEvent, { type: "reasoning" }> => e.type === "reasoning")
      .map((e) => e.delta)
      .join("");
    assert.strictEqual(reasoning, "Thinking…");

    const completedCall = events.find(
      (e): e is Extract<KimiEvent, { type: "tool_call_complete" }> =>
        e.type === "tool_call_complete",
    );
    assert.ok(completedCall, "expected a tool_call_complete event");
    assert.strictEqual(completedCall.name, "shell");
    assert.strictEqual(completedCall.id, "toolu_01abc");
    assert.strictEqual(completedCall.arguments, `{"cmd":"grep -r foo"}`);

    const done = events.find(
      (e): e is Extract<KimiEvent, { type: "done" }> => e.type === "done",
    );
    assert.ok(done);
    assert.strictEqual(done.finishReason, "tool_calls");
    assert.strictEqual(done.usage?.prompt_tokens, 42);
    assert.strictEqual(done.usage?.completion_tokens, 7);
  });
});

describe("runKimi: provider auth-header routing (BYOK alias vs raw key vs unified)", () => {
  let originalFetch: typeof globalThis.fetch;
  let lastRequest: Request | null = null;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      lastRequest = new Request(input, init);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });
  beforeEach(() => {
    lastRequest = null;
  });

  const baseOpts = {
    accountId: "acct",
    apiToken: "cf-token",
    model: "anthropic/claude-haiku-4-5",
    messages: [{ role: "user" as const, content: "hi" }],
    gateway: { id: "gw" },
  };

  it("with providerKeyAliases set: sends cf-aig-byok-alias and omits cf-aig-authorization", async () => {
    for await (const _ of runKimi({
      ...baseOpts,
      providerKeyAliases: { anthropic: "kimi-code-anthropic-abc123" },
    })) {
      /* drain */
    }
    assert.ok(lastRequest);
    assert.strictEqual(
      lastRequest!.headers.get("cf-aig-byok-alias"),
      "kimi-code-anthropic-abc123",
    );
    assert.strictEqual(lastRequest!.headers.get("cf-aig-authorization"), null);
  });

  it("alias takes precedence over raw providerKey when both are set", async () => {
    for await (const _ of runKimi({
      ...baseOpts,
      providerKeyAliases: { anthropic: "alias-1" },
      providerKeys: { anthropic: "sk-ant-stale" },
    })) {
      /* drain */
    }
    assert.strictEqual(lastRequest!.headers.get("cf-aig-byok-alias"), "alias-1");
    assert.strictEqual(lastRequest!.headers.get("cf-aig-authorization"), null);
  });

  it("with only providerKeys set: sends cf-aig-authorization with raw key (local-fallback path)", async () => {
    for await (const _ of runKimi({
      ...baseOpts,
      providerKeys: { anthropic: "sk-ant-local" },
    })) {
      /* drain */
    }
    assert.strictEqual(
      lastRequest!.headers.get("cf-aig-authorization"),
      "Bearer sk-ant-local",
    );
    assert.strictEqual(lastRequest!.headers.get("cf-aig-byok-alias"), null);
  });

  it("with unifiedBilling=true: sends neither byok header (CF pays via credits)", async () => {
    for await (const _ of runKimi({
      ...baseOpts,
      unifiedBilling: true,
    })) {
      /* drain */
    }
    assert.strictEqual(lastRequest!.headers.get("cf-aig-byok-alias"), null);
    assert.strictEqual(lastRequest!.headers.get("cf-aig-authorization"), null);
    // gateway-level auth still rides on Authorization
    assert.strictEqual(lastRequest!.headers.get("Authorization"), "Bearer cf-token");
  });

  it("unifiedBilling wins even if a raw key is present (user opted into CF billing)", async () => {
    for await (const _ of runKimi({
      ...baseOpts,
      unifiedBilling: true,
      providerKeys: { anthropic: "sk-ant-ignored" },
    })) {
      /* drain */
    }
    assert.strictEqual(lastRequest!.headers.get("cf-aig-authorization"), null);
    assert.strictEqual(lastRequest!.headers.get("cf-aig-byok-alias"), null);
  });
});

describe("runKimi: Workers AI plumbing routes through gateway when configured", () => {
  let originalFetch: typeof globalThis.fetch;
  let lastRequest: Request | null = null;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      lastRequest = new Request(input, init);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("hits gateway.ai.cloudflare.com (not api.cloudflare.com) for @cf/* models when gateway.id is set", async () => {
    for await (const _ of runKimi({
      accountId: "acct",
      apiToken: "cf-token",
      model: "@cf/meta/llama-3.2-3b-instruct",
      messages: [{ role: "user", content: "hi" }],
      gateway: { id: "my-gw", metadata: { feature: "extraction" } },
    })) {
      /* drain */
    }
    assert.ok(lastRequest);
    const url = lastRequest!.url;
    assert.ok(
      url.startsWith("https://gateway.ai.cloudflare.com/v1/acct/my-gw/workers-ai/"),
      `expected gateway-prefixed URL, got: ${url}`,
    );
    // Plumbing tags ride along via cf-aig-metadata so the dashboard can filter.
    const meta = lastRequest!.headers.get("cf-aig-metadata");
    assert.ok(meta && meta.includes("extraction"));
  });
});
