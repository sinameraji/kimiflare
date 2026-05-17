import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";
import type { HookEvent, HookConfig } from "../hooks/types.js";
import { HOOK_EVENTS } from "../hooks/types.js";
import { RECOMMENDED_HOOKS, type RecommendedHook } from "../hooks/recommended.js";
import { setHookEnabled, appendHook, deriveHookId } from "../hooks/settings.js";

/**
 * Interactive `/hooks` dashboard. Replaces the prior text-dump UX with
 * arrow-key navigation + Enter-to-toggle, matching the existing
 * picker pattern used by `/checkpoints`, `/resume`, `/theme`, etc.
 *
 * Typing path still works: `/hooks enable <id>`, `/hooks recommended`,
 * etc. are honored by the slash-command dispatcher. The dashboard is
 * what you get when you type `/hooks` with no args.
 *
 * Layout:
 *
 *   ╭─ Hooks ─────────────────────────────────────────────╮
 *   │ Configured                                          │
 *   │   PostToolUse  audit-tool-calls          [enabled]  │
 *   │   Stop         stop-bell                 [enabled]  │
 *   │                                                     │
 *   │ Recommended (Enter to enable / disable)             │
 *   │ ▸ Stop         stop-notify-macos         [ ]        │
 *   │   Stop         stop-glass-sound-macos    [ ]        │
 *   │   PreToolUse   block-env-file-writes     [ ]        │
 *   │   ...                                               │
 *   │   ← Done                                            │
 *   ╰─────────────────────────────────────────────────────╯
 */

interface ConfiguredEntry {
  event: HookEvent;
  hook: HookConfig;
}

export interface HooksDashboardProps {
  configured: ConfiguredEntry[];
  cwd: string;
  /** Called whenever the dashboard mutates settings.json so the
   *  caller can re-load the HooksManager. */
  onMutate: () => void;
  /** Called when the user dismisses the dashboard. */
  onDone: () => void;
}

interface ToggleItem {
  label: string;
  value: { kind: "toggle"; id: string; event: HookEvent; enable: boolean } | { kind: "enable-recommended"; rec: RecommendedHook } | { kind: "done" };
  key: string;
}

function fmtRow(eventCol: string, idCol: string, badge: string): string {
  // Pad columns so the badge column lines up; cheap manual table.
  const ev = eventCol.padEnd(18);
  const id = idCol.padEnd(28);
  return `${ev}${id}${badge}`;
}

export function HooksDashboard(props: HooksDashboardProps): React.ReactElement {
  const theme = useTheme();
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  void version; // re-render trigger after a mutation

  useInput((_input, key) => {
    if (key.escape) props.onDone();
  });

  // What's in the recommended catalog but NOT already in `configured`
  // by id. Listing those separately keeps the dashboard from showing
  // "block-env-file-writes" twice when the user already enabled it.
  const items = useMemo<ToggleItem[]>(() => {
    const out: ToggleItem[] = [];
    const configuredIds = new Set(
      props.configured.map((c) => c.hook.id ?? deriveHookId(c.event, c.hook.command)),
    );

    if (props.configured.length > 0) {
      for (const c of props.configured) {
        const id = c.hook.id ?? deriveHookId(c.event, c.hook.command);
        const enabled = c.hook.enabled !== false;
        const badge = enabled ? "[enabled]" : "[disabled]";
        out.push({
          label: fmtRow(c.event, id, badge),
          value: { kind: "toggle", id, event: c.event, enable: !enabled },
          key: `cfg-${id}`,
        });
      }
    }

    for (const r of RECOMMENDED_HOOKS) {
      if (configuredIds.has(r.id)) continue; // already shown above
      out.push({
        label: fmtRow(r.event, r.id, "[ recommended ]"),
        value: { kind: "enable-recommended", rec: r },
        key: `rec-${r.id}`,
      });
    }
    out.push({ label: "← Done", value: { kind: "done" }, key: "__done__" });
    return out;
  }, [props.configured, version]);

  const handleSelect = (item: ToggleItem): void => {
    const v = item.value;
    if (v.kind === "done") {
      props.onDone();
      return;
    }
    if (v.kind === "toggle") {
      const path = setHookEnabled(props.cwd, v.id, v.enable);
      if (path) {
        props.onMutate();
        setMessage(`${v.enable ? "enabled" : "disabled"} ${v.id} in ${path}`);
        setVersion((n) => n + 1);
      } else {
        setMessage(`could not find hook ${v.id}`);
      }
      return;
    }
    if (v.kind === "enable-recommended") {
      const path = appendHook("project", props.cwd, v.rec.event, {
        ...v.rec.hook,
        enabled: true,
      });
      props.onMutate();
      setMessage(`enabled ${v.rec.id} (${v.rec.event}) in ${path}`);
      setVersion((n) => n + 1);
    }
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Hooks
      </Text>
      <Text color={theme.info.color} dimColor>
        Arrow keys to navigate, Enter to toggle, Esc when done.
      </Text>
      {props.configured.length > 0 && (
        <Box marginTop={1}>
          <Text color={theme.info.color} dimColor>
            Configured (in your settings.json):
          </Text>
        </Box>
      )}
      {props.configured.length === 0 && (
        <Box marginTop={1}>
          <Text color={theme.info.color} dimColor>
            No hooks configured yet. Pick a recommended one below.
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <SelectInput items={items as never} onSelect={(it) => handleSelect(it as ToggleItem)} />
      </Box>
      {message && (
        <Box marginTop={1}>
          <Text color={theme.accent}>{message}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.info.color} dimColor>
          The {HOOK_EVENTS.length} events: {HOOK_EVENTS.join(" · ")}
        </Text>
      </Box>
    </Box>
  );
}
