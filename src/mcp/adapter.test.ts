import { describe, it } from "node:test";
import assert from "node:assert";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mcpToolToSpec, withTimeout } from "./adapter.js";

describe("withTimeout", () => {
  it("resolves when the inner promise resolves before the deadline", async () => {
    const result = await withTimeout(Promise.resolve(42), 100, "test");
    assert.strictEqual(result, 42);
  });

  it("rejects with a labeled error when the deadline elapses first", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await assert.rejects(
      () => withTimeout(slow, 20, "slow op"),
      /slow op timed out after 20ms/,
    );
  });

  it("passes the inner promise through unchanged when ms <= 0", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 0, "test");
    assert.strictEqual(result, "ok");
  });
});

function makeFakeClient(callTool: (req: unknown) => Promise<unknown>): Client {
  return { callTool } as unknown as Client;
}

describe("mcpToolToSpec timeout", () => {
  const tool = {
    name: "do_thing",
    description: "Does a thing",
    inputSchema: { type: "object" as const, properties: {} },
  };

  it("times out a hung MCP call with a recognizable error", async () => {
    const client = makeFakeClient(() => new Promise(() => {}));
    const { spec } = mcpToolToSpec("myserver", tool, client, { timeoutMs: 25 });
    await assert.rejects(
      () => spec.run({}, { cwd: "/", signal: new AbortController().signal }),
      /MCP request 'myserver\/do_thing' timed out after 25ms/,
    );
  });

  it("returns text content when the call resolves in time", async () => {
    const client = makeFakeClient(async () => ({
      content: [{ type: "text", text: "hello" }],
    }));
    const { spec } = mcpToolToSpec("s", tool, client, { timeoutMs: 1000 });
    const out = await spec.run({}, { cwd: "/", signal: new AbortController().signal });
    assert.strictEqual(out, "hello");
  });
});
