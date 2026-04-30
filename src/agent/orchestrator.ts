import type { ChatMessage } from "./messages.js";
import type { ToolSpec } from "../tools/registry.js";
import type { AgentCallbacks, AgentTurnOpts } from "./loop.js";
import { runAgentTurn } from "./loop.js";
import { redactSecrets } from "../memory/manager.js";
import { compactMessages } from "./compact.js";
import { shouldCompact } from "./compaction.js";
import { runKimi } from "./client.js";
import type { AiGatewayOptions } from "./client.js";
import { createAgentSession, getAgentTools, type AgentRole, type AgentSession } from "./agent-session.js";

export interface AgentOrchestratorOpts {
  accountId: string;
  apiToken: string;
  model: string;
  orchestratorModel: string;
  gateway?: AiGatewayOptions;
  cwd: string;
  signal: AbortSignal;
  reasoningEffort?: "low" | "medium" | "high";
  coauthor?: { name: string; email: string };
  sessionId?: string;
  memoryManager?: import("../memory/manager.js").MemoryManager | null;
  keepLastImageTurns?: number;
  codeMode?: boolean;
  onFileChange?: (path: string, content: string) => void;
  callbacks: AgentCallbacks;
  executor: import("../tools/executor.js").ToolExecutor;
  mcpTools: ToolSpec[];
  lspTools: ToolSpec[];
}

const HANDOFF_SYSTEM = `You are synthesizing a concise hand-off summary for another specialized agent. Summarize the key context, decisions, and open tasks from the previous agent's work so the next agent can continue effectively. Be terse. Include file paths and specific details that matter. Do not include pleasantries.`;

export class AgentOrchestrator {
  private sessions: Map<AgentRole, AgentSession> = new Map();
  private activeRole: AgentRole = "general";
  private opts: AgentOrchestratorOpts;

  constructor(opts: AgentOrchestratorOpts) {
    this.opts = opts;
    this.sessions.set("plan", createAgentSession("plan"));
    this.sessions.set("build", createAgentSession("build"));
    this.sessions.set("general", createAgentSession("general"));
  }

  getActiveRole(): AgentRole {
    return this.activeRole;
  }

  getActiveSession(): AgentSession {
    return this.sessions.get(this.activeRole)!;
  }

  switchTo(role: AgentRole): void {
    this.activeRole = role;
  }

  private getToolsForRole(role: AgentRole): ToolSpec[] {
    const base = getAgentTools(role);
    // LSP tools are additive if available
    if (this.opts.lspTools.length > 0) {
      const baseNames = new Set(base.map((t) => t.name));
      const lspAdditions = this.opts.lspTools.filter((t) => !baseNames.has(t.name));
      return [...base, ...lspAdditions];
    }
    return base;
  }

  private async maybeCompact(session: AgentSession): Promise<void> {
    if (shouldCompact({ messages: session.messages })) {
      const result = await compactMessages({
        accountId: this.opts.accountId,
        apiToken: this.opts.apiToken,
        model: this.opts.orchestratorModel,
        messages: session.messages,
        keepLastTurns: 4,
        signal: this.opts.signal,
        gateway: this.opts.gateway,
      });
      session.messages = result.newMessages;
    }
  }

  private async synthesizeHandoff(fromRole: AgentRole, toRole: AgentRole): Promise<string> {
    const fromSession = this.sessions.get(fromRole)!;
    if (fromSession.messages.length === 0) return "";

    // Extract non-system messages for synthesis
    const relevant = fromSession.messages.filter((m) => m.role !== "system");
    if (relevant.length === 0) return "";

    const transcript = relevant
      .map((m) => {
        const content = typeof m.content === "string" ? m.content : "";
        if (m.role === "tool") {
          return `[tool ${m.name ?? ""}] ${content.slice(0, 300)}`;
        }
        if (m.role === "assistant") {
          const calls = m.tool_calls?.map((c) => c.function.name).join(", ") ?? "";
          return `[assistant${calls ? ` tools: ${calls}` : ""}] ${content.slice(0, 300)}`;
        }
        return `[${m.role}] ${content.slice(0, 300)}`;
      })
      .join("\n");

    let summary = "";
    const events = runKimi({
      accountId: this.opts.accountId,
      apiToken: this.opts.apiToken,
      model: this.opts.orchestratorModel,
      messages: [
        { role: "system", content: HANDOFF_SYSTEM },
        {
          role: "user",
          content: `Previous ${fromRole} agent transcript:\n${transcript}\n\nSynthesize a hand-off summary for the ${toRole} agent.`,
        },
      ],
      signal: this.opts.signal,
      temperature: 0.1,
      reasoningEffort: "low",
      gateway: this.opts.gateway,
    });

    for await (const ev of events) {
      if (ev.type === "text") summary += ev.delta;
      if (this.opts.signal.aborted) throw new DOMException("aborted", "AbortError");
    }

    return redactSecrets(summary.trim());
  }

  async runTurn(userMessage: ChatMessage): Promise<void> {
    const session = this.getActiveSession();

    // If switching from another agent, synthesize hand-off
    // For now, hand-offs are triggered explicitly by slash commands in app.tsx
    // This method just runs a turn for the current active agent

    await this.maybeCompact(session);

    session.messages.push(userMessage);

    const tools = this.getToolsForRole(this.activeRole);

    await runAgentTurn({
      accountId: this.opts.accountId,
      apiToken: this.opts.apiToken,
      model: this.opts.model,
      gateway: this.opts.gateway,
      messages: session.messages,
      tools: [...tools, ...this.opts.mcpTools],
      executor: this.opts.executor,
      cwd: this.opts.cwd,
      signal: this.opts.signal,
      reasoningEffort: this.opts.reasoningEffort,
      coauthor: this.opts.coauthor,
      sessionId: this.opts.sessionId,
      memoryManager: this.opts.memoryManager,
      keepLastImageTurns: this.opts.keepLastImageTurns,
      codeMode: this.opts.codeMode,
      onFileChange: this.opts.onFileChange,
      callbacks: this.opts.callbacks,
      recentToolCalls: session.recentToolCalls,
      agentRole: this.activeRole,
    });

    // Update recentToolCalls from the session (runAgentTurn mutates it)
    session.recentToolCalls = session.recentToolCalls.slice(-8);
  }

  async handOff(toRole: AgentRole): Promise<string> {
    const fromRole = this.activeRole;
    if (fromRole === toRole) return "";

    const summary = await this.synthesizeHandoff(fromRole, toRole);
    this.activeRole = toRole;
    const session = this.getActiveSession();

    if (summary) {
      session.messages.push({
        role: "system",
        content: `[hand-off from ${fromRole} agent]\n${summary}`,
      });
    }

    return summary;
  }

  serialize(): {
    activeRole: AgentRole;
    agents: Array<{ role: AgentRole; messages: ChatMessage[]; recentToolCalls: string[] }>;
  } {
    return {
      activeRole: this.activeRole,
      agents: Array.from(this.sessions.entries()).map(([role, session]) => ({
        role,
        messages: session.messages,
        recentToolCalls: session.recentToolCalls,
      })),
    };
  }

  deserialize(data: {
    activeRole: AgentRole;
    agents: Array<{ role: AgentRole; messages: ChatMessage[]; recentToolCalls: string[] }>;
  }): void {
    this.activeRole = data.activeRole;
    for (const agent of data.agents) {
      const session = this.sessions.get(agent.role);
      if (session) {
        session.messages = agent.messages;
        session.recentToolCalls = agent.recentToolCalls;
      }
    }
  }
}
