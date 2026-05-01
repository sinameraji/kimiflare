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

  const makeOrchestrator = (opts?: { autoSwitch?: boolean; autoSwitchConfirm?: boolean; maxTurnsPerAgent?: number; onAutoSwitchSuggestion?: (from: AgentRole, to: AgentRole, reason: string) => void }) =>
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
      autoSwitch: opts?.autoSwitch ?? false,
      autoSwitchConfirm: opts?.autoSwitchConfirm ?? false,
      maxTurnsPerAgent: opts?.maxTurnsPerAgent ?? 20,
      onAutoSwitchSuggestion: opts?.onAutoSwitchSuggestion,
    });

  function mockFetchWithAssistantResponse(content = "ok") {
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"${content}"}}]}\n\n`));
          c.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'));
          c.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
  }

  it("starts with generalist agent active", () => {
    const orch = makeOrchestrator();
    assert.strictEqual(orch.getActiveRole(), "generalist");
  });

  it("can switch active role", () => {
    const orch = makeOrchestrator();
    orch.switchTo("research");
    assert.strictEqual(orch.getActiveRole(), "research");
  });

  it("serializes and deserializes state", () => {
    const orch = makeOrchestrator();
    orch.switchTo("research");
    orch.getActiveSession().messages.push({ role: "user", content: "hello" });
    orch.getActiveSession().recentToolCalls.push("read:{}");

    const serialized = orch.serialize();
    assert.strictEqual(serialized.activeRole, "research");
    assert.strictEqual(serialized.agents.length, 3);

    const orch2 = makeOrchestrator();
    orch2.deserialize(serialized);
    assert.strictEqual(orch2.getActiveRole(), "research");
    assert.strictEqual(orch2.getActiveSession().messages.length, 1);
    assert.strictEqual(orch2.getActiveSession().recentToolCalls.length, 1);
  });

  it("handOff switches role and returns empty string when no prior messages", async () => {
    const orch = makeOrchestrator();
    const summary = await orch.handOff("coding");
    assert.strictEqual(orch.getActiveRole(), "coding");
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
    const summary = await orch.handOff("coding");
    assert.strictEqual(orch.getActiveRole(), "coding");
    assert.strictEqual(summary, "Summary of prior work.");
    const codingSession = orch.getActiveSession();
    const systemMsg = codingSession.messages.find((m) => m.role === "system");
    assert.ok(systemMsg, "should have added a system hand-off message");
    assert.ok((systemMsg!.content as string).includes("hand-off from generalist agent"));
  });

  it("auto-switches from generalist to research on exploration intent", async () => {
    mockFetchWithAssistantResponse();
    const orch = makeOrchestrator({ autoSwitch: true });
    orch.getActiveSession().messages.push({ role: "user", content: "previous work" });
    await orch.runTurn({ role: "user", content: "Explore the codebase structure" });
    assert.strictEqual(orch.getActiveRole(), "research");
    const researchSession = orch.getActiveSession();
    const systemMsg = researchSession.messages.find((m) => m.role === "system");
    assert.ok(systemMsg, "should have hand-off system message");
    assert.ok((systemMsg!.content as string).includes("hand-off from generalist agent"));
  });

  it("auto-switches from generalist to coding on implementation intent", async () => {
    mockFetchWithAssistantResponse();
    const orch = makeOrchestrator({ autoSwitch: true });
    orch.getActiveSession().messages.push({ role: "user", content: "previous work" });
    await orch.runTurn({ role: "user", content: "Implement a new logging system" });
    assert.strictEqual(orch.getActiveRole(), "coding");
    const codingSession = orch.getActiveSession();
    const systemMsg = codingSession.messages.find((m) => m.role === "system");
    assert.ok(systemMsg, "should have hand-off system message");
    assert.ok((systemMsg!.content as string).includes("hand-off from generalist agent"));
  });

  it("does not auto-switch when autoSwitch is disabled", async () => {
    mockFetchWithAssistantResponse();
    const orch = makeOrchestrator({ autoSwitch: false });
    await orch.runTurn({ role: "user", content: "Implement a new logging system" });
    assert.strictEqual(orch.getActiveRole(), "generalist");
  });

  it("emits suggestion instead of switching when autoSwitchConfirm is true", async () => {
    mockFetchWithAssistantResponse();
    let suggestion: { from: AgentRole; to: AgentRole; reason: string } | null = null;
    const orch = makeOrchestrator({
      autoSwitch: true,
      autoSwitchConfirm: true,
      onAutoSwitchSuggestion: (from, to, reason) => {
        suggestion = { from, to, reason };
      },
    });
    await orch.runTurn({ role: "user", content: "Implement a new logging system" });
    assert.strictEqual(orch.getActiveRole(), "generalist");
    assert.ok(suggestion, "should have emitted auto-switch suggestion");
    assert.strictEqual((suggestion as { from: AgentRole; to: AgentRole; reason: string }).from, "generalist");
    assert.strictEqual((suggestion as { from: AgentRole; to: AgentRole; reason: string }).to, "coding");
    assert.ok((suggestion as { from: AgentRole; to: AgentRole; reason: string }).reason.includes("coding"));
  });

  it("forces hand-off to generalist after maxTurnsPerAgent", async () => {
    mockFetchWithAssistantResponse();
    const orch = makeOrchestrator({ autoSwitch: true, maxTurnsPerAgent: 2 });
    // First turn: auto-switches to coding
    await orch.runTurn({ role: "user", content: "Implement feature A" });
    assert.strictEqual(orch.getActiveRole(), "coding");
    // Second turn: stays on coding
    await orch.runTurn({ role: "user", content: "Continue implementing" });
    assert.strictEqual(orch.getActiveRole(), "coding");
    // Third turn: forced hand-off to generalist
    await orch.runTurn({ role: "user", content: "More work" });
    assert.strictEqual(orch.getActiveRole(), "generalist");
    const generalistSession = orch.getActiveSession();
    const systemMsg = generalistSession.messages.find((m) => m.role === "system");
    assert.ok(systemMsg, "should have forced hand-off system message");
    assert.ok((systemMsg!.content as string).includes("forced after 2 turns"));
  });

  it("resets turn count on explicit switchTo", async () => {
    mockFetchWithAssistantResponse();
    const orch = makeOrchestrator({ autoSwitch: true, maxTurnsPerAgent: 2 });
    await orch.runTurn({ role: "user", content: "Implement feature A" });
    assert.strictEqual(orch.getActiveRole(), "coding");
    await orch.runTurn({ role: "user", content: "Continue implementing" });
    // Explicit switch resets count
    orch.switchTo("research");
    await orch.runTurn({ role: "user", content: "Explore the codebase" });
    // Should not force hand-off because turn count was reset
    assert.strictEqual(orch.getActiveRole(), "research");
  });

  it("synthesizeHandoff falls back to raw transcript on fetch failure", async () => {
    globalThis.fetch = async () => {
      return new Response("error", { status: 500 });
    };

    const orch = makeOrchestrator();
    orch.getActiveSession().messages.push({ role: "user", content: "test message" });
    const summary = await orch.handOff("coding");
    assert.ok(summary.includes("synthesis failed"), "should indicate synthesis failure");
    assert.ok(summary.includes("test message"), "should include raw transcript fallback");
  });

  it("auto-handoffs specialist to generalist when hand_off was forgotten", async () => {
    const longDeliverable = "A".repeat(400);
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"${longDeliverable}"}}]}\n\n`));
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
    orch.switchTo("research");
    await orch.runTurn({ role: "user", content: "Research terminal themes" });
    assert.strictEqual(orch.getActiveRole(), "generalist");
    const generalistSession = orch.getActiveSession();
    const systemMsg = generalistSession.messages.find((m) => m.role === "system");
    assert.ok(systemMsg, "should have auto hand-off system message");
    assert.ok((systemMsg!.content as string).includes("auto-detected completion"), "should indicate auto-detected completion");
    assert.ok((systemMsg!.content as string).includes(longDeliverable), "should include the full deliverable");
  });

  it("does not auto-handoff specialist when deliverable is too short", async () => {
    const shortResponse = "ok";
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"${shortResponse}"}}]}\n\n`));
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
    orch.switchTo("research");
    await orch.runTurn({ role: "user", content: "Research terminal themes" });
    assert.strictEqual(orch.getActiveRole(), "research");
  });
});
