import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";

interface Props {
  gatewayId: string | undefined;
  skipCache: boolean | undefined;
  collectLogs: boolean | undefined;
  metadataCount: number;
  onAction: (action: string) => void;
  onDone: () => void;
}

export function GatewayPicker({ gatewayId, skipCache, collectLogs, metadataCount, onAction, onDone }: Props) {
  const theme = useTheme();

  const items: { label: string; value: string; key: string }[] = [
    { label: `  gatewayId: ${gatewayId ?? "(not set)"}`, value: "__label_id", key: "label_id" },
    { label: "    → Set gateway ID…", value: "set_id", key: "set_id" },
  ];

  if (gatewayId) {
    items.push({ label: "    → Disable gateway", value: "off", key: "off" });
    items.push({
      label: `  skipCache: ${skipCache ? "true" : "false"}`,
      value: "__label_skip",
      key: "label_skip",
    });
    items.push({
      label: `    → Toggle skip-cache`,
      value: "toggle_skip",
      key: "toggle_skip",
    });
    items.push({
      label: `  collectLogs: ${collectLogs ? "true" : "false"}`,
      value: "__label_logs",
      key: "label_logs",
    });
    items.push({
      label: `    → Toggle collect-logs`,
      value: "toggle_logs",
      key: "toggle_logs",
    });
    items.push({
      label: `  metadata: ${metadataCount} key${metadataCount === 1 ? "" : "s"}`,
      value: "__label_meta",
      key: "label_meta",
    });
    items.push({ label: "    → Clear metadata", value: "clear_meta", key: "clear_meta" });
    items.push({ label: "    → Set cache TTL…", value: "set_ttl", key: "set_ttl" });
    items.push({ label: "    → Add metadata…", value: "add_meta", key: "add_meta" });
  }

  items.push({ label: "  (close)", value: "__close__", key: "close" });

  const selectable = items.filter((i) => !i.value.startsWith("__label_"));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        AI Gateway
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
              onAction(item.value);
            }
          }}
        />
      </Box>
    </Box>
  );
}
