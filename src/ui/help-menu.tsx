import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import type { Theme } from "./theme.js";

interface CustomCommandSummary {
  name: string;
  description?: string;
}

interface Props {
  theme: Theme;
  themes: { name: string; label: string }[];
  currentThemeName: string;
  customCommands?: CustomCommandSummary[];
  costAttributionEnabled?: boolean;
  onDone: () => void;
  onCommand: (command: string) => void;
}

type Page =
  | "main"
  | "mode"
  | "thinking"
  | "theme"
  | "session"
  | "memory"
  | "cost"
  | "mcp"
  | "lsp"
  | "gateway"
  | "info"
  | "config"
  | "commands"
  | "custom";

interface CommandItem {
  command: string;
  description: string;
  selectable?: boolean;
}

interface Category {
  key: Page;
  label: string;
  commands: CommandItem[];
}

const CATEGORIES: Category[] = [
  {
    key: "mode",
    label: "Mode",
    commands: [
      { command: "/mode edit", description: "switch to edit mode" },
      { command: "/mode plan", description: "switch to plan mode" },
      { command: "/mode auto", description: "switch to auto mode" },
    ],
  },
  {
    key: "thinking",
    label: "Thinking",
    commands: [
      { command: "/thinking low", description: "fast, lower quality" },
      { command: "/thinking medium", description: "balanced" },
      { command: "/thinking high", description: "slow, higher quality" },
    ],
  },
  {
    key: "theme",
    label: "Theme",
    commands: [],
  },
  {
    key: "session",
    label: "Session",
    commands: [
      { command: "/resume", description: "pick a past conversation" },
      { command: "/compact", description: "summarize old turns to free context" },
      { command: "/clear", description: "clear current conversation" },
    ],
  },
  {
    key: "memory",
    label: "Memory",
    commands: [
      { command: "/memory", description: "show memory stats" },
      { command: "/memory on", description: "enable memory" },
      { command: "/memory off", description: "disable memory" },
      { command: "/memory clear", description: "wipe memories for this repo" },
      { command: "/memory search <query>", description: "search stored memories", selectable: false },
    ],
  },
  {
    key: "cost",
    label: "Cost",
    commands: [
      { command: "/cost", description: "show cost report" },
      { command: "/cost on", description: "enable cost attribution by task type" },
      { command: "/cost off", description: "disable cost attribution by task type" },
    ],
  },
  {
    key: "mcp",
    label: "MCP",
    commands: [
      { command: "/mcp list", description: "list connected MCP servers and tools" },
      { command: "/mcp reload", description: "reconnect all configured MCP servers" },
    ],
  },
  {
    key: "lsp",
    label: "LSP",
    commands: [
      { command: "/lsp config", description: "add, edit, or remove language servers" },
      { command: "/lsp list", description: "list active LSP servers" },
      { command: "/lsp reload", description: "restart all configured LSP servers" },
      { command: "/lsp scope", description: "show whether LSP config is project or global" },
    ],
  },
  {
    key: "gateway",
    label: "Gateway",
    commands: [
      { command: "/gateway", description: "show gateway status" },
      { command: "/gateway off", description: "disable AI Gateway (direct Workers AI)" },
      { command: "/gateway skip-cache true", description: "enable skip-cache" },
      { command: "/gateway skip-cache false", description: "disable skip-cache" },
      { command: "/gateway collect-logs true", description: "enable log collection" },
      { command: "/gateway collect-logs false", description: "disable log collection" },
      { command: "/gateway metadata clear", description: "remove all metadata" },
      { command: "/gateway <id>", description: "enable AI Gateway", selectable: false },
      { command: "/gateway cache-ttl <seconds>", description: "set cache TTL", selectable: false },
      { command: "/gateway metadata <key>=<value>", description: "add metadata", selectable: false },
    ],
  },
  {
    key: "info",
    label: "Info",
    commands: [
      { command: "/cost", description: "show cost report" },
      { command: "/model", description: "show current model" },
      { command: "/update", description: "check for updates" },
      { command: "/hello", description: "send a voice note to the creator" },
    ],
  },
  {
    key: "commands",
    label: "Commands",
    commands: [
      { command: "/command create", description: "create a new custom slash command" },
      { command: "/command edit", description: "edit an existing custom command" },
      { command: "/command delete", description: "delete a custom command" },
      { command: "/command list", description: "list all custom commands" },
    ],
  },
  {
    key: "config",
    label: "Config",
    commands: [
      { command: "/init", description: "scan this repo and write a KIMI.md" },
      { command: "/logout", description: "clear credentials" },
      { command: "filePicker", description: "enable with KIMIFLARE_FILE_PICKER=1 or filePicker: true in config", selectable: false },
    ],
  },
];

const SINGLE_COMMANDS: CommandItem[] = [
  { command: "/reasoning", description: "toggle show/hide model reasoning" },
  { command: "/help", description: "show this menu" },
  { command: "/exit", description: "exit kimiflare" },
];

export function HelpMenu({ theme, themes, currentThemeName, customCommands, costAttributionEnabled, onDone, onCommand }: Props) {
  const [page, setPage] = useState<Page>("main");
  const customs = customCommands ?? [];

  useInput((_input, key) => {
    if (key.escape) {
      if (page !== "main") {
        setPage("main");
      } else {
        onDone();
      }
    }
  });

  const handleSelect = (command: string) => {
    onCommand(command);
    onDone();
  };

  if (page === "main") {
    const items: { label: string; value: string; key: string }[] = CATEGORIES.map((cat) => ({
      label: cat.label,
      value: cat.key,
      key: cat.key,
    }));
    if (customs.length > 0) {
      items.push({ label: "Run custom commands", value: "custom", key: "custom" });
    }
    items.push({ label: "(close)", value: "__close__", key: "__close__" });

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <Text color={theme.accent} bold>
          Help
        </Text>
        <Text color={theme.info.color} dimColor={false}>
          Arrow keys to navigate, Enter to select, Esc to close.
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "__close__") {
                onDone();
              } else {
                setPage(item.value as Page);
              }
            }}
          />
        </Box>
        <Box marginTop={1} flexDirection="column">
          {SINGLE_COMMANDS.map((cmd) => (
            <Text key={cmd.command} color={theme.info.color} dimColor={false}>
              {`  ${cmd.command.padEnd(20)} ${cmd.description}`}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.info.color} dimColor={false}>
            keys: ctrl-c interrupt/exit · ctrl-r toggle reasoning · ctrl-o verbose · ctrl+t theme · shift+tab cycle mode · ↑/↓ history
          </Text>
        </Box>
      </Box>
    );
  }

  if (page === "theme") {
    const items = themes.map((t) => ({
      label: t.name === currentThemeName ? `${t.label} · current` : t.label,
      value: t.name,
      key: t.name,
    }));
    items.push({ label: "← Back", value: "__back__", key: "__back__" });

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <Text color={theme.accent} bold>
          Theme
        </Text>
        <Text color={theme.info.color} dimColor={false}>
          Arrow keys to navigate, Enter to apply, Esc to go back.
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "__back__") {
                setPage("main");
              } else {
                handleSelect(`/theme ${item.value}`);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (page === "custom") {
    const items = customs.map((c) => ({
      label: `${`/${c.name}`.padEnd(28)} ${c.description ?? ""}`.trimEnd(),
      value: `/${c.name}`,
      key: c.name,
    }));
    items.push({ label: "← Back", value: "__back__", key: "__back__" });

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <Text color={theme.accent} bold>
          Custom commands
        </Text>
        <Text color={theme.info.color} dimColor={false}>
          {customs.length === 0
            ? "no custom commands found in .kimiflare/commands/"
            : "Arrow keys to navigate, Enter to run, Esc to go back."}
        </Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "__back__") {
                setPage("main");
              } else {
                handleSelect(item.value as string);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  const category = CATEGORIES.find((c) => c.key === page)!;
  const selectable = category.commands.filter((cmd) => cmd.selectable !== false);
  const staticCmds = category.commands.filter((cmd) => cmd.selectable === false);

  const items = selectable.map((cmd) => ({
    label: `${cmd.command.padEnd(28)} ${cmd.description}`,
    value: cmd.command,
    key: cmd.command,
  }));
  items.push({ label: "← Back", value: "__back__", key: "__back__" });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {category.label}
      </Text>
      <Text color={theme.info.color} dimColor={false}>
        Arrow keys to navigate, Enter to execute, Esc to go back.
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === "__back__") {
              setPage("main");
            } else {
              handleSelect(item.value as string);
            }
          }}
        />
      </Box>
      {staticCmds.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {staticCmds.map((cmd) => (
            <Text key={cmd.command} color={theme.info.color} dimColor>
              {`  ${cmd.command.padEnd(28)} ${cmd.description}`}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
