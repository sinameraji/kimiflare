import React from "react";
import { Box, Text } from "ink";
import type { Usage } from "../agent/messages.js";

interface Props {
  model: string;
  usage: Usage | null;
  thinking: boolean;
  hint?: string;
}

const PRICE_IN_PER_M = 0.95;
const PRICE_IN_CACHED_PER_M = 0.16;
const PRICE_OUT_PER_M = 4.0;

export function StatusBar({ model, usage, thinking, hint }: Props) {
  const parts: string[] = [`model: ${shortModel(model)}`];
  if (usage) {
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const uncachedIn = usage.prompt_tokens - cached;
    const cost =
      (uncachedIn * PRICE_IN_PER_M) / 1_000_000 +
      (cached * PRICE_IN_CACHED_PER_M) / 1_000_000 +
      (usage.completion_tokens * PRICE_OUT_PER_M) / 1_000_000;
    parts.push(
      `in: ${usage.prompt_tokens}${cached ? ` (${cached} cached)` : ""}`,
      `out: ${usage.completion_tokens}`,
      `$${cost.toFixed(5)}`,
    );
  }
  if (thinking) parts.push("thinking…");
  if (hint) parts.push(hint);

  return (
    <Box>
      <Text color="gray" dimColor>
        {parts.join("  ·  ")}
      </Text>
    </Box>
  );
}

function shortModel(m: string): string {
  const last = m.split("/").at(-1) ?? m;
  return last;
}
