import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme-context.js";
import { listModels, type ModelEntry, type ModelProvider } from "../models/registry.js";

interface Props {
  current: string;
  onPick: (model: ModelEntry | null) => void;
}

const PROVIDER_ORDER: ModelProvider[] = [
  "workers-ai",
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
];

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  "workers-ai": "Cloudflare Workers AI",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "openai-compatible": "Other (OpenAI-compatible)",
};

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ctx`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k ctx`;
  return `${n} ctx`;
}

function formatPrice(m: ModelEntry): string {
  const { inputPerMtok, outputPerMtok } = m.pricing;
  if (inputPerMtok === 0 && outputPerMtok === 0) return "price n/a";
  return `$${inputPerMtok}/$${outputPerMtok} per Mtok`;
}

export function ModelPicker({ current, onPick }: Props) {
  const theme = useTheme();
  const models = listModels();
  const byProvider = new Map<ModelProvider, ModelEntry[]>();
  for (const m of models) {
    const arr = byProvider.get(m.provider) ?? [];
    arr.push(m);
    byProvider.set(m.provider, arr);
  }

  const byId = new Map<string, ModelEntry>(models.map((m) => [m.id, m]));
  const items: { label: string; value: string }[] = [];
  for (const p of PROVIDER_ORDER) {
    const list = byProvider.get(p);
    if (!list || list.length === 0) continue;
    items.push({ label: `── ${PROVIDER_LABEL[p]} ──`, value: `__hdr_${p}__` });
    for (const m of list) {
      const marker = m.id === current ? "● " : "  ";
      const bill = m.billingMode === "unified" ? "unified" : "byok";
      const label = `${marker}${m.id}  ·  ${formatContext(m.contextWindow)}  ·  ${formatPrice(m)}  ·  ${bill}`;
      items.push({ label, value: m.id });
    }
  }
  items.push({ label: "< Back", value: "__back__" });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Pick a model  ·  current: {current}
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === "__back__") return onPick(null);
            if (item.value.startsWith("__hdr_")) return; // headers not selectable
            onPick(byId.get(item.value) ?? null);
          }}
          itemComponent={({ label, isSelected }) => {
            const isHeader = label.startsWith("── ");
            if (isHeader) {
              return (
                <Text color={theme.muted?.color ?? theme.info.color} dimColor>
                  {label}
                </Text>
              );
            }
            return (
              <Text color={isSelected ? theme.accent : theme.info.color} bold={isSelected}>
                {label}
              </Text>
            );
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted?.color ?? theme.info.color} dimColor>
          ● = current   ·   byok models need providerKeys configured   ·   restart for full effect
        </Text>
      </Box>
    </Box>
  );
}
