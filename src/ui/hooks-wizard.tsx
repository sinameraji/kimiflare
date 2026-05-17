import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";
import type { HookEvent, HookConfig } from "../hooks/types.js";
import { appendHook } from "../hooks/settings.js";

/**
 * Multi-step wizard for creating a new user hook. Reached from the
 * `<HooksDashboard>` "+ Create a custom hook" entry.
 *
 * Steps:
 *   1. event   — which lifecycle moment does this fire on?
 *   2. matcher — (only for tool events) regex on tool name; optional
 *   3. command — the shell command to run; required
 *   4. id      — stable handle; optional (auto-derived)
 *   5. description — optional one-liner shown in /hooks list
 *   6. scope   — project (.kimiflare/) vs global (~/.config/kimiflare/)
 *   7. review  — confirm + write
 *
 * Esc backs out to the previous step; from step 1, Esc cancels the
 * whole wizard.
 */

type Step =
  | "event"
  | "matcher"
  | "command"
  | "id"
  | "description"
  | "scope"
  | "review";

const TOOL_EVENTS = new Set<HookEvent>(["PreToolUse", "PostToolUse"]);

const EVENT_DESCRIPTIONS: Record<HookEvent, string> = {
  PreToolUse: "before every tool call — can VETO (block) it",
  PostToolUse: "after every tool call — informational only",
  UserPromptSubmit: "when you hit Enter — can VETO the prompt",
  Stop: "when the agent finishes a turn — informational only",
  PreCompact: "before auto-compaction shrinks the conversation",
};

export interface HooksWizardProps {
  cwd: string;
  /** Called after the new hook is written so the manager re-loads. */
  onSaved: (info: { event: HookEvent; id: string; path: string }) => void;
  /** Called when the user cancels the whole wizard. */
  onCancel: () => void;
}

export function HooksWizard(props: HooksWizardProps): React.ReactElement {
  const theme = useTheme();
  const [step, setStep] = useState<Step>("event");
  const [event, setEvent] = useState<HookEvent | null>(null);
  const [matcher, setMatcher] = useState("");
  const [command, setCommand] = useState("");
  const [id, setId] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"project" | "global">("project");
  const [error, setError] = useState<string | null>(null);

  // Esc handler — back up a step, cancel from step 1.
  useInput((_input, key) => {
    if (!key.escape) return;
    setError(null);
    if (step === "event") {
      props.onCancel();
      return;
    }
    if (step === "matcher") {
      setStep("event");
      return;
    }
    if (step === "command") {
      setStep(event && TOOL_EVENTS.has(event) ? "matcher" : "event");
      return;
    }
    if (step === "id") {
      setStep("command");
      return;
    }
    if (step === "description") {
      setStep("id");
      return;
    }
    if (step === "scope") {
      setStep("description");
      return;
    }
    if (step === "review") {
      setStep("scope");
      return;
    }
  });

  // ── Step renderers ────────────────────────────────────────────────────

  if (step === "event") {
    const items = (Object.keys(EVENT_DESCRIPTIONS) as HookEvent[]).map((ev) => ({
      label: `${ev.padEnd(20)} — ${EVENT_DESCRIPTIONS[ev]}`,
      value: ev,
      key: ev,
    }));
    return (
      <WizardFrame
        title="Create hook · step 1 of 6: pick the event"
        hint="The lifecycle moment that fires your command."
        error={error}
      >
        <SelectInput
          items={items}
          onSelect={(it) => {
            setEvent(it.value);
            setStep(TOOL_EVENTS.has(it.value) ? "matcher" : "command");
          }}
        />
      </WizardFrame>
    );
  }

  if (step === "matcher") {
    return (
      <WizardFrame
        title={`Create hook · step 2 of 6: matcher (optional)`}
        hint={
          `Regex tested against the tool name. Empty = match every tool.\n` +
          `Examples: "^(edit|write)$" — only file edits / writes\n` +
          `          "^bash$"          — only bash calls\n` +
          `          "^mcp_"           — every MCP-server tool`
        }
        error={error}
      >
        <CustomTextInput
          value={matcher}
          onChange={setMatcher}
          onSubmit={(v) => {
            const trimmed = v.trim();
            if (trimmed) {
              try {
                new RegExp(trimmed);
              } catch (e) {
                setError(`invalid regex: ${(e as Error).message}`);
                return;
              }
            }
            setMatcher(trimmed);
            setError(null);
            setStep("command");
          }}
          focus
        />
        <Text color={theme.info.color} dimColor>
          Enter to continue · Esc to go back
        </Text>
      </WizardFrame>
    );
  }

  if (step === "command") {
    const stepNum = TOOL_EVENTS.has(event!) ? 3 : 2;
    return (
      <WizardFrame
        title={`Create hook · step ${stepNum} of 6: shell command`}
        hint={
          `The shell command to run. Required.\n` +
          `Available env vars: $KIMIFLARE_HOOK_EVENT, _TOOL, _PATH, _TIER,\n` +
          `                    _SESSION_ID, _PAYLOAD (full JSON, also on stdin)\n` +
          `Veto events (PreToolUse / UserPromptSubmit): non-zero exit cancels the action.`
        }
        error={error}
      >
        <CustomTextInput
          value={command}
          onChange={setCommand}
          onSubmit={(v) => {
            const trimmed = v.trim();
            if (!trimmed) {
              setError("command is required");
              return;
            }
            setCommand(trimmed);
            setError(null);
            setStep("id");
          }}
          focus
        />
        <Text color={theme.info.color} dimColor>
          Enter to continue · Esc to go back
        </Text>
      </WizardFrame>
    );
  }

  if (step === "id") {
    const stepNum = TOOL_EVENTS.has(event!) ? 4 : 3;
    return (
      <WizardFrame
        title={`Create hook · step ${stepNum} of 6: id (optional)`}
        hint={
          `Stable handle for /hooks enable|disable. Leave blank to auto-\n` +
          `derive from event+command (8 hex chars).`
        }
        error={error}
      >
        <CustomTextInput
          value={id}
          onChange={setId}
          onSubmit={(v) => {
            setId(v.trim());
            setError(null);
            setStep("description");
          }}
          focus
        />
        <Text color={theme.info.color} dimColor>
          Enter to continue · Esc to go back
        </Text>
      </WizardFrame>
    );
  }

  if (step === "description") {
    const stepNum = TOOL_EVENTS.has(event!) ? 5 : 4;
    return (
      <WizardFrame
        title={`Create hook · step ${stepNum} of 6: description (optional)`}
        hint="One-line summary shown by /hooks list."
        error={error}
      >
        <CustomTextInput
          value={description}
          onChange={setDescription}
          onSubmit={(v) => {
            setDescription(v.trim());
            setError(null);
            setStep("scope");
          }}
          focus
        />
        <Text color={theme.info.color} dimColor>
          Enter to continue · Esc to go back
        </Text>
      </WizardFrame>
    );
  }

  if (step === "scope") {
    const stepNum = TOOL_EVENTS.has(event!) ? 6 : 5;
    return (
      <WizardFrame
        title={`Create hook · step ${stepNum} of 6: scope`}
        hint={
          `project — lives in this repo's .kimiflare/settings.json (commit it\n` +
          `          to share with teammates)\n` +
          `global  — lives in ~/.config/kimiflare/settings.json (applies to\n` +
          `          every project)`
        }
        error={error}
      >
        <SelectInput
          items={[
            { label: "project (.kimiflare/settings.json)", value: "project" as const, key: "project" },
            { label: "global  (~/.config/kimiflare/settings.json)", value: "global" as const, key: "global" },
          ]}
          onSelect={(it) => {
            setScope(it.value);
            setStep("review");
          }}
        />
      </WizardFrame>
    );
  }

  // review + save
  const draft: HookConfig = {
    command,
    ...(matcher ? { matcher } : {}),
    ...(id ? { id } : {}),
    ...(description ? { description } : {}),
    enabled: true,
  };

  return (
    <WizardFrame
      title="Create hook · step 6 of 6: review + save"
      hint="Enter on 'Save' to write to settings.json. Esc to go back."
      error={error}
    >
      <Box marginTop={1} flexDirection="column">
        <Text><Text color={theme.info.color} dimColor>event:       </Text>{event}</Text>
        {matcher && <Text><Text color={theme.info.color} dimColor>matcher:     </Text>{matcher}</Text>}
        <Text><Text color={theme.info.color} dimColor>command:     </Text>{command}</Text>
        {id && <Text><Text color={theme.info.color} dimColor>id:          </Text>{id}</Text>}
        {description && <Text><Text color={theme.info.color} dimColor>description: </Text>{description}</Text>}
        <Text><Text color={theme.info.color} dimColor>scope:       </Text>{scope}</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={[
            { label: "✓ Save", value: "save", key: "save" },
            { label: "✗ Cancel", value: "cancel", key: "cancel" },
          ]}
          onSelect={(it) => {
            if (it.value === "cancel") {
              props.onCancel();
              return;
            }
            try {
              const path = appendHook(scope, props.cwd, event!, draft);
              props.onSaved({ event: event!, id: id || draft.command.slice(0, 8), path });
            } catch (e) {
              setError(`save failed: ${(e as Error).message}`);
            }
          }}
        />
      </Box>
    </WizardFrame>
  );
}

// ── Tiny frame component used by every step ──────────────────────────────

function WizardFrame(props: {
  title: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {props.title}
      </Text>
      {props.hint && (
        <Box marginTop={1} flexDirection="column">
          {props.hint.split("\n").map((line, i) => (
            <Text key={i} color={theme.info.color} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {props.children}
      </Box>
      {props.error && (
        <Box marginTop={1}>
          <Text color={theme.palette.error}>{props.error}</Text>
        </Box>
      )}
    </Box>
  );
}
