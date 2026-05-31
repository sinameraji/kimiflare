/**
 * /multi-agent settings modal — arrow-navigated field list, Enter to edit a
 * field, Esc to close. Boolean fields toggle in place; string fields open a
 * one-line text input. Mirrors the camouflage menu but lives in Ink.
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";
import { deployCommute } from "../remote/deploy-commute.js";

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

type Field = "enabled" | "endpoint" | "apiKey" | "autoExecute" | "cliRef" | "deploy";

const FIELDS: Field[] = ["enabled", "endpoint", "apiKey", "autoExecute", "cliRef", "deploy"];

const LABELS: Record<Field, string> = {
  enabled:      "Multi-agent mode",
  endpoint:     "Endpoint",
  apiKey:       "API key",
  autoExecute:  "Auto-implement after research",
  cliRef:       "kimiflare version (advanced)",
  deploy:       "→ Set up (deploys to your Cloudflare account, one-time)",
};

const PLACEHOLDERS: Partial<Record<Field, string>> = {
  endpoint: "https://<your-worker>.workers.dev",
  cliRef:   "github:owner/kimiflare#branch  or  kimiflare@1.2.3",
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
    if (f === "endpoint") return state.workerEndpoint ?? "";
    if (f === "apiKey")   return state.workerApiKey ?? "";
    if (f === "cliRef")   return state.cliRef ?? "";
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

  const runDeploy = useCallback(async () => {
    setDeploying(true);
    setDeployLog(["Starting deploy…"]);
    try {
      for await (const step of deployCommute()) {
        const prefix = step.error ? "✗ " : step.done ? "✓ " : "· ";
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

  const beginEdit = useCallback((f: Field) => {
    if (f === "deploy") {
      void runDeploy();
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
      : editing === "apiKey"  ? { workerApiKey:   trimmed || undefined }
      :                          { cliRef:         trimmed || undefined };
    persist(patch);
    setEditing(null);
    setEditValue("");
  }, [editing, persist]);

  useInput(
    (_input, key) => {
      if (deploying) return; // Ignore input during deploy
      if (editing) {
        if (key.escape) { setEditing(null); setEditValue(""); }
        return;
      }
      if (key.escape) {
        if (deployLog.length > 0) { setDeployLog([]); return; } // Clear deploy log first
        onDone();
        return;
      }
      if (key.upArrow)   { setCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor((c) => Math.min(FIELDS.length - 1, c + 1)); return; }
      if (key.return) {
        const f = FIELDS[cursor];
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
      return "(not set)";
    }
    if (f === "apiKey") {
      if (v) return "(set)";
      if (remoteAuthSecret) return "(from /remote)";
      return "(not set)";
    }
    if (!v) return "(not set)";
    return v;
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        /multi-agent  ·  settings
      </Text>

      {editing ? (
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
              mask={editing === "apiKey" ? "*" : undefined}
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
            {FIELDS.map((f, idx) => {
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
          {deployLog.length > 0 && (
            <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={theme.info.color} paddingX={1}>
              <Text color={theme.accent} bold>{deploying ? "Deploying…" : "Deploy log"}</Text>
              {deployLog.slice(-12).map((line, i) => {
                const isErr = line.startsWith("✗");
                const isDone = line.startsWith("✓");
                return (
                  <Text key={i} color={isErr ? theme.palette.error : isDone ? theme.palette.success : theme.palette.foreground}>
                    {line}
                  </Text>
                );
              })}
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              {deploying
                ? "Deploying… please wait."
                : `↑↓ to pick · Enter to ${FIELDS[cursor] === "deploy" ? "deploy" : isBool(FIELDS[cursor]!) ? "toggle" : "edit"} · Esc to close`}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
