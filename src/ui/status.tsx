import React from "react";
import { Box, Text } from "ink";
import type { Usage } from "../agent/messages.js";
import type { Theme } from "./theme.js";
import type { ReasoningEffort } from "../config.js";
import type { Mode } from "../mode.js";

interface Props {
  model: string;
  usage: Usage | null;
  thinking: boolean;
  hint?: string;
  theme: Theme;
  mode: Mode;
  effort: ReasoningEffort;
  contextLimit: number;
}

const PRICE_IN_PER_M = 0.95;
const PRICE_IN_CACHED_PER_M = 0.16;
const PRICE_OUT_PER_M = 4.0;

export function StatusBar({ model, usage, thinking, hint, theme, mode, effort, contextLimit }: Props) {
  const parts: string[] = [`model: ${shortModel(model)}`, `effort: ${effort}`];
  if (usage) {
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const uncachedIn = usage.prompt_tokens - cached;
    const cost =
      (uncachedIn * PRICE_IN_PER_M) / 1_000_000 +
      (cached * PRICE_IN_CACHED_PER_M) / 1_000_000 +
      (usage.completion_tokens * PRICE_OUT_PER_M) / 1_000_000;
    const pct = Math.round((usage.prompt_tokens / contextLimit) * 100);
    parts.push(
      `in: ${usage.prompt_tokens}${cached ? ` (${cached} cached)` : ""}`,
      `out: ${usage.completion_tokens}`,
      `ctx: ${pct}%`,
      `$${cost.toFixed(5)}`,
    );
  }
  if (thinking) parts.push("thinking…");
  if (hint) parts.push(hint);

  const modeColor =
    mode === "plan" ? theme.modeBadge.plan : mode === "auto" ? theme.modeBadge.auto : theme.modeBadge.edit;
  const warn = usage && usage.prompt_tokens / contextLimit >= 0.8;

  return (
    <Box>
      <Text color={modeColor} bold>
        [{mode}]
      </Text>
      <Text> </Text>
      <Text color={theme.info.color} dimColor={theme.info.dim}>
        {parts.join("  ·  ")}
      </Text>
      {warn ? (
        <Text color={theme.warn} bold>
          {"  ·  "}/compact recommended
        </Text>
      ) : null}
    </Box>
  );
}

function shortModel(m: string): string {
  const last = m.split("/").at(-1) ?? m;
  return last;
}
