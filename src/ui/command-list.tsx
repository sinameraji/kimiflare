import React from "react";
import { Box, Text, useInput } from "ink";
import type { CustomCommand } from "../commands/types.js";
import { DEFAULT_THEME as theme } from "./theme.js";

interface Props {
  commands: CustomCommand[];
  onDone: () => void;
}

export function CommandList({ commands, onDone }: Props) {
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
          <Text color={theme.info.color} dimColor>
            No custom commands found.
          </Text>
        )}
        {commands.map((cmd) => (
          <Box key={cmd.name} flexDirection="column" marginBottom={1}>
            <Text color={theme.accent} bold>
              /{cmd.name}
            </Text>
            <Text color={theme.info.color} dimColor>
              {"  "}source:  {cmd.source}
            </Text>
            <Text color={theme.info.color} dimColor>
              {"  "}path:    {cmd.filepath}
            </Text>
            {cmd.description && (
              <Text color={theme.info.color} dimColor>
                {"  "}desc:    {cmd.description}
              </Text>
            )}
            {cmd.mode && (
              <Text color={theme.info.color} dimColor>
                {"  "}mode:    {cmd.mode}
              </Text>
            )}
            {cmd.effort && (
              <Text color={theme.info.color} dimColor>
                {"  "}effort:  {cmd.effort}
              </Text>
            )}
            {cmd.model && (
              <Text color={theme.info.color} dimColor>
                {"  "}model:   {cmd.model}
              </Text>
            )}
            <Text color={theme.info.color} dimColor>
              {"  "}template:
            </Text>
            {cmd.template.split("\n").slice(0, 5).map((line, i) => (
              <Text key={i} color={theme.info.color} dimColor>
                {"    "}{line || " "}
              </Text>
            ))}
            {cmd.template.split("\n").length > 5 && (
              <Text color={theme.info.color} dimColor>
                {"    "}...
              </Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
