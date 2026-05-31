/**
 * /multi-agent settings modal — arrow-navigated field list, Enter to edit a
 * field, Esc to close. Boolean fields toggle in place; string fields open a
 * one-line text input. Mirrors the camouflage menu but lives in Ink.
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";
import { deployCommute, teardownCommute } from "../remote/deploy-commute.js";
import { openBrowser } from "./app-helpers.js";

export interface MultiAgentSettings {
  multiAgentEnabled?: boolean;
  workerEndpoint?: string;
  workerApiKey?: string;
  autoExecute?: boolean;
  cliRef?: string;
}

interface Props {
  initial: MultiAgentSettings;
  onSave: (patch: MultiAgentSettings) => void;
  onDone: () => void;
  /** Fallback Commute URL from `/remote setup`. Shown in the field display
   *  with a "(via /remote)" hint when the dedicated endpoint isn't set, so
   *  the user understands where the value comes from. */
  remoteWorkerUrl?: string;
  remoteAuthSecret?: string;
}

type Field = "enabled" | "endpoint" | "workerSecret" | "autoExecute" | "deploy" | "teardown";

const LABELS: Record<Field, string> = {
  enabled:      "Multi-agent mode",
  endpoint:     "Endpoint",
  workerSecret: "Worker secret",
  autoExecute:  "Auto-implement after research",
  deploy:       "→ Set up (deploys to your Cloudflare account, one-time)",
  teardown:     "→ Tear down (delete from your Cloudflare account)",
};

const PLACEHOLDERS: Partial<Record<Field, string>> = {
  endpoint: "https://<your-worker>.workers.dev",
};

export function MultiAgentModal({ initial, onSave, onDone, remoteWorkerUrl, remoteAuthSecret }: Props) {
  const theme = useTheme();
  const [state, setState] = useState<MultiAgentSettings>(initial);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<Field | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deployLog, setDeployLog] = useState<string[]>([]);
  const [deploying, setDeploying] = useState(false);

  const isBool = (f: Field) => f === "enabled" || f === "autoExecute";
  const currentBool = (f: Field): boolean =>
    f === "enabled" ? !!state.multiAgentEnabled : !!state.autoExecute;
  const currentStr = (f: Field): string => {
    if (f === "endpoint")     return state.workerEndpoint ?? "";
    if (f === "workerSecret") return state.workerApiKey ?? "";
    return "";
  };

  const persist = useCallback(
    (patch: MultiAgentSettings) => {
      const next = { ...state, ...patch };
      setState(next);
      onSave(patch);
    },
    [state, onSave],
  );

  // The field list is computed: hide "teardown" until an endpoint exists.
  const hasEndpoint = !!(state.workerEndpoint || remoteWorkerUrl);
  const fields: Field[] = [
    "enabled",
    "endpoint",
    "workerSecret",
    "autoExecute",
    "deploy",
    ...(hasEndpoint ? (["teardown"] as Field[]) : []),
  ];

  const runDeploy = useCallback(async () => {
    setDeploying(true);
    setDeployLog(["Starting deploy…"]);
    try {
      for await (const step of deployCommute()) {
        const prefix = step.error ? "✗ " : (step.done || step.ok) ? "✓ " : "· ";
        setDeployLog((l) => [...l, `${prefix}${step.message}`]);
        if (step.done) {
          // Pull saved values back into local state so the field list shows them.
          persist({
            workerEndpoint: undefined, // re-read from cfg via parent on next open
            multiAgentEnabled: true,
          });
        }
        if (step.error) break;
      }
    } catch (err) {
      setDeployLog((l) => [...l, `✗ ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setDeploying(false);
    }
  }, [persist]);

  const [teardownConfirming, setTeardownConfirming] = useState(false);

  const runTeardown = useCallback(async () => {
    setDeploying(true);
    setDeployLog(["Starting tear-down…"]);
    try {
      for await (const step of teardownCommute()) {
        const prefix = step.error ? "✗ " : (step.done || step.ok) ? "✓ " : "· ";
        setDeployLog((l) => [...l, `${prefix}${step.message}`]);
        if (step.done) {
          persist({
            workerEndpoint: undefined,
            workerApiKey: undefined,
            multiAgentEnabled: false,
            autoExecute: false,
          });
        }
        if (step.error) break;
      }
    } catch (err) {
      setDeployLog((l) => [...l, `✗ ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setDeploying(false);
    }
  }, [persist]);

  const beginEdit = useCallback((f: Field) => {
    if (f === "deploy") {
      void runDeploy();
      return;
    }
    if (f === "teardown") {
      setTeardownConfirming(true);
      return;
    }
    if (isBool(f)) {
      const patch: MultiAgentSettings =
        f === "enabled"
          ? { multiAgentEnabled: !state.multiAgentEnabled }
          : { autoExecute: !state.autoExecute };
      persist(patch);
      return;
    }
    setEditing(f);
    setEditValue(currentStr(f));
  }, [state, persist, runDeploy]);

  const finishEdit = useCallback((value: string) => {
    if (!editing) return;
    const trimmed = value.trim();
    const patch: MultiAgentSettings =
      editing === "endpoint" ? { workerEndpoint: trimmed || undefined }
      :                         { workerApiKey:   trimmed || undefined };
    persist(patch);
    setEditing(null);
    setEditValue("");
  }, [editing, persist]);

  useInput(
    (input, key) => {
      if (deploying) return; // Ignore input during deploy
      if (teardownConfirming) {
        if (key.escape || input === "n" || input === "N") {
          setTeardownConfirming(false);
          return;
        }
        if (input === "y" || input === "Y" || key.return) {
          setTeardownConfirming(false);
          void runTeardown();
          return;
        }
        return;
      }
      if (editing) {
        if (key.escape) { setEditing(null); setEditValue(""); }
        return;
      }
      if (key.escape) {
        if (deployLog.length > 0) { setDeployLog([]); return; } // Clear deploy log first
        onDone();
        return;
      }
      // When a deploy failed, give the user one-key shortcuts to fix the
      // most common cause (missing token scopes) and retry without leaving
      // the modal.
      const deployFailed = deployLog.some((l) => l.startsWith("✗"));
      if (deployFailed) {
        if (input === "o" || input === "O") {
          const url = deployLog
            .map((l) => l.match(/https:\/\/dash\.cloudflare\.com\/[^\s)]+/)?.[0])
            .find((u): u is string => !!u)
            ?? "https://dash.cloudflare.com/profile/api-tokens";
          openBrowser(url);
          return;
        }
        if (input === "r" || input === "R") {
          setDeployLog([]);
          void runDeploy();
          return;
        }
      }
      if (key.upArrow)   { setCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor((c) => Math.min(fields.length - 1, c + 1)); return; }
      if (key.return) {
        const f = fields[cursor];
        if (f) beginEdit(f);
      }
    },
    { isActive: true },
  );

  const renderValue = (f: Field): string => {
    if (f === "deploy") return "";
    if (isBool(f)) return currentBool(f) ? "✓ on" : "✗ off";
    const v = currentStr(f);
    if (f === "endpoint") {
      if (v) return v;
      if (remoteWorkerUrl) return `${remoteWorkerUrl}  (from /remote)`;
      return "(auto-managed by Set up)";
    }
    if (f === "workerSecret") {
      if (v) return "(set)";
      if (remoteAuthSecret) return "(from /remote)";
      return "(auto-managed by Set up)";
    }
    if (!v) return "(not set)";
    return v;
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        /multi-agent  ·  settings
      </Text>

      {teardownConfirming ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.palette.error} bold>Tear down multi-agent?</Text>
          <Text color={theme.palette.foreground}>
            This deletes the Worker and OAUTH_KV namespace from your Cloudflare account,
            and clears your local config.
          </Text>
          <Box marginTop={1}>
            <Text dimColor>y to confirm · n or Esc to cancel</Text>
          </Box>
        </Box>
      ) : editing ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.palette.foreground}>{LABELS[editing]}:</Text>
          {PLACEHOLDERS[editing] ? (
            <Text dimColor>{`example: ${PLACEHOLDERS[editing]}`}</Text>
          ) : null}
          <Box marginTop={1}>
            <CustomTextInput
              value={editValue}
              onChange={setEditValue}
              onSubmit={finishEdit}
              mask={editing === "workerSecret" ? "*" : undefined}
              focus
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter to save · Esc to cancel · blank to clear</Text>
          </Box>
        </Box>
      ) : (
        <>
          <Box flexDirection="column" marginTop={1}>
            {fields.map((f, idx) => {
              const selected = idx === cursor;
              return (
                <Box key={f}>
                  <Text color={selected ? theme.accent : theme.palette.foreground} bold={selected}>
                    {selected ? "› " : "  "}
                    {LABELS[f].padEnd(28)} {renderValue(f)}
                  </Text>
                </Box>
              );
            })}
          </Box>
          {deployLog.length > 0 && (() => {
            const failed = !deploying && deployLog.some((l) => l.startsWith("✗"));
            // Find the CTA URL in the streamed log (the error hint shows the
            // CF tokens page on its own line, prefixed with two spaces).
            const ctaUrl = deployLog
              .map((l) => l.match(/https:\/\/dash\.cloudflare\.com\/[^\s)]+/)?.[0])
              .find((u): u is string => !!u)
              ?? "https://dash.cloudflare.com/profile/api-tokens";
            return (
              <>
                <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={failed ? theme.palette.error : theme.info.color} paddingX={1}>
                  <Text color={theme.accent} bold>{deploying ? "Deploying…" : failed ? "Setup failed" : "Deploy log"}</Text>
                  {deployLog.slice(-16).map((line, i) => {
                    const isErr = line.startsWith("✗");
                    const isDone = line.startsWith("✓");
                    return (
                      <Text key={i} color={isErr ? theme.palette.error : isDone ? theme.palette.success : theme.palette.foreground}>
                        {line}
                      </Text>
                    );
                  })}
                </Box>
                {failed && (
                  <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.accent} paddingX={1}>
                    <Text color={theme.accent} bold>Next steps</Text>
                    <Text>1. Press <Text bold>O</Text> to open your Cloudflare tokens</Text>
                    <Text>2. Find the token kimiflare is using → Edit → add the scopes above</Text>
                    <Text>3. Save (the token value doesn't change)</Text>
                    <Text>4. Press <Text bold>R</Text> to retry, or Esc to close</Text>
                    <Text dimColor>{ctaUrl}</Text>
                  </Box>
                )}
              </>
            );
          })()}
          <Box marginTop={1}>
            <Text dimColor>
              {deploying
                ? "Deploying… please wait."
                : deployLog.some((l) => l.startsWith("✗"))
                  ? "O open CF tokens · R retry · Esc close"
                  : `↑↓ to pick · Enter to ${fields[cursor] === "deploy" ? "deploy" : fields[cursor] === "teardown" ? "tear down" : isBool(fields[cursor]!) ? "toggle" : "edit"} · Esc to close`}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
