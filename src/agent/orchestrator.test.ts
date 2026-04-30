import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { AgentOrchestrator } from "./orchestrator.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { AgentRole } from "./agent-session.js";

describe("AgentOrchestrator", () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  const makeOrchestrator = () =>
    new AgentOrchestrator({
      accountId: "test",
      apiToken: "token",
      model: "@cf/test/model",
      orchestratorModel: "@cf/test/plumbing",
      cwd: "/tmp",
      signal: new AbortController().signal,
      callbacks: {
        onAssistantStart: () => {},
        onReasoningDelta: () => {},
        onTextDelta: () => {},
        onToolCallStart: () => {},
        onToolCallArgs: () => {},
        onToolCallFinalized: () => {},
        onUsage: () => {},
        onUsageFinal: () => {},
        onGatewayMeta: () => {},
        onAssistantFinal: () => {},
        onToolResult: () => {},
        onTasks: () => {},
        askPermission: async () => "allow",
      },
      executor: { list: () => [], run: async () => ({ content: "ok", ok: true }) } as unknown as ToolExecutor,
      mcpTools: [],
      lspTools: [],
    });

  it("starts with general agent active", () => {
    const orch = makeOrchestrator();
    assert.strictEqual(orch.getActiveRole(), "general");
  });

  it("can switch active role", () => {
    const orch = makeOrchestrator();
    orch.switchTo("plan");
    assert.strictEqual(orch.getActiveRole(), "plan");
  });

  it("serializes and deserializes state", () => {
    const orch = makeOrchestrator();
    orch.switchTo("plan");
    orch.getActiveSession().messages.push({ role: "user", content: "hello" });
    orch.getActiveSession().recentToolCalls.push("read:{}");

    const serialized = orch.serialize();
    assert.strictEqual(serialized.activeRole, "plan");
    assert.strictEqual(serialized.agents.length, 3);

    const orch2 = makeOrchestrator();
    orch2.deserialize(serialized);
    assert.strictEqual(orch2.getActiveRole(), "plan");
    assert.strictEqual(orch2.getActiveSession().messages.length, 1);
    assert.strictEqual(orch2.getActiveSession().recentToolCalls.length, 1);
  });

  it("handOff switches role and returns empty string when no prior messages", async () => {
    const orch = makeOrchestrator();
    const summary = await orch.handOff("build");
    assert.strictEqual(orch.getActiveRole(), "build");
    assert.strictEqual(summary, "");
  });

  it("handOff adds system message with summary when prior messages exist", async () => {
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Summary of prior work."}}]}\n\n'));
          c.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'));
          c.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const orch = makeOrchestrator();
    orch.getActiveSession().messages.push({ role: "user", content: "test" });
    const summary = await orch.handOff("build");
    assert.strictEqual(orch.getActiveRole(), "build");
    assert.strictEqual(summary, "Summary of prior work.");
    const buildSession = orch.getActiveSession();
    const systemMsg = buildSession.messages.find((m) => m.role === "system");
    assert.ok(systemMsg, "should have added a system hand-off message");
    assert.ok((systemMsg!.content as string).includes("hand-off from general agent"));
  });
});
