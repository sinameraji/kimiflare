import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ToolSpec } from "../tools/registry.js";
import type { PermissionDecision } from "../tools/executor.js";
import { DiffView } from "./diff-view.js";
import type { Theme } from "./theme.js";

interface Props {
  tool: ToolSpec;
  args: Record<string, unknown>;
  onDecide: (decision: PermissionDecision) => void;
  theme: Theme;
}

export function PermissionModal({ tool, args, onDecide, theme }: Props) {
  const render = tool.render?.(args);
  const items = [
    { label: "Allow once", value: "allow" as const },
    { label: "Allow for this session", value: "allow_session" as const },
    { label: "Deny", value: "deny" as const },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.permission} paddingX={1}>
      <Text color={theme.permission} bold>
        Permission requested
      </Text>
      <Text>
        tool: <Text color={theme.tool}>{tool.name}</Text>
      </Text>
      {render?.title ? <Text>action: {render.title}</Text> : null}
      {render?.diff ? (
        <Box marginTop={1} flexDirection="column">
          <DiffView {...render.diff} />
        </Box>
      ) : (
        <Text color={theme.info.color} dimColor={theme.info.dim}>args: {JSON.stringify(args)}</Text>
      )}
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => onDecide(item.value)} />
      </Box>
    </Box>
  );
}
