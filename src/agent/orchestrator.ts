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
import { serializeArtifactStore, deserializeArtifactStore, ArtifactStore } from "./session-state.js";
import { classifyIntent, shouldSwitchRole } from "./intent-classifier.js";

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
  /** Per-agent model overrides. Falls back to the global model if not specified. */
  agentModels?: Record<string, string>;
  /** Per-agent reasoning effort overrides. */
  agentReasoningEffort?: Record<string, import("../config.js").ReasoningEffort>;
  /** Enable automatic agent switching based on intent classification. Default: false. */
  autoSwitch?: boolean;
  /** Ask for user confirmation before auto-switching agents. When true, the orchestrator emits a suggestion instead of switching. Default: false. */
  autoSwitchConfirm?: boolean;
  /** Callback fired when an auto-switch is suggested but needs confirmation. Only used when autoSwitchConfirm is true. */
  onAutoSwitchSuggestion?: (from: AgentRole, to: AgentRole, reason: string) => void;
  /** Maximum turns per agent before forced hand-off. Default: 20. */
  maxTurnsPerAgent?: number;
  /** User-defined custom agents. */
  customAgents?: { name: string; tools: string[]; model?: string; systemPrompt?: string; reasoningEffort?: import("../config.js").ReasoningEffort }[];
}

const HANDOFF_SYSTEM = `You are synthesizing a concise hand-off summary for another specialized agent. Summarize the key context, decisions, and open tasks from the previous agent's work so the next agent can continue effectively. Be terse. Include file paths and specific details that matter. Do not include pleasantries.`;

export class AgentOrchestrator {
  private sessions: Map<AgentRole, AgentSession> = new Map();
  private activeRole: AgentRole = "generalist";
  private opts: AgentOrchestratorOpts;
  private autoSwitch: boolean;
  private autoSwitchConfirm: boolean;
  private maxTurnsPerAgent: number;
  private turnCounts: Map<AgentRole, number> = new Map();

  constructor(opts: AgentOrchestratorOpts) {
    this.opts = opts;
    this.autoSwitch = opts.autoSwitch ?? false;
    this.autoSwitchConfirm = opts.autoSwitchConfirm ?? false;
    this.maxTurnsPerAgent = opts.maxTurnsPerAgent ?? 20;
    // Built-in agents
    this.sessions.set("research", createAgentSession("research"));
    this.sessions.set("coding", createAgentSession("coding"));
    this.sessions.set("generalist", createAgentSession("generalist"));
    this.turnCounts.set("research", 0);
    this.turnCounts.set("coding", 0);
    this.turnCounts.set("generalist", 0);
    // Custom agents
    for (const agent of opts.customAgents ?? []) {
      this.sessions.set(agent.name, createAgentSession(agent.name));
      this.turnCounts.set(agent.name, 0);
    }
  }

  getActiveRole(): AgentRole {
    return this.activeRole;
  }

  getActiveSession(): AgentSession {
    return this.sessions.get(this.activeRole)!;
  }

  getActiveArtifactStore(): import("./session-state.js").ArtifactStore {
    return this.getActiveSession().artifactStore;
  }

  getLastAssistantMessage(role: AgentRole): string | null {
    const session = this.sessions.get(role);
    if (!session) return null;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m && m.role === "assistant" && typeof m.content === "string") {
        return m.content;
      }
    }
    return null;
  }

  switchTo(role: AgentRole): void {
    this.activeRole = role;
    this.turnCounts.set(role, 0);
  }

  setAutoSwitch(enabled: boolean): void {
    this.autoSwitch = enabled;
  }

  getAutoSwitch(): boolean {
    return this.autoSwitch;
  }

  /** Scan the session's last assistant message for a hand_off tool call.
   *  Returns the target role if found, null otherwise. */
  private detectHandOff(messages: ChatMessage[]): AgentRole | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (tc.function.name === "hand_off") {
            try {
              const args = JSON.parse(tc.function.arguments) as { target?: string };
              if (args.target) return args.target;
            } catch {
              // ignore parse errors
            }
          }
        }
        // Only check the most recent assistant message with tool_calls
        break;
      }
    }
    return null;
  }

  private getToolsForRole(role: AgentRole): ToolSpec[] {
    const base = getAgentTools(role, this.opts.customAgents);
    // LSP tools are additive if available
    if (this.opts.lspTools.length > 0) {
      const baseNames = new Set(base.map((t) => t.name));
      const lspAdditions = this.opts.lspTools.filter((t) => !baseNames.has(t.name));
      return [...base, ...lspAdditions];
    }
    return base;
  }

  /** Backward-compat: map old role names to new ones for config lookups. */
  private resolveAgentConfig(role: AgentRole): { model?: string; reasoningEffort?: import("../config.js").ReasoningEffort } {
    const legacyMap: Record<string, string> = { plan: "research", build: "coding", general: "generalist" };
    const legacyRole = Object.entries(legacyMap).find(([, v]) => v === role)?.[0];
    return {
      model: this.opts.agentModels?.[role] ?? (legacyRole ? this.opts.agentModels?.[legacyRole] : undefined),
      reasoningEffort: this.opts.agentReasoningEffort?.[role] ?? (legacyRole ? this.opts.agentReasoningEffort?.[legacyRole] : undefined),
    };
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

    try {
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
    } catch (err) {
      // Fallback: return raw transcript on synthesis failure
      const fallback = `[${fromRole} agent work — synthesis failed, using raw transcript]\n${transcript.slice(0, 2000)}`;
      return redactSecrets(fallback);
    }
  }

  async runTurn(userMessage: ChatMessage): Promise<void> {
    const session = this.getActiveSession();

    // Auto-switching: classify intent on user messages
    if (this.autoSwitch && userMessage.role === "user") {
      const content = typeof userMessage.content === "string" ? userMessage.content : "";
      const classification = classifyIntent({ text: content });
      const targetRole = shouldSwitchRole(this.activeRole, classification);

      if (targetRole && targetRole !== this.activeRole) {
        const fromRole = this.activeRole;
        if (this.autoSwitchConfirm) {
          this.opts.onAutoSwitchSuggestion?.(fromRole, targetRole, `Detected ${classification.role} intent (${classification.method}, confidence ${(classification.confidence * 100).toFixed(0)}%)`);
        } else {
          const summary = await this.synthesizeHandoff(fromRole, targetRole);
          this.activeRole = targetRole;
          const newSession = this.getActiveSession();
          if (summary) {
            newSession.messages.push({
              role: "system",
              content: `[hand-off from ${fromRole} agent]\n${summary}`,
            });
          }
          this.turnCounts.set(targetRole, 0);
        }
      }
    }

    // Forced hand-off: if turn count exceeds threshold, switch to generalist
    const currentTurns = this.turnCounts.get(this.activeRole) ?? 0;
    if (currentTurns >= this.maxTurnsPerAgent) {
      const fromRole = this.activeRole;
      const summary = await this.synthesizeHandoff(fromRole, "generalist");
      this.activeRole = "generalist";
      const generalistSession = this.getActiveSession();
      if (summary) {
        generalistSession.messages.push({
          role: "system",
          content: `[hand-off from ${fromRole} agent — forced after ${currentTurns} turns]\n${summary}`,
        });
      }
      this.turnCounts.set("generalist", 0);
    }

    await this.maybeCompact(session);

    session.messages.push(userMessage);

    const tools = this.getToolsForRole(this.activeRole);
    const customAgent = this.opts.customAgents?.find((a) => a.name === this.activeRole);
    const agentConfig = this.resolveAgentConfig(this.activeRole);
    const model = customAgent?.model ?? agentConfig.model ?? this.opts.model;
    const reasoningEffort = customAgent?.reasoningEffort ?? agentConfig.reasoningEffort ?? this.opts.reasoningEffort;

    // Inject custom system prompt if defined
    if (customAgent?.systemPrompt && !session.messages.some((m) => m.role === "system" && m.content === customAgent.systemPrompt)) {
      session.messages.unshift({
        role: "system",
        content: customAgent.systemPrompt,
      });
    }

    await runAgentTurn({
      accountId: this.opts.accountId,
      apiToken: this.opts.apiToken,
      model,
      gateway: this.opts.gateway,
      messages: session.messages,
      tools: [...tools, ...this.opts.mcpTools],
      executor: this.opts.executor,
      cwd: this.opts.cwd,
      signal: this.opts.signal,
      reasoningEffort,
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

    // Detect hand_off requests from the agent and trigger orchestrated hand-off
    const handOffTarget = this.detectHandOff(session.messages);
    if (handOffTarget && handOffTarget !== this.activeRole) {
      const summary = await this.synthesizeHandoff(this.activeRole, handOffTarget);
      this.activeRole = handOffTarget;
      const newSession = this.getActiveSession();
      if (summary) {
        newSession.messages.push({
          role: "system",
          content: `[hand-off from ${this.activeRole} agent — agent requested hand-off]\n${summary}`,
        });
      }
      this.turnCounts.set(handOffTarget, 0);
    }

    // Increment turn count
    this.turnCounts.set(this.activeRole, (this.turnCounts.get(this.activeRole) ?? 0) + 1);
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

  /**
   * Replay an agent's user messages with optional model/effort overrides.
   * Returns the number of turns replayed.
   */
  async replayAgent(
    role: AgentRole,
    opts: { model?: string; reasoningEffort?: "low" | "medium" | "high" } = {}
  ): Promise<number> {
    const session = this.sessions.get(role);
    if (!session) return 0;

    // Extract user messages (skip system and hand-off messages)
    const userMessages = session.messages.filter((m) => m.role === "user");
    if (userMessages.length === 0) return 0;

    // Reset session state
    session.messages = [];
    session.recentToolCalls = [];
    session.artifactStore = new ArtifactStore();
    this.turnCounts.set(role, 0);

    // Switch to this agent if not already active
    const previousRole = this.activeRole;
    this.activeRole = role;

    const tools = this.getToolsForRole(role);
    const customAgent = this.opts.customAgents?.find((a) => a.name === role);
    const agentConfig = this.resolveAgentConfig(role);
    const model = opts.model ?? customAgent?.model ?? agentConfig.model ?? this.opts.model;
    const reasoningEffort = opts.reasoningEffort ?? customAgent?.reasoningEffort ?? agentConfig.reasoningEffort ?? this.opts.reasoningEffort;

    for (const msg of userMessages) {
      session.messages.push(msg);
      await runAgentTurn({
        accountId: this.opts.accountId,
        apiToken: this.opts.apiToken,
        model,
        gateway: this.opts.gateway,
        messages: session.messages,
        tools: [...tools, ...this.opts.mcpTools],
        executor: this.opts.executor,
        cwd: this.opts.cwd,
        signal: this.opts.signal,
        reasoningEffort,
        coauthor: this.opts.coauthor,
        sessionId: this.opts.sessionId,
        memoryManager: this.opts.memoryManager,
        keepLastImageTurns: this.opts.keepLastImageTurns,
        codeMode: this.opts.codeMode,
        onFileChange: this.opts.onFileChange,
        callbacks: this.opts.callbacks,
        recentToolCalls: session.recentToolCalls,
        agentRole: role,
      });
      session.recentToolCalls = session.recentToolCalls.slice(-8);
      this.turnCounts.set(role, (this.turnCounts.get(role) ?? 0) + 1);
    }

    // Restore previous active role
    this.activeRole = previousRole;

    return userMessages.length;
  }

  serialize(): {
    activeRole: AgentRole;
    autoSwitch: boolean;
    turnCounts: Record<AgentRole, number>;
    agents: Array<{ role: AgentRole; messages: ChatMessage[]; recentToolCalls: string[]; artifactStore: ReturnType<typeof serializeArtifactStore> }>;
  } {
    const turnCounts: Record<string, number> = {};
    for (const [role, count] of this.turnCounts.entries()) {
      turnCounts[role] = count;
    }
    return {
      activeRole: this.activeRole,
      autoSwitch: this.autoSwitch,
      turnCounts,
      agents: Array.from(this.sessions.entries()).map(([role, session]) => ({
        role,
        messages: session.messages,
        recentToolCalls: session.recentToolCalls,
        artifactStore: serializeArtifactStore(session.artifactStore),
      })),
    };
  }

  deserialize(data: {
    activeRole: AgentRole;
    autoSwitch?: boolean;
    turnCounts?: Record<AgentRole, number>;
    agents: Array<{ role: AgentRole; messages: ChatMessage[]; recentToolCalls: string[]; artifactStore?: ReturnType<typeof serializeArtifactStore> }>;
  }): void {
    // Backward-compat: map old role names to new ones
    const legacyRoleMap: Record<string, string> = { plan: "research", build: "coding", general: "generalist" };
    const mapRole = (role: string): string => legacyRoleMap[role] ?? role;

    this.activeRole = mapRole(data.activeRole);
    this.autoSwitch = data.autoSwitch ?? false;
    if (data.turnCounts) {
      for (const [role, count] of Object.entries(data.turnCounts)) {
        this.turnCounts.set(mapRole(role) as AgentRole, count);
      }
    }
    for (const agent of data.agents) {
      const session = this.sessions.get(mapRole(agent.role));
      if (session) {
        session.messages = agent.messages;
        session.recentToolCalls = agent.recentToolCalls;
        if (agent.artifactStore) {
          session.artifactStore = deserializeArtifactStore(agent.artifactStore);
        }
      }
    }
  }
}
