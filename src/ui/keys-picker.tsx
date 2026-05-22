import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";

interface Props {
  providerKeys: Record<string, string | undefined>;
  unifiedBilling: boolean;
  onAction: (action: string, provider?: string) => void;
  onDone: () => void;
}

const PROVIDERS = ["anthropic", "openai", "google", "openai-compatible"] as const;

function maskKey(k: string): string {
  if (k.length <= 8) return "***";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export function KeysPicker({ providerKeys, unifiedBilling, onAction, onDone }: Props) {
  const theme = useTheme();

  const items: { label: string; value: string; key: string }[] = [];

  for (const p of PROVIDERS) {
    const key = providerKeys[p];
    items.push({
      label: `  ${p}: ${key ? maskKey(key) : "(not set)"}`,
      value: `__label_${p}`,
      key: `label_${p}`,
    });
    items.push({
      label: `    → Set ${p} key`,
      value: `set_${p}`,
      key: `set_${p}`,
    });
    if (key) {
      items.push({
        label: `    → Clear ${p} key`,
        value: `clear_${p}`,
        key: `clear_${p}`,
      });
    }
  }

  items.push({
    label: `  unifiedBilling: ${unifiedBilling ? "on" : "off"}`,
    value: "__label_unified",
    key: "label_unified",
  });
  items.push({
    label: `    → Toggle unified billing`,
    value: "toggle_unified",
    key: "toggle_unified",
  });
  items.push({ label: "  (close)", value: "__close__", key: "close" });

  const selectable = items.filter((i) => !i.value.startsWith("__label_"));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Provider Keys
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Arrow keys to navigate, Enter to select, Esc to close.
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={selectable}
          onSelect={(item) => {
            if (item.value === "__close__") {
              onDone();
            } else {
              const [action, provider] = item.value.split("_");
              onAction(action!, provider);
            }
          }}
        />
      </Box>
    </Box>
  );
}
