import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, render } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { runAgentTurn } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS, type PermissionDecision } from "./tools/executor.js";
import type { ToolSpec } from "./tools/registry.js";
import type { ChatMessage, Usage } from "./agent/messages.js";
import { ChatView, type ChatEvent } from "./ui/chat.js";
import { StatusBar } from "./ui/status.js";
import { PermissionModal } from "./ui/permission.js";
import type { ToolRender } from "./tools/registry.js";

interface Cfg {
  accountId: string;
  apiToken: string;
  model: string;
}

interface PendingPermission {
  tool: ToolSpec;
  args: Record<string, unknown>;
  resolve: (d: PermissionDecision) => void;
}

let nextAssistantId = 1;
let nextKey = 1;
const mkKey = () => `evt_${nextKey++}`;

function App({ cfg }: { cfg: Cfg }) {
  const { exit } = useApp();
  const [events, setEvents] = useState<ChatEvent[]>([
    { kind: "info", key: mkKey(), text: "kimi-code · /help for commands · ctrl-c to exit" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [perm, setPerm] = useState<PendingPermission | null>(null);

  const messagesRef = useRef<ChatMessage[]>([
    {
      role: "system",
      content: buildSystemPrompt({ cwd: process.cwd(), tools: ALL_TOOLS, model: cfg.model }),
    },
  ]);
  const executorRef = useRef<ToolExecutor>(new ToolExecutor(ALL_TOOLS));
  const activeAsstIdRef = useRef<number | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      if (busy && activeControllerRef.current) {
        activeControllerRef.current.abort();
        setEvents((e) => [...e, { kind: "info", key: mkKey(), text: "(interrupted)" }]);
      } else {
        exit();
      }
    }
    if (key.ctrl && inputChar === "r") setShowReasoning((s) => !s);
  });

  const updateAssistant = useCallback(
    (id: number, patch: (e: Extract<ChatEvent, { kind: "assistant" }>) => Partial<ChatEvent>) => {
      setEvents((evts) =>
        evts.map((e) =>
          e.kind === "assistant" && e.id === id ? ({ ...e, ...patch(e) } as ChatEvent) : e,
        ),
      );
    },
    [],
  );

  const updateTool = useCallback(
    (id: string, patch: Partial<Extract<ChatEvent, { kind: "tool" }>>) => {
      setEvents((evts) =>
        evts.map((e) =>
          e.kind === "tool" && e.id === id ? ({ ...e, ...patch } as ChatEvent) : e,
        ),
      );
    },
    [],
  );

  const handleSlash = useCallback(
    (cmd: string): boolean => {
      const c = cmd.trim().toLowerCase();
      if (c === "/exit" || c === "/quit") {
        exit();
        return true;
      }
      if (c === "/clear") {
        messagesRef.current = [messagesRef.current[0]!];
        setEvents([{ kind: "info", key: mkKey(), text: "conversation cleared" }]);
        setUsage(null);
        return true;
      }
      if (c === "/reasoning") {
        setShowReasoning((s) => {
          const next = !s;
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: `reasoning: ${next ? "shown" : "hidden"}` },
          ]);
          return next;
        });
        return true;
      }
      if (c === "/cost") {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: usage
              ? `prompt ${usage.prompt_tokens} / completion ${usage.completion_tokens}`
              : "no usage yet",
          },
        ]);
        return true;
      }
      if (c === "/model") {
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `current model: ${cfg.model}` },
        ]);
        return true;
      }
      if (c === "/help") {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text:
              "commands: /clear /reasoning /cost /model /help /exit  ·  keys: ctrl-r toggle reasoning, ctrl-c interrupt/exit",
          },
        ]);
        return true;
      }
      return false;
    },
    [cfg.model, exit, usage],
  );

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setInput("");

      if (trimmed.startsWith("/") && handleSlash(trimmed)) return;

      setEvents((e) => [...e, { kind: "user", key: mkKey(), text: trimmed }]);
      messagesRef.current.push({ role: "user", content: trimmed });
      setBusy(true);

      const controller = new AbortController();
      activeControllerRef.current = controller;

      try {
        await runAgentTurn({
          accountId: cfg.accountId,
          apiToken: cfg.apiToken,
          model: cfg.model,
          messages: messagesRef.current,
          tools: ALL_TOOLS,
          executor: executorRef.current,
          cwd: process.cwd(),
          signal: controller.signal,
          callbacks: {
            onAssistantStart: () => {
              const id = nextAssistantId++;
              activeAsstIdRef.current = id;
              setEvents((e) => [
                ...e,
                { kind: "assistant", key: `asst_${id}`, id, text: "", reasoning: "", streaming: true },
              ]);
            },
            onReasoningDelta: (d) => {
              const id = activeAsstIdRef.current;
              if (id !== null) updateAssistant(id, (e) => ({ reasoning: e.reasoning + d }));
            },
            onTextDelta: (d) => {
              const id = activeAsstIdRef.current;
              if (id !== null) updateAssistant(id, (e) => ({ text: e.text + d }));
            },
            onAssistantFinal: () => {
              const id = activeAsstIdRef.current;
              if (id !== null) updateAssistant(id, () => ({ streaming: false }));
            },
            onToolCallFinalized: (call) => {
              const spec = executorRef.current.list().find((t) => t.name === call.function.name);
              let renderMeta: ToolRender | undefined;
              try {
                const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                renderMeta = spec?.render?.(args);
              } catch {
                /* ignore render failure */
              }
              setEvents((e) => [
                ...e,
                {
                  kind: "tool",
                  key: `tool_${call.id}`,
                  id: call.id,
                  name: call.function.name,
                  args: call.function.arguments,
                  status: "running",
                  render: renderMeta,
                  expanded: false,
                },
              ]);
            },
            onToolResult: (r) => {
              updateTool(r.tool_call_id, {
                status: r.ok ? "done" : "error",
                result: r.content,
              });
            },
            onUsage: (u) => setUsage(u),
            askPermission: (req) =>
              new Promise<PermissionDecision>((resolve) => {
                setPerm({ tool: req.tool, args: req.args, resolve });
              }),
          },
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setEvents((es) => [...es, { kind: "info", key: mkKey(), text: "(aborted)" }]);
        } else {
          setEvents((es) => [
            ...es,
            { kind: "error", key: mkKey(), text: (e as Error).message ?? String(e) },
          ]);
        }
      } finally {
        setBusy(false);
        activeAsstIdRef.current = null;
        activeControllerRef.current = null;
      }
    },
    [busy, cfg, handleSlash, updateAssistant, updateTool],
  );

  useEffect(() => {
    // Force a re-render tick so streaming state change is flushed.
  }, [events]);

  return (
    <Box flexDirection="column">
      <ChatView events={events} showReasoning={showReasoning} />
      {perm ? (
        <PermissionModal
          tool={perm.tool}
          args={perm.args}
          onDecide={(d) => {
            perm.resolve(d);
            setPerm(null);
          }}
        />
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <StatusBar
            model={cfg.model}
            usage={usage}
            thinking={busy}
            hint={busy ? "ctrl-c to interrupt" : "enter to send · /help"}
          />
          <Box>
            {busy ? (
              <Box>
                <Text color="yellow">
                  <Spinner type="dots" />
                </Text>
                <Text color="gray"> working…</Text>
              </Box>
            ) : (
              <Box>
                <Text color="cyan">› </Text>
                <TextInput value={input} onChange={setInput} onSubmit={submit} />
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export async function renderApp(cfg: Cfg) {
  const instance = render(<App cfg={cfg} />);
  await instance.waitUntilExit();
}
