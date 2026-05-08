import { McpManager } from "../mcp/manager.js";
import { LspManager } from "../lsp/manager.js";
import { makeLspTools } from "../tools/lsp.js";
import {
  buildSessionPrefix,
  buildSystemPrompt,
} from "../agent/system-prompt.js";
import { ALL_TOOLS } from "../tools/executor.js";
import { DEFAULT_MODEL } from "../config.js";
import type { Cfg } from "../app.js";
import type { ChatMessage } from "../agent/messages.js";
import type { ToolSpec } from "../tools/registry.js";
import type { ChatEvent } from "../ui/chat.js";
import { mkKey } from "../util/event-helpers.js";
import type { Mode } from "../mode.js";

export async function initMcp(
  cfg: Cfg,
  mcpInitRef: React.MutableRefObject<boolean>,
  mcpManagerRef: React.MutableRefObject<McpManager>,
  executorRef: React.MutableRefObject<{
    register: (tool: ToolSpec) => void;
  }>,
  mcpToolsRef: React.MutableRefObject<ToolSpec[]>,
  messagesRef: React.MutableRefObject<ChatMessage[]>,
  cacheStableRef: React.MutableRefObject<boolean>,
  modeRef: React.MutableRefObject<Mode>,
  lspToolsRef: React.MutableRefObject<ToolSpec[]>,
  appendEvent: (ev: ChatEvent) => void,
): Promise<void> {
  if (!cfg.mcpServers || mcpInitRef.current) return;
  mcpInitRef.current = true;
  const manager = mcpManagerRef.current;
  let totalTools = 0;
  for (const [name, server] of Object.entries(cfg.mcpServers)) {
    if (server.enabled === false) continue;
    try {
      if (
        server.type === "local" &&
        server.command &&
        server.command.length > 0
      ) {
        await manager.addLocalServer(name, server.command, server.env);
      } else if (server.type === "remote" && server.url) {
        await manager.addRemoteServer(name, server.url, server.headers);
      } else {
        appendEvent({
          kind: "error",
          key: mkKey(),
          text: `MCP server "${name}" has invalid config`,
        });
        continue;
      }
      const tools = manager.getAllTools();
      const newTools = tools.filter(
        (t) => !mcpToolsRef.current.some((mt) => mt.name === t.name),
      );
      for (const tool of newTools) {
        executorRef.current.register(tool);
      }
      mcpToolsRef.current = tools;
      totalTools = tools.length;
    } catch (e) {
      appendEvent({
        kind: "error",
        key: mkKey(),
        text: `MCP server "${name}" failed: ${(e as Error).message}`,
      });
    }
  }
  if (totalTools > 0) {
    if (cacheStableRef.current) {
      messagesRef.current[1] = {
        role: "system",
        content: buildSessionPrefix({
          cwd: process.cwd(),
          tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
          model: cfg.model ?? DEFAULT_MODEL,
          mode: modeRef.current,
        }),
      };
    } else {
      messagesRef.current[0] = {
        role: "system",
        content: buildSystemPrompt({
          cwd: process.cwd(),
          tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
          model: cfg.model ?? DEFAULT_MODEL,
          mode: modeRef.current,
        }),
      };
    }
    appendEvent({
      kind: "info",
      key: mkKey(),
      text: `MCP connected — ${totalTools} external tool${totalTools === 1 ? "" : "s"} available`,
    });
  }
}

export async function initLsp(
  cfg: Cfg,
  lspInitRef: React.MutableRefObject<boolean>,
  lspManagerRef: React.MutableRefObject<LspManager>,
  executorRef: React.MutableRefObject<{
    register: (tool: ToolSpec) => void;
  }>,
  lspToolsRef: React.MutableRefObject<ToolSpec[]>,
  messagesRef: React.MutableRefObject<ChatMessage[]>,
  cacheStableRef: React.MutableRefObject<boolean>,
  modeRef: React.MutableRefObject<Mode>,
  mcpToolsRef: React.MutableRefObject<ToolSpec[]>,
  appendEvent: (ev: ChatEvent) => void,
): Promise<void> {
  if (!cfg.lspEnabled || !cfg.lspServers || lspInitRef.current) {
    if (lspInitRef.current) return;
    if (!cfg.lspEnabled) {
      appendEvent({
        kind: "info",
        key: mkKey(),
        text: "LSP is disabled. Enable it in config to use language servers.",
      });
    } else if (!cfg.lspServers || Object.keys(cfg.lspServers).length === 0) {
      appendEvent({
        kind: "info",
        key: mkKey(),
        text: "LSP reload complete — no servers configured.",
      });
    }
    return;
  }
  lspInitRef.current = true;
  const manager = lspManagerRef.current;
  let totalServers = 0;
  for (const [name, server] of Object.entries(cfg.lspServers)) {
    if (server.enabled === false) continue;
    try {
      await manager.startServer(name, server, process.cwd());
      totalServers++;
    } catch (e) {
      appendEvent({
        kind: "error",
        key: mkKey(),
        text: `LSP server "${name}" failed: ${(e as Error).message}`,
      });
    }
  }
  if (totalServers > 0) {
    const tools = makeLspTools(manager);
    for (const tool of tools) {
      executorRef.current.register(tool);
    }
    lspToolsRef.current = tools;
    if (cacheStableRef.current) {
      messagesRef.current[1] = {
        role: "system",
        content: buildSessionPrefix({
          cwd: process.cwd(),
          tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
          model: cfg.model ?? DEFAULT_MODEL,
          mode: modeRef.current,
        }),
      };
    } else {
      messagesRef.current[0] = {
        role: "system",
        content: buildSystemPrompt({
          cwd: process.cwd(),
          tools: [...ALL_TOOLS, ...mcpToolsRef.current, ...lspToolsRef.current],
          model: cfg.model ?? DEFAULT_MODEL,
          mode: modeRef.current,
        }),
      };
    }
    appendEvent({
      kind: "info",
      key: mkKey(),
      text: `LSP ready — ${totalServers} server${totalServers === 1 ? "" : "s"} active`,
    });
  } else {
    appendEvent({
      kind: "info",
      key: mkKey(),
      text: "LSP reload complete — no servers started (check config or enabled status).",
    });
  }
}
