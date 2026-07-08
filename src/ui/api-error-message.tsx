import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";

interface Props {
  httpStatus?: number;
  code?: number;
  message: string;
  onRetry?: () => void;
}

function isRetryable(httpStatus?: number, code?: number): boolean {
  return httpStatus === 429 || code === 3040 || (httpStatus !== undefined && httpStatus >= 500);
}

export function ApiErrorMessage({ httpStatus, code, message, onRetry }: Props) {
  const theme = useTheme();

  const parts: string[] = [];
  if (httpStatus !== undefined) parts.push(`HTTP ${httpStatus}`);
  if (code !== undefined) parts.push(`code: ${code}`);
  const meta = parts.join(" · ");

  const retryable = isRetryable(httpStatus, code);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.error} paddingX={1} marginY={1}>
      <Text bold color={theme.error}>
        ⚠ {message}
      </Text>
      {meta && (
        <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
          {meta}
        </Text>
      )}
      <Text color={theme.muted?.color ?? theme.info.color} dimColor={theme.muted?.dim ?? true}>
        Type /report to send diagnostic info
      </Text>
      {retryable && onRetry && (
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "Try again", value: "retry" as const },
              { label: "Dismiss", value: "dismiss" as const },
            ]}
            onSelect={(item) => {
              if (item.value === "retry") onRetry();
            }}
          />
        </Box>
      )}
    </Box>
  );
}
