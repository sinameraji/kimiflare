import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, render } from "ink";
import Spinner from "ink-spinner";
import { runAgentTurn } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/system-prompt.js";
import { ToolExecutor, ALL_TOOLS, type PermissionDecision } from "./tools/executor.js";
import type { ToolSpec } from "./tools/registry.js";
import type { ChatMessage, Usage } from "./agent/messages.js";
import { ChatView, type ChatEvent } from "./ui/chat.js";
import { StatusBar } from "./ui/status.js";
import { PermissionModal } from "./ui/permission.js";
import type { ToolRender } from "./tools/registry.js";
import { CustomTextInput } from "./ui/text-input.js";
import { checkForUpdate, isGitRepo, type UpdateCheckResult } from "./util/update-check.js";
import { Onboarding } from "./ui/onboarding.js";
import { configPath, DEFAULT_MODEL } from "./config.js";
import { unlink } from "node:fs/promises";

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

function App({ initialCfg }: { initialCfg: Cfg | null }) {
  const { exit } = useApp();
  const [cfg, setCfg] = useState<Cfg | null>(initialCfg);
  const [events, setEvents] = useState<ChatEvent[]>([
    { kind: "info", key: mkKey(), text: "kimiflare · /help for commands · ctrl-c to exit" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [perm, setPerm] = useState<PendingPermission | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);

  const messagesRef = useRef<ChatMessage[]>([
    {
      role: "system",
      content: buildSystemPrompt({ cwd: process.cwd(), tools: ALL_TOOLS, model: cfg?.model ?? DEFAULT_MODEL }),
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
          { kind: "info", key: mkKey(), text: `current model: ${cfg?.model ?? "unknown"}` },
        ]);
        return true;
      }
      if (c === "/update") {
        if (updateInfo?.hasUpdate) {
          setEvents((e) => [
            ...e,
            {
              kind: "info",
              key: mkKey(),
              text: `updating from ${updateInfo.localVersion} → ${updateInfo.latestVersion}…`,
            },
          ]);
          isGitRepo().then((git) => {
            if (git) {
              setEvents((e) => [
                ...e,
                {
                  kind: "info",
                  key: mkKey(),
                  text: "run:  git pull && npm install && npm run build  then restart kimiflare",
                },
              ]);
            } else {
              setEvents((e) => [
                ...e,
                {
                  kind: "info",
                  key: mkKey(),
                  text: "run:  npm update -g kimiflare  then restart",
                },
              ]);
            }
          });
        } else {
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: "no update available" },
          ]);
        }
        return true;
      }
      if (c === "/logout") {
        unlink(configPath()).catch(() => {});
        setEvents((e) => [
          ...e,
          { kind: "info", key: mkKey(), text: `credentials cleared from ${configPath()}` },
        ]);
        setCfg(null);
        return true;
      }
      if (c === "/help") {
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text:
              "commands: /clear /reasoning /cost /model /update /logout /help /exit  ·  keys: ctrl-r toggle reasoning, ctrl-c interrupt/exit",
          },
        ]);
        return true;
      }
      return false;
    },
    [cfg, exit, usage, updateInfo],
  );

  const processMessage = useCallback(
    async (text: string) => {
      if (!cfg) return;
      const trimmed = text.trim();
      if (!trimmed) return;

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
    [cfg, handleSlash, updateAssistant, updateTool],
  );

  useEffect(() => {
    if (!busy && queue.length > 0) {
      const next = queue[0]!;
      setQueue((q) => q.slice(1));
      processMessage(next);
    }
  }, [busy, queue, processMessage]);

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (busy) {
        setQueue((q) => [...q, trimmed]);
        setHistory((h) => (h.length > 0 && h[h.length - 1] === trimmed ? h : [...h, trimmed]));
        setInput("");
        setHistoryIndex(-1);
        return;
      }

      setHistory((h) => (h.length > 0 && h[h.length - 1] === trimmed ? h : [...h, trimmed]));
      setInput("");
      setHistoryIndex(-1);
      processMessage(trimmed);
    },
    [busy, processMessage],
  );

  useEffect(() => {
    // Force a re-render tick so streaming state change is flushed.
  }, [events]);

  useEffect(() => {
    checkForUpdate().then((result) => {
      if (result.hasUpdate) {
        setUpdateInfo(result);
        setEvents((e) => [
          ...e,
          {
            kind: "info",
            key: mkKey(),
            text: `update available: ${result.localVersion} → ${result.latestVersion}  ·  run /update to upgrade`,
          },
        ]);
      }
    });
  }, []);

  if (!cfg) {
    return (
      <Onboarding
        onDone={(newCfg) => {
          setCfg(newCfg);
          setEvents((e) => [
            ...e,
            { kind: "info", key: mkKey(), text: "configuration saved — welcome to kimiflare!" },
          ]);
        }}
      />
    );
  }

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
          {queue.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {queue.map((q, i) => (
                <Text key={`queue_${i}`} color="gray" dimColor>
                  ⏳ {q}
                </Text>
              ))}
            </Box>
          )}
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
                <CustomTextInput
                  value={input}
                  onChange={setInput}
                  onSubmit={submit}
                  onHistoryUp={() => {
                    if (history.length === 0) return;
                    if (historyIndex === -1) {
                      setDraftInput(input);
                      const nextIndex = history.length - 1;
                      setHistoryIndex(nextIndex);
                      setInput(history[nextIndex]!);
                    } else {
                      const nextIndex = Math.max(0, historyIndex - 1);
                      setHistoryIndex(nextIndex);
                      setInput(history[nextIndex]!);
                    }
                  }}
                  onHistoryDown={() => {
                    if (historyIndex === -1) return;
                    const nextIndex = historyIndex + 1;
                    if (nextIndex >= history.length) {
                      setHistoryIndex(-1);
                      setInput(draftInput);
                    } else {
                      setHistoryIndex(nextIndex);
                      setInput(history[nextIndex]!);
                    }
                  }}
                  onClearQueueItem={(text) => {
                    setQueue((q) => {
                      const idx = q.indexOf(text);
                      if (idx >= 0) {
                        const next = [...q];
                        next.splice(idx, 1);
                        return next;
                      }
                      return q;
                    });
                  }}
                />
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export async function renderApp(cfg: Cfg | null) {
  const instance = render(<App initialCfg={cfg} />);
  await instance.waitUntilExit();
}
