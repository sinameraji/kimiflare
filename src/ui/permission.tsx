import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ToolSpec } from "../tools/registry.js";
import type { PermissionDecision } from "../tools/executor.js";
import { DiffView } from "./diff-view.js";

interface Props {
  tool: ToolSpec;
  args: Record<string, unknown>;
  onDecide: (decision: PermissionDecision) => void;
}

export function PermissionModal({ tool, args, onDecide }: Props) {
  const render = tool.render?.(args);
  const items = [
    { label: "Allow once", value: "allow" as const },
    { label: "Allow for this session", value: "allow_session" as const },
    { label: "Deny", value: "deny" as const },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        Permission requested
      </Text>
      <Text>
        tool: <Text color="magenta">{tool.name}</Text>
      </Text>
      {render?.title ? <Text>action: {render.title}</Text> : null}
      {render?.diff ? (
        <Box marginTop={1} flexDirection="column">
          <DiffView {...render.diff} />
        </Box>
      ) : (
        <Text color="gray">args: {JSON.stringify(args)}</Text>
      )}
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => onDecide(item.value)} />
      </Box>
    </Box>
  );
}
