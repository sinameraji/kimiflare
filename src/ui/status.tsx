import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Usage } from "../agent/messages.js";
import type { Theme } from "./theme.js";
import type { ReasoningEffort } from "../config.js";
import type { Mode } from "../mode.js";
import { calculateCost } from "../pricing.js";

interface Props {
  model: string;
  usage: Usage | null;
  thinking: boolean;
  turnStartedAt: number | null;
  theme: Theme;
  mode: Mode;
  effort: ReasoningEffort;
  contextLimit: number;
  hasUpdate?: boolean;
  latestVersion?: string | null;
}

export function StatusBar({ model, usage, thinking, turnStartedAt, theme, mode, effort, contextLimit, hasUpdate, latestVersion }: Props) {
  const [now, setNow] = useState(Date.now());
  const modeColor =
    mode === "plan" ? theme.modeBadge.plan : mode === "auto" ? theme.modeBadge.auto : theme.modeBadge.edit;
  const warn = usage && usage.prompt_tokens / contextLimit >= 0.8;

  useEffect(() => {
    if (!thinking || turnStartedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [thinking, turnStartedAt]);

  const elapsed = turnStartedAt !== null ? formatElapsed(now - turnStartedAt) : null;

  const leftParts: string[] = [`${shortModel(model)}`, effort];

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={modeColor} bold>
          [{mode}]
        </Text>
        <Text> </Text>
        {thinking ? (
          <Text color={theme.spinner}>
            <Spinner type="dots" />{" "}
            thinking{elapsed ? ` · ${elapsed}` : ""}
          </Text>
        ) : (
          <Text color={theme.info.color} dimColor={theme.info.dim}>
            {leftParts.join("  ·  ")}  ·  ready
          </Text>
        )}
      </Box>
      {usage && (
        <Box>
          <Text color={theme.info.color} dimColor={theme.info.dim}>
            {buildRightParts(usage, contextLimit).join("  ·  ")}
          </Text>
          {warn ? (
            <Text color={theme.warn} bold>
              {"  ·  "}/compact recommended
            </Text>
          ) : null}
          {hasUpdate ? (
            <Text color={theme.warn} bold>
              {"  ·  "}update available{latestVersion ? ` → ${latestVersion}` : ""} · run /update
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

function buildRightParts(usage: Usage, contextLimit: number): string[] {
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, cached);
  const pct = Math.round((usage.prompt_tokens / contextLimit) * 100);
  return [
    `in ${usage.prompt_tokens}${cached ? ` (${cached} cached)` : ""}`,
    `out ${usage.completion_tokens}`,
    `ctx ${pct}%`,
    `$${cost.total.toFixed(5)}`,
  ];
}

function shortModel(m: string): string {
  const last = m.split("/").at(-1) ?? m;
  return last;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
