import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";
import type { ModelEntry, ModelProvider } from "../models/registry.js";

interface Props {
  model: ModelEntry;
  onSave: (key: string) => void;
  onCancel: () => void;
}

const PROVIDER_INFO: Record<ModelProvider, { name: string; url: string; hint: string }> = {
  "workers-ai": {
    name: "Cloudflare Workers AI",
    url: "https://dash.cloudflare.com/profile/api-tokens",
    hint: "Use a token with the Workers AI permission.",
  },
  anthropic: {
    name: "Anthropic",
    url: "https://console.anthropic.com/settings/keys",
    hint: "Create a key in Settings → API Keys. Starts with `sk-ant-`.",
  },
  openai: {
    name: "OpenAI",
    url: "https://platform.openai.com/api-keys",
    hint: "Create a key in Settings → API Keys. Starts with `sk-`.",
  },
  google: {
    name: "Google AI Studio",
    url: "https://aistudio.google.com/app/apikey",
    hint: "Create a key in Get API key. Starts with `AIza…`.",
  },
  "openai-compatible": {
    name: "your provider",
    url: "your provider's dashboard",
    hint: "Paste the API key your provider issued.",
  },
};

function maskPreview(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`;
}

export function KeyEntryModal({ model, onSave, onCancel }: Props) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const info = PROVIDER_INFO[model.provider];

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.ctrl && input === "r") {
      setReveal((r) => !r);
      return;
    }
  });

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onSave(trimmed);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={2} paddingY={1}>
      <Text color={theme.accent} bold>
        Connect {info.name}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          To use <Text bold>{model.id}</Text> ({model.contextWindow.toLocaleString()}-token context,
          ${model.pricing.inputPerMtok}/${model.pricing.outputPerMtok} per Mtok), kimiflare needs
          your {info.name} API key.
        </Text>
        <Box marginTop={1}>
          <Text>
            1. Get a key here:{" "}
            <Text color={theme.accent} underline>
              {info.url}
            </Text>
          </Text>
        </Box>
        <Text>2. Paste it below and press Enter.</Text>
        <Box marginTop={1}>
          <Text color={theme.muted?.color ?? theme.info.color} dimColor>
            {info.hint}
          </Text>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.info.color}>API key:</Text>
        {reveal ? (
          <CustomTextInput value={value} onChange={setValue} onSubmit={submit} focus />
        ) : (
          // Show only a masked preview while the user types. The hidden
          // CustomTextInput still captures input — we just render a mask above it.
          <Box flexDirection="column">
            <Text>{maskPreview(value) || " "}</Text>
            <Box height={0} overflow="hidden">
              <CustomTextInput value={value} onChange={setValue} onSubmit={submit} focus />
            </Box>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted?.color ?? theme.info.color} dimColor>
          Enter to save · Ctrl+R to {reveal ? "hide" : "reveal"} · Esc to cancel · stored in your local config (chmod 600)
        </Text>
      </Box>
    </Box>
  );
}
