import React from "react";
import { Box, Text, useInput } from "ink";
import type { CustomCommand } from "../commands/types.js";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";

interface Props {
  commands: CustomCommand[];
  onDone: () => void;
}

export function CommandList({ commands, onDone }: Props) {
  const theme = useTheme();
  useInput((_input, key) => {
    if (key.escape) {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Custom commands
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Esc to close.
      </Text>
      <Box marginTop={1} flexDirection="column">
        {commands.length === 0 && (
          <Text color={theme.info.color}>
            No custom commands found.
          </Text>
        )}
        {commands.map((cmd) => (
          <Box key={cmd.name} flexDirection="column" marginBottom={1}>
            <Text color={theme.accent} bold>
              /{cmd.name}
            </Text>
            <Text color={theme.info.color}>
              {"  "}source:  {cmd.source}
            </Text>
            <Text color={theme.info.color}>
              {"  "}path:    {cmd.filepath}
            </Text>
            {cmd.description && (
              <Text color={theme.info.color}>
                {"  "}desc:    {cmd.description}
              </Text>
            )}
            {cmd.mode && (
              <Text color={theme.info.color}>
                {"  "}mode:    {cmd.mode}
              </Text>
            )}
            {cmd.effort && (
              <Text color={theme.info.color}>
                {"  "}effort:  {cmd.effort}
              </Text>
            )}
            {cmd.model && (
              <Text color={theme.info.color}>
                {"  "}model:   {cmd.model}
              </Text>
            )}
            <Text color={theme.info.color}>
              {"  "}template:
            </Text>
            {cmd.template.split("\n").slice(0, 5).map((line, i) => (
              <Text key={i} color={theme.info.color}>
                {"    "}{line || " "}
              </Text>
            ))}
            {cmd.template.split("\n").length > 5 && (
              <Text color={theme.info.color}>
                {"    "}...
              </Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
